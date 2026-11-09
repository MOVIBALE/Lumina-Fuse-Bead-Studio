import type {
  WorkshopClient,
  WorkshopColorLibrary,
} from "@lumina/workshop-sdk";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  beadEditorReducer,
  createBeadEditorState,
  type BeadEditorAction,
  type BeadEditorState,
} from "../domain/editorReducer";
import {
  AUTO_EXPAND_CANVAS_INITIAL_SIZE,
  createBeadProject,
  trimEmptyBorder,
  validateBeadProject,
} from "../domain/project";
import { cropRaster, suggestGrid } from "../domain/recognition";
import { BEAD_WORKSPACE_SCHEMA, prepareBeadWorkspace, type BeadWorkspaceState } from "../domain/workspaceSnapshot";
import type { BeadRenderResult } from "../domain/renderer";
import {
  BEAD_MODULE_VERSION,
  type BeadProject,
  type BeadProjectSource,
  type CropRect,
  type PatternClassification,
  type Raster,
  type RecognitionRequest,
  type RecognitionResult,
} from "../domain/types";
import {
  latestBeadProject,
  pickBeadSource,
  queueCachedBeadProjectSave,
  saveBeadProject,
} from "../host/hostAdapter";
import {
  mapProjectToColorLibrary,
  setManualColorMapping,
} from "../host/colorMapping";
import {
  browserBeadImageCodec,
  type BeadImageCodec,
} from "../host/imageCodec";
import {
  handoffPreparedBeadImage,
  prepareBeadHandoff,
  type PreparedBeadHandoff,
} from "../host/handoff";
import { translate, type Locale } from "../i18n/translations";
import Button from "../ui/Button";
import CropModal from "../ui/CropModal";
import {
  PanelIntro,
  StatusBanner,
  mutedSectionCardClass,
} from "../ui/panelPrimitives";
import {
  BeadWorkerClient,
  BeadWorkerClientError,
  type BeadWorkerTask,
} from "../worker/workerClient";
import {
  BeadCalibrationStep,
  type BeadCalibrationDraft,
} from "./BeadCalibrationStep";
import { BeadEditorStep } from "./BeadEditorStep";
import { BeadHandoffConfirmDialog } from "./BeadHandoffConfirmDialog";
import { BeadHandoffSummaryDialog } from "./BeadHandoffSummaryDialog";

export type { BeadImageCodec } from "../host/imageCodec";

type BeadWorkflowStage =
  | "loading"
  | "upload"
  | "calibration"
  | "editor";

type BeadProcessingPhase =
  | "idle"
  | "classifying"
  | "recognizing";

interface RecalibrationSession {
  workingRaster: Raster;
  crop: CropRect | null;
}

interface ActiveProcessingTask {
  epoch: number;
  id: number;
}

export interface BeadProcessingEngine {
  classify(source: Raster): BeadWorkerTask<PatternClassification>;
  recognize(
    request: RecognitionRequest,
  ): BeadWorkerTask<RecognitionResult>;
  render(
    project: BeadProject,
    compression: number,
    pixelsPerCell: number,
  ): BeadWorkerTask<BeadRenderResult>;
  cancelBefore(requestId: number): void;
  cancel(requestId: number): void;
  dispose(): void;
}

interface BeadWorkshopModuleProps {
  client: WorkshopClient;
  locale: Locale;
  createEngine?: () => BeadProcessingEngine;
  imageCodec?: BeadImageCodec;
  autosaveDelayMs?: number;
}

interface HandoffSummaryState {
  handoff: PreparedBeadHandoff;
  compression: number;
  irregularity: number;
  libraryLabel: string | null;
}

function defaultEngine(): BeadProcessingEngine {
  return new BeadWorkerClient();
}

function generatedProjectId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `bead-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function draftForRaster(
  source: Raster,
  mode: BeadCalibrationDraft["inputMode"],
): BeadCalibrationDraft {
  const suggestion = suggestGrid(source, mode);
  return {
    inputMode: mode,
    rows: suggestion.rows,
    columns: suggestion.columns,
    geometry: suggestion.geometry,
    orientation: {
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
    },
    emptySelection: null,
  };
}

function draftFromProject(
  source: Raster,
  project: BeadProject,
): BeadCalibrationDraft {
  const swapsDimensions =
    project.calibration.orientation.rotation === 90 ||
    project.calibration.orientation.rotation === 270;
  const rows = swapsDimensions ? project.columns : project.rows;
  const columns = swapsDimensions ? project.rows : project.columns;
  const originX = project.calibration.origin.x;
  const originY = project.calibration.origin.y;
  return {
    inputMode: project.calibration.inputMode,
    rows,
    columns,
    geometry: {
      originX,
      originY,
      cellWidth: (source.width - originX) / columns,
      cellHeight: (source.height - originY) / rows,
    },
    orientation: { ...project.calibration.orientation },
    emptySelection: { ...project.calibration.emptySelection },
  };
}

function draftAfterCrop(
  source: Raster,
  draft: BeadCalibrationDraft,
  previousCrop: CropRect | null,
  nextCrop: CropRect | null,
): BeadCalibrationDraft {
  const previousOffsetX = previousCrop?.x ?? 0;
  const previousOffsetY = previousCrop?.y ?? 0;
  const nextOffsetX = nextCrop?.x ?? 0;
  const nextOffsetY = nextCrop?.y ?? 0;
  const originX = Math.min(
    source.width - 1,
    Math.max(
      0,
      draft.geometry.originX + previousOffsetX - nextOffsetX,
    ),
  );
  const originY = Math.min(
    source.height - 1,
    Math.max(
      0,
      draft.geometry.originY + previousOffsetY - nextOffsetY,
    ),
  );
  return {
    ...draft,
    geometry: {
      originX,
      originY,
      cellWidth: (source.width - originX) / draft.columns,
      cellHeight: (source.height - originY) / draft.rows,
    },
    orientation: { ...draft.orientation },
    emptySelection: draft.emptySelection
      ? { ...draft.emptySelection }
      : null,
  };
}

function squareFittedCrop(
  original: Raster,
  currentCrop: CropRect | null,
  draft: BeadCalibrationDraft,
): CropRect {
  const pitch = Math.min(
    draft.geometry.cellWidth,
    draft.geometry.cellHeight,
  );
  const base = currentCrop ?? {
    x: 0,
    y: 0,
    width: original.width,
    height: original.height,
  };
  return normalizedCrop(original, {
    x: base.x,
    y: base.y,
    width: draft.geometry.originX + pitch * draft.columns,
    height: draft.geometry.originY + pitch * draft.rows,
  });
}

function timestampAfter(previous: string): string {
  const previousTime = Date.parse(previous);
  const minimum = Number.isFinite(previousTime)
    ? previousTime + 1
    : Date.now();
  return new Date(Math.max(Date.now(), minimum)).toISOString();
}

function normalizedCrop(
  source: Raster,
  crop: CropRect,
): CropRect {
  const x = Math.min(
    source.width - 1,
    Math.max(0, Math.round(crop.x)),
  );
  const y = Math.min(
    source.height - 1,
    Math.max(0, Math.round(crop.y)),
  );
  return {
    x,
    y,
    width: Math.min(
      source.width - x,
      Math.max(1, Math.round(crop.width)),
    ),
    height: Math.min(
      source.height - y,
      Math.max(1, Math.round(crop.height)),
    ),
  };
}

function isCancellation(error: unknown): boolean {
  return (
    error instanceof BeadWorkerClientError &&
    error.code === "request-cancelled"
  );
}

function ignoreFailure(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

export function BeadWorkshopModule({
  client,
  locale,
  createEngine = defaultEngine,
  imageCodec = browserBeadImageCodec,
  autosaveDelayMs = 250,
}: BeadWorkshopModuleProps) {
  const t = useCallback(
    (key: string) => translate(locale, key),
    [locale],
  );
  const [stage, setStage] =
    useState<BeadWorkflowStage>("loading");
  const [initialized, setInitialized] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const [processingPhase, setProcessingPhase] =
    useState<BeadProcessingPhase>("idle");
  const [visibleError, setVisibleError] =
    useState<string | null>(null);
  const [classification, setClassification] =
    useState<PatternClassification | null>(null);
  const [calibrationDraft, setCalibrationDraft] =
    useState<BeadCalibrationDraft | null>(null);
  const [originalRaster, setOriginalRaster] =
    useState<Raster | null>(null);
  const [workingRaster, setWorkingRaster] =
    useState<Raster | null>(null);
  const [projectSource, setProjectSource] =
    useState<BeadProjectSource | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [recalibrationSession, setRecalibrationSession] =
    useState<RecalibrationSession | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [editorState, setEditorState] =
    useState<BeadEditorState | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffSummary, setHandoffSummary] =
    useState<HandoffSummaryState | null>(null);
  const [pendingReplacement, setPendingReplacement] =
    useState<PreparedBeadHandoff | null>(null);
  const [resumed, setResumed] = useState(false);
  const [colorLibrary, setColorLibrary] =
    useState<WorkshopColorLibrary | null>(null);
  const [colorLibraryRefreshing, setColorLibraryRefreshing] =
    useState(false);
  const [previewColorMode, setPreviewColorMode] = useState<
    "source" | "print"
  >("source");
  const engineRef = useRef<BeadProcessingEngine | null>(null);
  const latestProjectRef = useRef<BeadProject | null>(null);
  const readyReportedRef = useRef(false);
  const visibleErrorCodeRef = useRef<string | null>(null);
  const saveAttemptRef = useRef(0);
  const colorLibraryRequestRef = useRef(0);
  const colorLibraryFlightRef =
    useRef<Promise<WorkshopColorLibrary | null> | null>(null);
  const handoffReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const handoffFlowActiveRef = useRef(false);
  const lifecycleEpochRef = useRef(0);
  const pickRequestRef = useRef(0);
  const processingEpochRef = useRef(0);
  const activeProcessingRef =
    useRef<ActiveProcessingTask | null>(null);
  const editorProject = editorState?.present ?? null;
  const workspaceRef = useRef<BeadWorkspaceState | null>(null);
  const workspaceBusyRef = useRef(true);
  const snapshotCommitRef = useRef<(() => void) | null>(null);
  const [, renderWorkspaceCommit] = useState(0);
  const previousWorkspaceRef = useRef<BeadWorkspaceState | null>(null);
  useLayoutEffect(() => {
    workspaceBusyRef.current = !initialized || stage === "loading" || isPicking || processingPhase !== "idle" || handoffBusy;
    if (!initialized || stage === "loading") return;
    const state: BeadWorkspaceState = { stage, editorState, originalRaster, workingRaster, projectSource, classification, calibrationDraft, crop, cropOpen, recalibrationSession, colorLibrary, previewColorMode };
    const previous = previousWorkspaceRef.current;
    workspaceRef.current = state;
    previousWorkspaceRef.current = state;
    if (snapshotCommitRef.current) {
      const resolve = snapshotCommitRef.current;
      snapshotCommitRef.current = null;
      resolve();
    } else if (previous && (previous.editorState !== editorState || previous.calibrationDraft !== calibrationDraft || previous.projectSource !== projectSource || previous.stage !== stage || previous.previewColorMode !== previewColorMode || previous.cropOpen !== cropOpen || JSON.stringify(previous.crop) !== JSON.stringify(crop))) {
      client.projectSnapshots.changed();
    }
  });
  const committedCalibration = editorProject?.calibration ?? null;
  const colorMapping = useMemo(
    () =>
      editorProject
        ? mapProjectToColorLibrary(editorProject, colorLibrary)
        : null,
    [colorLibrary, editorProject],
  );
  const hasCurrentPrintMapping =
    editorProject?.printMapping !== null &&
    editorProject?.printMapping !== undefined &&
    colorLibrary !== null &&
    editorProject.printMapping.libraryId === colorLibrary.id &&
    colorMapping?.stale === false;
  const calibrationRaster =
    recalibrationSession?.workingRaster ?? workingRaster;
  const calibrationCrop = recalibrationSession
    ? recalibrationSession.crop
    : crop;

  const getEngine = useCallback(() => {
    engineRef.current ??= createEngine();
    return engineRef.current;
  }, [createEngine]);

  const invalidateProcessing = useCallback(() => {
    processingEpochRef.current += 1;
    const active = activeProcessingRef.current;
    activeProcessingRef.current = null;
    if (active) engineRef.current?.cancel(active.id);
  }, []);

  useEffect(() => client.projectSnapshots.register({
    capture() {
      if (workspaceBusyRef.current || !workspaceRef.current) throw new Error("Finish the current image operation before saving this workspace");
      return { schemaVersion: BEAD_WORKSPACE_SCHEMA, state: structuredClone(workspaceRef.current) };
    },
    prepare: prepareBeadWorkspace,
    commit(value) {
      const state = value as BeadWorkspaceState;
      invalidateProcessing();
      pickRequestRef.current += 1;
      colorLibraryRequestRef.current += 1;
      colorLibraryFlightRef.current = null;
      setColorLibraryRefreshing(false);
      saveAttemptRef.current += 1;
      return new Promise<void>((resolve) => {
        snapshotCommitRef.current = resolve;
        renderWorkspaceCommit((value) => value + 1);
        setStage(state.stage);
        setEditorState(state.editorState);
        latestProjectRef.current = state.editorState?.present ?? null;
        setOriginalRaster(state.originalRaster); setWorkingRaster(state.workingRaster);
        setProjectSource(state.projectSource); setClassification(state.classification);
        setCalibrationDraft(state.calibrationDraft); setCrop(state.crop); setCropOpen(state.cropOpen);
        setRecalibrationSession(state.recalibrationSession);
        setColorLibrary(state.colorLibrary); setPreviewColorMode(state.previewColorMode);
        setHandoffSummary(null); setPendingReplacement(null); setHandoffBusy(false);
        handoffFlowActiveRef.current = false;
        setIsPicking(false); setProcessingPhase("idle"); setVisibleError(null);
        setInitialized(true); setResumed(false);
      });
    },
  }), [client, invalidateProcessing]);

  const isCurrentProcessing = useCallback(
    (token: ActiveProcessingTask) => {
      const active = activeProcessingRef.current;
      return (
        active?.epoch === token.epoch &&
        active.id === token.id &&
        processingEpochRef.current === token.epoch
      );
    },
    [],
  );

  const dispatchEditor = useCallback((action: BeadEditorAction) => {
    setEditorState((current) =>
      current ? beadEditorReducer(current, action) : current,
    );
  }, []);

  const clearVisibleError = useCallback(() => {
    visibleErrorCodeRef.current = null;
    setVisibleError(null);
    ignoreFailure(client.status.error(null));
  }, [client.status]);

  const reportProcessingError = useCallback(
    (code: string) => {
      const message = t("workshop.bead.processingError");
      visibleErrorCodeRef.current = code;
      setVisibleError(message);
      ignoreFailure(
        client.status.error({
          code,
          message,
          retryable: true,
        }),
      );
    },
    [client.status, t],
  );
  const reportProcessingErrorRef = useRef(reportProcessingError);

  useEffect(() => {
    reportProcessingErrorRef.current = reportProcessingError;
  }, [reportProcessingError]);

  const classifyRaster = useCallback(
    async (source: Raster, applySuggestion: boolean) => {
      invalidateProcessing();
      const engine = getEngine();
      const task = engine.classify(source);
      const token = {
        epoch: processingEpochRef.current,
        id: task.id,
      };
      activeProcessingRef.current = token;
      engine.cancelBefore(task.id);
      setProcessingPhase("classifying");
      ignoreFailure(
        client.status.progress({
          phase: "classify-pattern",
          completed: 0,
          total: 1,
        }),
      );
      try {
        const result = await task.promise;
        if (!isCurrentProcessing(token)) return;
        setClassification(result);
        if (applySuggestion) {
          const mode =
            result.mode === "ambiguous"
              ? "hard-pixel"
              : result.mode;
          setCalibrationDraft(draftForRaster(source, mode));
        }
      } catch {
        if (!isCurrentProcessing(token)) return;
        setClassification(null);
      } finally {
        if (!isCurrentProcessing(token)) return;
        activeProcessingRef.current = null;
        setProcessingPhase("idle");
        ignoreFailure(client.status.progress(null));
      }
    },
    [
      client.status,
      getEngine,
      invalidateProcessing,
      isCurrentProcessing,
    ],
  );

  const persistProject = useCallback(
    async (project: BeadProject) => {
      const attempt = saveAttemptRef.current + 1;
      saveAttemptRef.current = attempt;
      try {
        await saveBeadProject(client, project);
        if (saveAttemptRef.current !== attempt) return;
        if (visibleErrorCodeRef.current === "project-save-failed") {
          visibleErrorCodeRef.current = null;
          setVisibleError(null);
          ignoreFailure(client.status.error(null));
        }
      } catch {
        if (saveAttemptRef.current !== attempt) return;
        const message = t("workshop.bead.saveError");
        visibleErrorCodeRef.current = "project-save-failed";
        setVisibleError(message);
        ignoreFailure(
          client.status.error({
            code: "project-save-failed",
            message,
            retryable: true,
          }),
        );
      }
    },
    [client, t],
  );

  const refreshColorLibrary = useCallback(() => {
    if (colorLibraryFlightRef.current) {
      return colorLibraryFlightRef.current;
    }
    const requestId = colorLibraryRequestRef.current + 1;
    colorLibraryRequestRef.current = requestId;
    setColorLibraryRefreshing(true);
    const request = client.colorLibrary
      .read()
      .then((library) => {
        if (colorLibraryRequestRef.current === requestId) {
          setColorLibrary(library);
        }
        return library;
      })
      .catch(() => {
        if (colorLibraryRequestRef.current === requestId) {
          setColorLibrary(null);
        }
        return null;
      })
      .finally(() => {
        if (colorLibraryFlightRef.current === request) {
          colorLibraryFlightRef.current = null;
        }
        if (colorLibraryRequestRef.current === requestId) {
          setColorLibraryRefreshing(false);
        }
      });
    colorLibraryFlightRef.current = request;
    return request;
  }, [client]);

  useEffect(() => {
    void refreshColorLibrary();
    return () => {
      colorLibraryRequestRef.current += 1;
      colorLibraryFlightRef.current = null;
    };
  }, [refreshColorLibrary]);

  useEffect(() => {
    if (!projectSource || typeof URL.createObjectURL !== "function") {
      setSourceUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(projectSource.blob);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [projectSource]);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      try {
        const project = await latestBeadProject(client);
        if (cancelled) return;
        if (!project) {
          setStage("upload");
          setInitialized(true);
          return;
        }
        setEditorState(createBeadEditorState(project));
        setStage("editor");
        setResumed(true);
        latestProjectRef.current = project;
        setProjectSource(project.source);
        if (project.source) {
          try {
            const decoded = await imageCodec.decode(project.source.blob);
            if (cancelled) return;
            setOriginalRaster(decoded);
            setCrop(project.calibration.crop);
            setWorkingRaster(
              project.calibration.crop
                ? cropRaster(decoded, project.calibration.crop)
                : decoded,
            );
          } catch {
            setOriginalRaster(null);
            setWorkingRaster(null);
          }
        }
        if (!cancelled) setInitialized(true);
      } catch {
        if (cancelled) return;
        reportProcessingErrorRef.current("project-restore-failed");
        setStage("upload");
        setInitialized(true);
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [client, imageCodec]);

  useEffect(() => {
    if (!committedCalibration || !originalRaster) return;
    const committedCrop = committedCalibration.crop
      ? { ...committedCalibration.crop }
      : null;
    setCrop(committedCrop);
    setWorkingRaster(
      committedCrop
        ? cropRaster(originalRaster, committedCrop)
        : originalRaster,
    );
  }, [committedCalibration, originalRaster]);

  useEffect(() => {
    latestProjectRef.current = editorProject;
    if (!editorProject || !initialized) return undefined;
    const timer = window.setTimeout(() => {
      void persistProject(editorProject);
    }, autosaveDelayMs);
    return () => window.clearTimeout(timer);
  }, [
    autosaveDelayMs,
    editorProject,
    initialized,
    persistProject,
  ]);

  const unmountCleanupRef = useRef({
    status: client.status,
    persistProject,
  });

  useEffect(() => {
    unmountCleanupRef.current = {
      status: client.status,
      persistProject,
    };
  }, [client.status, persistProject]);

  useEffect(
    () => () => {
      lifecycleEpochRef.current += 1;
      invalidateProcessing();
      const { status, persistProject: persistLatestProject } =
        unmountCleanupRef.current;
      ignoreFailure(status.progress(null));
      const engine = engineRef.current;
      engineRef.current = null;
      engine?.dispose();
      const latest = latestProjectRef.current;
      if (latest) {
        const queued = queueCachedBeadProjectSave(client, latest);
        if (queued) {
          ignoreFailure(queued);
        } else {
          void persistLatestProject(latest);
        }
      }
    },
    [client, invalidateProcessing],
  );

  useEffect(() => {
    const flushLatestProject = () => {
      const latest = latestProjectRef.current;
      if (!latest) return;
      const queued = queueCachedBeadProjectSave(client, latest);
      if (queued) ignoreFailure(queued);
    };
    window.addEventListener("pagehide", flushLatestProject, {
      once: true,
    });
    return () =>
      window.removeEventListener("pagehide", flushLatestProject);
  }, [client]);

  useEffect(() => {
    if (
      previewColorMode === "print" &&
      !hasCurrentPrintMapping
    ) {
      setPreviewColorMode("source");
    }
  }, [hasCurrentPrintMapping, previewColorMode]);

  useEffect(() => {
    if (!initialized || !editorProject) return;
    ignoreFailure(
      client.status.diagnostics({
        projectSchemaVersion: editorProject.schemaVersion,
        inputMode: editorProject.calibration.inputMode,
        rows: editorProject.rows,
        columns: editorProject.columns,
        compression: editorProject.compression,
        errorCode: null,
      }),
    );
  }, [client.status, editorProject, initialized]);

  useEffect(() => {
    if (!initialized || readyReportedRef.current) return;
    readyReportedRef.current = true;
    ignoreFailure(client.lifecycle.ready());
  }, [client.lifecycle, initialized]);

  const preparePickedImage = async (
    picked: Awaited<ReturnType<typeof pickBeadSource>>,
  ) => {
    if (!picked) return;
    invalidateProcessing();
    setProcessingPhase("idle");
    setRecalibrationSession(null);
    setOriginalRaster(picked.raster);
    setWorkingRaster(picked.raster);
    setProjectSource(picked.source);
    setCrop(null);
    setClassification(null);
    setCalibrationDraft(draftForRaster(picked.raster, "hard-pixel"));
    setStage("calibration");
    await classifyRaster(picked.raster, true);
  };

  const handlePickImage = async () => {
    invalidateProcessing();
    const lifecycleEpoch = lifecycleEpochRef.current;
    const pickRequest = pickRequestRef.current + 1;
    pickRequestRef.current = pickRequest;
    const isCurrentPickRequest = () =>
      lifecycleEpochRef.current === lifecycleEpoch &&
      pickRequestRef.current === pickRequest;
    setProcessingPhase("idle");
    setIsPicking(true);
    clearVisibleError();
    setResumed(false);
    ignoreFailure(
      client.status.progress({
        phase: "pick-image",
        completed: 0,
        total: 1,
      }),
    );
    try {
      const picked = await pickBeadSource(client);
      if (!isCurrentPickRequest()) return;
      if (picked) {
        setIsPicking(false);
        await preparePickedImage(picked);
      } else {
        ignoreFailure(client.status.progress(null));
      }
    } catch {
      if (!isCurrentPickRequest()) return;
      const message = t("workshop.bead.pickerError");
      visibleErrorCodeRef.current = "image-pick-failed";
      setVisibleError(message);
      ignoreFailure(
        client.status.error({
          code: "image-pick-failed",
          message,
          retryable: true,
        }),
      );
      ignoreFailure(client.status.progress(null));
    } finally {
      if (isCurrentPickRequest()) {
        setIsPicking(false);
      }
    }
  };

  const handleCalibrationChange = (
    next: BeadCalibrationDraft,
  ) => {
    if (
      calibrationRaster &&
      calibrationDraft &&
      next.inputMode !== calibrationDraft.inputMode
    ) {
      setCalibrationDraft(
        draftForRaster(calibrationRaster, next.inputMode),
      );
      return;
    }
    setCalibrationDraft(next);
  };

  const applyCrop = (nextCrop: CropRect | null) => {
    if (!originalRaster) return;
    const shouldApplySuggestion = classification?.requiresCrop === true;
    const nextRaster = nextCrop
      ? cropRaster(originalRaster, nextCrop)
      : originalRaster;
    const nextDraft = calibrationDraft
      ? draftAfterCrop(
          nextRaster,
          calibrationDraft,
          calibrationCrop,
          nextCrop,
        )
      : draftForRaster(nextRaster, "hard-pixel");
    if (recalibrationSession) {
      setRecalibrationSession({
        workingRaster: nextRaster,
        crop: nextCrop ? { ...nextCrop } : null,
      });
    } else {
      setCrop(nextCrop);
      setWorkingRaster(nextRaster);
    }
    setClassification(null);
    setCalibrationDraft(nextDraft);
    setCropOpen(false);
    void classifyRaster(nextRaster, shouldApplySuggestion);
  };

  const handleFitSquareGrid = () => {
    if (!originalRaster || !calibrationDraft) return;
    applyCrop(
      squareFittedCrop(
        originalRaster,
        calibrationCrop,
        calibrationDraft,
      ),
    );
  };

  const handleReturnToCalibration = () => {
    const project = editorState?.present;
    if (!project || !originalRaster || !project.source) return;
    invalidateProcessing();
    setProcessingPhase("idle");
    ignoreFailure(client.status.progress(null));
    const committedCrop = project.calibration.crop
      ? { ...project.calibration.crop }
      : null;
    const committedRaster = committedCrop
      ? cropRaster(originalRaster, committedCrop)
      : originalRaster;
    setRecalibrationSession({
      workingRaster: committedRaster,
      crop: committedCrop,
    });
    setCalibrationDraft(draftFromProject(committedRaster, project));
    setClassification(null);
    setCropOpen(false);
    clearVisibleError();
    setResumed(false);
    setStage("calibration");
    void classifyRaster(committedRaster, false);
  };

  const handleReturnToEditor = () => {
    invalidateProcessing();
    setProcessingPhase("idle");
    ignoreFailure(client.status.progress(null));
    setRecalibrationSession(null);
    setCalibrationDraft(null);
    setClassification(null);
    setCropOpen(false);
    setStage("editor");
  };

  const handleRecognize = async () => {
    if (!calibrationRaster || !calibrationDraft) return;
    const source = calibrationRaster;
    const draft = calibrationDraft;
    const previousProject = recalibrationSession
      ? editorState?.present ?? null
      : null;
    const activeCrop = calibrationCrop
      ? { ...calibrationCrop }
      : null;
    invalidateProcessing();
    const engine = getEngine();
    const task = engine.recognize({
      source,
      mode: draft.inputMode,
      rows: draft.rows,
      columns: draft.columns,
      geometry: draft.geometry,
      emptySelection:
        draft.emptySelection ?? { kind: "none" },
      orientation: draft.orientation,
    });
    const token = {
      epoch: processingEpochRef.current,
      id: task.id,
    };
    activeProcessingRef.current = token;
    engine.cancelBefore(task.id);
    setProcessingPhase("recognizing");
    clearVisibleError();
    ignoreFailure(
      client.status.progress({
        phase: "recognize-pattern",
        completed: 0,
        total: 1,
      }),
    );
    try {
      const result = await task.promise;
      if (!isCurrentProcessing(token)) return;
      const now = previousProject
        ? timestampAfter(previousProject.updatedAt)
        : new Date().toISOString();
      const recognized = createBeadProject({
        projectId:
          previousProject?.projectId ?? generatedProjectId(),
        moduleVersion:
          previousProject?.moduleVersion ?? BEAD_MODULE_VERSION,
        now,
        rows: result.rows,
        columns: result.columns,
        palette:
          result.palette.length > 0
            ? result.palette
            : [[0, 0, 0]],
        cells: result.cells,
        source: previousProject?.source ?? projectSource,
        calibration: {
          inputMode: result.mode,
          crop: activeCrop,
          origin: {
            x: draft.geometry.originX,
            y: draft.geometry.originY,
          },
          orientation: { ...draft.orientation },
          emptySelection:
            draft.emptySelection ?? { kind: "none" },
        },
        confidenceIssues: result.confidenceIssues,
        beadPitchMm: previousProject?.beadPitchMm,
        compression: previousProject?.compression,
        irregularity: previousProject?.irregularity,
        ...(previousProject ? { printMapping: null } : {}),
      });
      const project = previousProject
        ? validateBeadProject({
            ...recognized,
            createdAt: previousProject.createdAt,
          })
        : recognized;
      if (previousProject) {
        setEditorState((current) =>
          current
            ? beadEditorReducer(current, {
                type: "replace-project",
                project,
              })
            : current,
        );
      } else {
        setEditorState(createBeadEditorState(project));
      }
      setRecalibrationSession(null);
      setCalibrationDraft(null);
      setClassification(null);
      setCropOpen(false);
      setStage("editor");
      setResumed(false);
      latestProjectRef.current = project;
    } catch (error) {
      if (!isCurrentProcessing(token)) return;
      if (previousProject) {
        setRecalibrationSession(null);
        setCalibrationDraft(null);
        setClassification(null);
        setCropOpen(false);
        setStage("editor");
      }
      if (!isCancellation(error)) {
        reportProcessingError("pattern-recognition-failed");
      }
    } finally {
      if (!isCurrentProcessing(token)) return;
      activeProcessingRef.current = null;
      setProcessingPhase("idle");
      ignoreFailure(client.status.progress(null));
    }
  };

  const reportHandoffError = (error?: unknown) => {
    const message = t("workshop.bead.handoffError");
    const hostCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "";
    const code = /size|quota|payload|too.large/i.test(hostCode)
      ? "bead-handoff-size-or-quota-rejected"
      : "bead-handoff-failed";
    visibleErrorCodeRef.current = code;
    setVisibleError(message);
    ignoreFailure(
      client.status.error({
        code,
        message,
        retryable: true,
      }),
    );
  };

  const sendHandoff = async (handoff: PreparedBeadHandoff) =>
    handoffPreparedBeadImage(client, handoff);

  useEffect(() => {
    if (
      !handoffFlowActiveRef.current ||
      handoffBusy ||
      handoffSummary !== null ||
      pendingReplacement !== null
    ) {
      return;
    }

    handoffFlowActiveRef.current = false;
    const returnFocusTarget = handoffReturnFocusRef.current;
    handoffReturnFocusRef.current = null;
    queueMicrotask(() => {
      if (
        returnFocusTarget?.isConnected &&
        !returnFocusTarget.disabled
      ) {
        returnFocusTarget.focus();
      }
    });
  }, [handoffBusy, handoffSummary, pendingReplacement]);

  const handleHandoff = async (returnFocusTarget: HTMLButtonElement) => {
    const project = editorState?.present;
    if (
      !project ||
      !project.cells.some((cell) => cell.kind === "color")
    ) {
      reportHandoffError();
      return;
    }

    handoffReturnFocusRef.current = returnFocusTarget;
    handoffFlowActiveRef.current = true;
    setHandoffBusy(true);
    clearVisibleError();
    ignoreFailure(
      client.status.progress({
        phase: "render-handoff",
        completed: 0,
        total: 1,
      }),
    );
    try {
      const handoffProject =
        project.canvasMode === "auto-expand"
          ? trimEmptyBorder(project)
          : project;
      const engine = getEngine();
      const task = engine.render(
        handoffProject,
        handoffProject.compression,
        32,
      );
      engine.cancelBefore(task.id);
      const raster = await task.promise;
      const handoff = await prepareBeadHandoff(
        handoffProject,
        raster,
        imageCodec,
        hasCurrentPrintMapping
          ? project.printMapping?.libraryId ?? null
          : null,
      );
      setHandoffSummary({
        handoff,
        compression: project.compression,
        irregularity: project.irregularity ?? 0,
        libraryLabel: hasCurrentPrintMapping
          ? project.printMapping?.libraryLabel ?? null
          : null,
      });
    } catch (error) {
      if (!isCancellation(error)) reportHandoffError(error);
    } finally {
      setHandoffBusy(false);
      ignoreFailure(client.status.progress(null));
    }
  };

  const submitHandoff = async () => {
    if (!handoffSummary) return;
    setHandoffBusy(true);
    clearVisibleError();
    ignoreFailure(
      client.status.progress({
        phase: "handoff-image",
        completed: 0,
        total: 1,
      }),
    );
    try {
      const result = await sendHandoff(handoffSummary.handoff);
      setPendingReplacement(
        result.status === "needs-confirmation"
          ? handoffSummary.handoff
          : null,
      );
      setHandoffSummary(null);
    } catch (error) {
      reportHandoffError(error);
    } finally {
      setHandoffBusy(false);
      ignoreFailure(client.status.progress(null));
    }
  };

  const confirmReplacement = async () => {
    if (!pendingReplacement) return;
    setHandoffBusy(true);
    clearVisibleError();
    try {
      await sendHandoff(pendingReplacement);
      setPendingReplacement(null);
    } catch (error) {
      reportHandoffError(error);
    } finally {
      setHandoffBusy(false);
    }
  };

  const refreshPrintMapping = () => {
    const project = editorState?.present;
    if (!project || !colorLibrary) return;
    const mapped = mapProjectToColorLibrary(
      { ...project, printMapping: null },
      colorLibrary,
    );
    dispatchEditor({
      type: "set-print-mapping",
      printMapping: mapped.printMapping,
      updatedAt: new Date().toISOString(),
    });
    if (mapped.printMapping) setPreviewColorMode("print");
  };

  const setPrintMappingEntry = (
    sourcePaletteIndex: number,
    colorEntryId: string,
  ) => {
    if (!colorLibrary || !colorMapping?.printMapping) return;
    const next = setManualColorMapping(
      colorMapping.printMapping,
      colorLibrary,
      sourcePaletteIndex,
      colorEntryId,
    );
    dispatchEditor({
      type: "set-print-mapping",
      printMapping: next,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleCreateBlankProject = () => {
    invalidateProcessing();
    engineRef.current?.cancelBefore(Number.MAX_SAFE_INTEGER);
    setProcessingPhase("idle");
    ignoreFailure(client.status.progress(null));
    const now = new Date().toISOString();
    const project = createBeadProject({
      projectId: generatedProjectId(),
      moduleVersion: BEAD_MODULE_VERSION,
      now,
      rows: AUTO_EXPAND_CANVAS_INITIAL_SIZE,
      columns: AUTO_EXPAND_CANVAS_INITIAL_SIZE,
      palette: [[0, 0, 0]],
      source: null,
      canvasMode: "auto-expand",
    });
    setEditorState(createBeadEditorState(project));
    setStage("editor");
    setClassification(null);
    setCalibrationDraft(null);
    setOriginalRaster(null);
    setWorkingRaster(null);
    setProjectSource(null);
    setCrop(null);
    setCropOpen(false);
    setRecalibrationSession(null);
    setHandoffSummary(null);
    setPendingReplacement(null);
    setHandoffBusy(false);
    clearVisibleError();
    setResumed(false);
    setPreviewColorMode("source");
    latestProjectRef.current = project;
  };

  const handleNewProject = () => {
    const latest = latestProjectRef.current;
    if (latest) void persistProject(latest);
    invalidateProcessing();
    engineRef.current?.cancelBefore(Number.MAX_SAFE_INTEGER);
    setProcessingPhase("idle");
    ignoreFailure(client.status.progress(null));
    setEditorState(null);
    setStage("upload");
    setClassification(null);
    setCalibrationDraft(null);
    setOriginalRaster(null);
    setWorkingRaster(null);
    setProjectSource(null);
    setCrop(null);
    setCropOpen(false);
    setRecalibrationSession(null);
    setHandoffSummary(null);
    setPendingReplacement(null);
    setHandoffBusy(false);
    clearVisibleError();
    setResumed(false);
    setPreviewColorMode("source");
    latestProjectRef.current = null;
  };

  return (
    <main
      className={`module-shell${
        stage === "editor" ? " module-shell--editor" : ""
      }`}
    >
      <div
        className={`workbench-stack${
          stage === "editor" ? " workbench-stack--editor" : ""
        }`}
      >
        {visibleError ? (
          <StatusBanner tone="error">{visibleError}</StatusBanner>
        ) : null}
        {resumed && stage === "editor" ? (
          <StatusBanner tone="success">
            {t("workshop.bead.resumeReady")}
          </StatusBanner>
        ) : null}

        {stage === "loading" ? (
          <section className="panel panel--controls">
            <StatusBanner>
              {t("workshop.bead.loadingProject")}
            </StatusBanner>
          </section>
        ) : null}

        {stage === "upload" ? (
          <>
            <PanelIntro
              eyebrow="Lumina"
              title={t("app.name")}
              description={t("workshop.bead.intro")}
            />
            <section
              className={`${mutedSectionCardClass} panel--controls`}
            >
              <div>
                <p className="review-summary">
                  {t("workshop.bead.supportedInputs")}
                </p>
                <p className="sample-summary">
                  {t("workshop.bead.localPrivacy")}
                </p>
                <p className="sample-summary">
                  {t("workshop.bead.blankCanvasHint")}
                </p>
              </div>
              <Button
                label={t("workshop.bead.choosePattern")}
                loading={isPicking}
                onClick={handlePickImage}
              />
              <Button
                label={t("workshop.bead.createBlankCanvas")}
                variant="secondary"
                onClick={handleCreateBlankProject}
              />
            </section>
          </>
        ) : null}

        {stage === "calibration" &&
        calibrationRaster &&
        calibrationDraft ? (
          <BeadCalibrationStep
            source={calibrationRaster}
            fileName={projectSource?.fileName ?? ""}
            classification={classification}
            draft={calibrationDraft}
            busy={processingPhase === "recognizing"}
            classificationBusy={
              processingPhase === "classifying"
            }
            translate={t}
            onChange={handleCalibrationChange}
            onRecognize={handleRecognize}
            onOpenCrop={() => setCropOpen(true)}
            onFitSquareGrid={handleFitSquareGrid}
            onReturnToEditor={
              recalibrationSession
                ? handleReturnToEditor
                : undefined
            }
            canCrop={Boolean(sourceUrl)}
          />
        ) : null}

        {stage === "editor" && editorState ? (
          <BeadEditorStep
            state={editorState}
            sourceRaster={workingRaster}
            translate={t}
            dispatch={dispatchEditor}
            onNewProject={handleNewProject}
            onReturnCalibration={handleReturnToCalibration}
            onHandoff={handleHandoff}
            handoffBusy={handoffBusy}
            colorLibrary={colorLibrary}
            colorLibraryRefreshing={colorLibraryRefreshing}
            printMapping={editorProject?.printMapping ?? null}
            printMappingStale={colorMapping?.stale ?? false}
            previewColorMode={previewColorMode}
            displayPalette={
              previewColorMode === "print" &&
              hasCurrentPrintMapping
                ? colorMapping?.previewPalette ?? null
                : null
            }
            onPreviewColorModeChange={setPreviewColorMode}
            onReloadColorLibrary={refreshColorLibrary}
            onRefreshPrintMapping={refreshPrintMapping}
            onSetPrintMappingEntry={setPrintMappingEntry}
          />
        ) : null}

        <BeadHandoffSummaryDialog
          open={handoffSummary !== null}
          busy={handoffBusy}
          rows={handoffSummary?.handoff.base.layout?.rows ?? 0}
          columns={
            handoffSummary?.handoff.base.layout?.columns ?? 0
          }
          compression={handoffSummary?.compression ?? 0}
          irregularity={handoffSummary?.irregularity ?? 0}
          widthMm={
            handoffSummary?.handoff.base.recommendedWidthMm ?? 0
          }
          heightMm={
            handoffSummary?.handoff.base.recommendedHeightMm ?? 0
          }
          thicknessMm={
            handoffSummary?.handoff.base
              .recommendedTotalThicknessMm ?? 0
          }
          libraryLabel={handoffSummary?.libraryLabel ?? null}
          translate={t}
          onCancel={() => setHandoffSummary(null)}
          onConfirm={submitHandoff}
        />

        <BeadHandoffConfirmDialog
          open={pendingReplacement !== null}
          busy={handoffBusy}
          translate={t}
          onCancel={() => setPendingReplacement(null)}
          onConfirm={confirmReplacement}
        />

        {sourceUrl && originalRaster ? (
          <CropModal
            open={cropOpen}
            imageSrc={sourceUrl}
            imageWidth={originalRaster.width}
            imageHeight={originalRaster.height}
            initialCrop={calibrationCrop}
            busy={processingPhase !== "idle"}
            translate={t}
            onConfirm={(cropData) =>
              applyCrop(normalizedCrop(originalRaster, cropData))
            }
            onUseOriginal={() => applyCrop(null)}
            onClose={() => setCropOpen(false)}
          />
        ) : null}
      </div>
    </main>
  );
}
