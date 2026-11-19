import type { WorkshopColorLibrary } from "@lumina/workshop-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  BeadEditorAction,
  BeadEditorState,
  BeadEditorTool,
} from "../domain/editorReducer";
import {
  expandBrushFootprint,
  type BeadBrushSize,
} from "../domain/gridBrush";
import { estimateBeadThicknessMm } from "../domain/beadThickness";
import {
  calculatePhysicalSize,
  trimEmptyBorder,
} from "../domain/project";
import type {
  BeadPrintMapping,
  Raster,
  RgbColor,
} from "../domain/types";
import { interpolate } from "../i18n/translations";
import Button from "../ui/Button";
import Checkbox from "../ui/Checkbox";
import HelpDot from "../ui/HelpDot";
import Slider from "../ui/Slider";
import {
  StatusBanner,
  cx,
  settingsWellClass,
  workstationInputClass,
} from "../ui/panelPrimitives";
import { BeadEditorWorkspace } from "./BeadEditorWorkspace";
import { BeadCanvasViewport } from "./BeadCanvasViewport";
import { BeadPaletteStrip } from "./BeadPaletteStrip";
import { BeadMatrixCanvas } from "./BeadMatrixCanvas";
import { BeadFusionPreview } from "./BeadFusionPreview";
import { BeadSourceCanvas } from "./BeadSourceCanvas";
import {
  BeadThreePreview,
  MAX_THREE_PREVIEW_BEADS,
  supportsBeadThreePreviewCount,
} from "./BeadThreePreview";

type AuxiliaryView = "original" | "matrix" | "pressure";
type WorkbenchMode = "edit" | "fusion" | "print";

interface BeadEditorStepProps {
  state: BeadEditorState;
  sourceRaster: Raster | null;
  translate(key: string): string;
  dispatch(action: BeadEditorAction): void;
  onNewProject(): void;
  onReturnCalibration?(): void;
  onHandoff?(trigger: HTMLButtonElement): void;
  handoffBusy?: boolean;
  colorLibrary?: WorkshopColorLibrary | null;
  colorLibraryRefreshing?: boolean;
  printMapping?: BeadPrintMapping | null;
  printMappingStale?: boolean;
  previewColorMode?: "source" | "print";
  displayPalette?: RgbColor[] | null;
  onPreviewColorModeChange?(mode: "source" | "print"): void;
  onReloadColorLibrary?(): void;
  onRefreshPrintMapping?(): void;
  onSetPrintMappingEntry?(
    sourcePaletteIndex: number,
    colorEntryId: string,
  ): void;
}

function formatMillimeters(value: number): string {
  return Number(value.toFixed(3)).toString();
}

const TOOL_SHORTCUT_KEY: Record<BeadEditorTool, string> = {
  paint: "B",
  erase: "E",
  eraseFill: "X",
  eyedropper: "I",
  fill: "G",
};

function EraserBrushGlyph({ size }: { size: BeadBrushSize }) {
  const dots: Array<readonly [number, number]> =
    size === 1
      ? [[8, 8]]
      : size === 2
        ? [
            [5.2, 5.2],
            [10.8, 5.2],
            [5.2, 10.8],
            [10.8, 10.8],
          ]
        : [
            [3.6, 3.6],
            [8, 3.6],
            [12.4, 3.6],
            [3.6, 8],
            [8, 8],
            [12.4, 8],
            [3.6, 12.4],
            [8, 12.4],
            [12.4, 12.4],
          ];
  const radius = size === 1 ? 3 : size === 2 ? 2.1 : 1.5;
  return (
    <svg
      aria-hidden="true"
      className="bead-editor-eraser-glyph"
      data-size={size}
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      {dots.map(([cx, cy], index) => (
        <circle key={index} cx={cx} cy={cy} r={radius} />
      ))}
    </svg>
  );
}

function EditorToolIcon({ tool }: { tool: BeadEditorTool }) {
  const commonProps = {
    "aria-hidden": true,
    className: "editor-tool-button__icon",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.75,
    viewBox: "0 0 24 24",
  };

  if (tool === "paint") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="7.5" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    );
  }
  if (tool === "erase") {
    return (
      <svg {...commonProps}>
        <path d="m5 15.5 7.8-7.8a2 2 0 0 1 2.8 0l2.7 2.7a2 2 0 0 1 0 2.8L12.5 19H8.4L5 15.5Z" />
        <path d="m10.5 10 5.5 5.5M12.5 19H20" />
      </svg>
    );
  }
  if (tool === "eraseFill") {
    return (
      <svg {...commonProps}>
        <rect x="4.5" y="4.5" width="6" height="6" rx="1.5" strokeDasharray="2.5 2" />
        <rect x="13.5" y="4.5" width="6" height="6" rx="1.5" strokeDasharray="2.5 2" />
        <path d="m9 15 6 6m0-6-6 6" />
      </svg>
    );
  }
  if (tool === "eyedropper") {
    return (
      <svg {...commonProps}>
        <path d="m14.5 5.5 4 4M7 17l8.8-8.8M5 19l2-2 3 3-2 2H5v-3Z" />
        <path d="m13.5 5.5 1.2-1.2a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8l-1.2 1.2" />
      </svg>
    );
  }
  return (
    <svg {...commonProps}>
      <path d="m4.5 12 7.3-7.3 7.5 7.5-7.3 7.3L4.5 12Z" />
      <path d="M19 15.5c0 1.5 1.8 2.4 1.8 3.7a1.8 1.8 0 0 1-3.6 0c0-1.3 1.8-2.2 1.8-3.7Z" />
    </svg>
  );
}

export function BeadEditorStep({
  state,
  sourceRaster,
  translate: t,
  dispatch,
  onNewProject,
  onReturnCalibration,
  onHandoff,
  handoffBusy = false,
  colorLibrary = null,
  colorLibraryRefreshing = false,
  printMapping = null,
  printMappingStale = false,
  previewColorMode = "source",
  displayPalette = null,
  onPreviewColorModeChange,
  onReloadColorLibrary,
  onRefreshPrintMapping,
  onSetPrintMappingEntry,
}: BeadEditorStepProps) {
  const [workbenchMode, setWorkbenchMode] =
    useState<WorkbenchMode>("edit");
  const [auxiliaryView, setAuxiliaryView] =
    useState<AuxiliaryView>("matrix");
  const [auxiliaryExpanded, setAuxiliaryExpanded] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [eraserSize, setEraserSize] = useState<BeadBrushSize>(1);
  const project = state.present;
  const projectTitle =
    project.source?.fileName?.trim() ||
    t("workshop.bead.workspace.untitled");
  const outputProject = useMemo(
    () =>
      project.canvasMode === "auto-expand"
        ? trimEmptyBorder(project)
        : project,
    [project],
  );
  const unresolvedIssueIndices = useMemo(
    () =>
      project.confidenceIssues.flatMap((issue, index) =>
        issue.resolved ? [] : [index],
      ),
    [project.confidenceIssues],
  );
  const selectedPendingPosition = unresolvedIssueIndices.indexOf(
    state.selectedIssueIndex ?? -1,
  );
  const size = calculatePhysicalSize(
    outputProject,
    project.beadPitchMm,
  );
  const estimatedThicknessMm = estimateBeadThicknessMm(
    project.compression,
    project.beadPitchMm,
  );
  const hasColoredBeads = useMemo(
    () => project.cells.some((cell) => cell.kind === "color"),
    [project.cells],
  );
  const coloredBeadCount = useMemo(
    () =>
      project.cells.reduce(
        (count, cell) => count + (cell.kind === "color" ? 1 : 0),
        0,
      ),
    [project.cells],
  );
  const supportsThreePreview = supportsBeadThreePreviewCount(
    coloredBeadCount,
  );
  const hasCurrentPrintMapping =
    colorLibrary !== null &&
    printMapping !== null &&
    printMapping.libraryId === colorLibrary.id &&
    !printMappingStale;
  const displayProject = useMemo(
    () =>
      displayPalette
        ? {
            ...project,
            palette: displayPalette.map(
              (color) => [...color] as RgbColor,
            ),
          }
        : project,
    [displayPalette, project],
  );
  const mappingByPaletteIndex = useMemo(
    () =>
      new Map(
        printMapping?.entries.map((entry) => [
          entry.sourcePaletteIndex,
          entry.colorEntryId,
        ]) ?? [],
      ),
    [printMapping],
  );
  const libraryEntryById = useMemo(
    () =>
      new Map(
        colorLibrary?.colors.map((entry) => [entry.id, entry]) ?? [],
      ),
    [colorLibrary],
  );

  const selectIssue = (direction: -1 | 1) => {
    if (unresolvedIssueIndices.length === 0) return;
    const next =
      selectedPendingPosition < 0
        ? direction < 0
          ? unresolvedIssueIndices.length - 1
          : 0
        : (selectedPendingPosition +
            direction +
            unresolvedIssueIndices.length) %
          unresolvedIssueIndices.length;
    dispatch({
      type: "select-issue",
      issueIndex: unresolvedIssueIndices[next],
    });
  };

  const applyAt = (cellIndex: number) => {
    const cellIndices =
      state.activeTool === "erase" && eraserSize > 1
        ? expandBrushFootprint(
            project.rows,
            project.columns,
            cellIndex,
            eraserSize,
          )
        : undefined;
    dispatch({
      type: "apply-tool",
      tool: state.activeTool,
      cellIndex,
      ...(cellIndices ? { cellIndices } : {}),
      paletteIndex: state.activePaletteIndex,
      updatedAt: new Date().toISOString(),
    });
  };

  const applyAtCells = (
    cellIndices: readonly number[],
    strokeId?: string,
  ) => {
    if (cellIndices.length === 0) return;
    dispatch({
      type: "apply-tool",
      tool: state.activeTool,
      cellIndex: cellIndices[cellIndices.length - 1]!,
      cellIndices,
      paletteIndex: state.activePaletteIndex,
      ...(strokeId ? { strokeId } : {}),
      updatedAt: new Date().toISOString(),
    });
  };

  useEffect(() => {
    if (workbenchMode !== "edit") return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector(".dialog-scrim") !== null) {
        return;
      }

      const modKey = event.metaKey || event.ctrlKey;
      const lowerKey = event.key.toLowerCase();
      if (modKey && !event.altKey) {
        if (lowerKey === "z" && !event.shiftKey) {
          event.preventDefault();
          if (state.past.length > 0) {
            dispatch({ type: "undo" });
          }
          return;
        }
        if (
          (lowerKey === "z" && event.shiftKey) ||
          (lowerKey === "y" && !event.shiftKey)
        ) {
          event.preventDefault();
          if (state.future.length > 0) {
            dispatch({ type: "redo" });
          }
          return;
        }
        return;
      }

      if (modKey || event.altKey) return;
      if (lowerKey === "b") {
        dispatch({ type: "set-tool", tool: "paint" });
      } else if (lowerKey === "e") {
        dispatch({ type: "set-tool", tool: "erase" });
      } else if (lowerKey === "x") {
        dispatch({ type: "set-tool", tool: "eraseFill" });
      } else if (lowerKey === "i") {
        dispatch({ type: "set-tool", tool: "eyedropper" });
      } else if (lowerKey === "g") {
        dispatch({ type: "set-tool", tool: "fill" });
      } else if (event.key === "[" && state.activeTool === "erase") {
        setEraserSize((prev) => (prev === 3 ? 2 : 1));
      } else if (event.key === "]" && state.activeTool === "erase") {
        setEraserSize((prev) => (prev === 1 ? 2 : 3));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    dispatch,
    state.activeTool,
    state.future.length,
    state.past.length,
    workbenchMode,
  ]);

  const sourceGeometry = sourceRaster
    ? {
        originX: 0,
        originY: 0,
        cellWidth: sourceRaster.width / project.columns,
        cellHeight: sourceRaster.height / project.rows,
      }
    : null;

  const toolNames: BeadEditorTool[] = [
    "paint",
    "erase",
    "eraseFill",
    "eyedropper",
    "fill",
  ];

  const renderAuxiliaryCanvas = () => {
    if (auxiliaryView === "original" && sourceRaster && sourceGeometry) {
      return (
        <BeadSourceCanvas
          source={sourceRaster}
          rows={project.rows}
          columns={project.columns}
          geometry={sourceGeometry}
          ariaLabel={t("workshop.bead.originalCanvas")}
        />
      );
    }
    if (auxiliaryView === "pressure") {
      return (
        <BeadFusionPreview
          project={displayProject}
          ariaLabel={t("workshop.bead.pressureCanvas")}
        />
      );
    }
    return (
      <BeadMatrixCanvas
        project={displayProject}
        showGrid={showGrid}
        selectedCellIndex={state.selectedCellIndex}
        onPickCell={
          auxiliaryExpanded && workbenchMode === "edit"
            ? applyAt
            : undefined
        }
        onPickCells={
          auxiliaryExpanded && workbenchMode === "edit"
            ? applyAtCells
            : undefined
        }
        brushSize={state.activeTool === "erase" ? eraserSize : 1}
        allowDrag={
          auxiliaryExpanded &&
          workbenchMode === "edit" &&
          (state.activeTool === "paint" || state.activeTool === "erase")
        }
        ariaLabel={t("workshop.bead.matrixCanvas")}
      />
    );
  };

  const previewColorControls = (
    <div className="bead-editor-preview-colors">
      <span className="field-label">
        {t("workshop.bead.printMappingTitle")}
      </span>
      <div className="bead-editor-inline-segmented">
        <button
          type="button"
          className="segmented-control selection-control"
          aria-pressed={previewColorMode === "source"}
          onClick={() => onPreviewColorModeChange?.("source")}
        >
          {t("workshop.bead.preview.source")}
        </button>
        <button
          type="button"
          className="segmented-control selection-control"
          aria-pressed={previewColorMode === "print"}
          disabled={!hasCurrentPrintMapping}
          onClick={() => onPreviewColorModeChange?.("print")}
        >
          {t("workshop.bead.preview.print")}
        </button>
      </div>
    </div>
  );

  const eraserSizeControls =
    state.activeTool === "erase" ? (
      <>
        <div
          className="bead-editor-eraser-sizes"
          role="group"
          aria-label={t("workshop.bead.eraserSize")}
        >
          <span className="field-label">
            {t("workshop.bead.eraserSize")}
          </span>
          <div className="bead-editor-inline-segmented">
            {([1, 2, 3] as const).map((sizeOption) => (
              <button
                key={sizeOption}
                type="button"
                className="segmented-control selection-control bead-editor-eraser-size-btn"
                aria-label={t(`workshop.bead.eraserSize${sizeOption}`)}
                aria-pressed={eraserSize === sizeOption}
                onClick={() => setEraserSize(sizeOption)}
              >
                <EraserBrushGlyph size={sizeOption} />
                <span>
                  {sizeOption}×{sizeOption}
                </span>
              </button>
            ))}
          </div>
        </div>
        <span className="bead-editor-palette-divider" aria-hidden="true" />
      </>
    ) : null;

  const handlePaletteColorLabel = useCallback(
    (index: number) =>
      interpolate(t("workshop.bead.paletteColor"), { index: index + 1 }),
    [t],
  );
  const handlePaletteSelect = useCallback(
    (paletteIndex: number) =>
      dispatch({ type: "set-palette", paletteIndex }),
    [dispatch],
  );
  const handlePaletteAdd = useCallback(
    (color: RgbColor) =>
      dispatch({
        type: "add-palette-color",
        color,
        updatedAt: new Date().toISOString(),
      }),
    [dispatch],
  );

  const paletteControls = (
    <div className="bead-editor-mode-content bead-editor-mode-content--edit">
      {eraserSizeControls}
      {previewColorControls}
      <span className="bead-editor-palette-divider" aria-hidden="true" />
      <BeadPaletteStrip
        colors={project.palette}
        activeIndex={state.activePaletteIndex}
        label={t("workshop.bead.paletteTitle")}
        colorLabel={handlePaletteColorLabel}
        previousLabel={t("workshop.bead.palettePrevious")}
        nextLabel={t("workshop.bead.paletteNext")}
        addLabel={t("workshop.bead.customColor")}
        onSelect={handlePaletteSelect}
        onAdd={handlePaletteAdd}
      />
    </div>
  );

  const fusionControls = (
    <div className="bead-editor-inspector">
      <div className={settingsWellClass}>
        <Slider
          label={t("workshop.bead.compression")}
          tooltip={t("workshop.bead.compressionHint")}
          value={project.compression}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(compression) =>
            dispatch({
              type: "set-compression",
              compression,
              updatedAt: new Date().toISOString(),
            })
          }
        />
        <div className="control-grid control-grid--three">
          {(
            [
              [0, "workshop.bead.pressureLight"],
              [50, "workshop.bead.pressureStandard"],
              [100, "workshop.bead.pressureTight"],
            ] as const
          ).map(([compression, key]) => (
            <button
              key={compression}
              type="button"
              aria-pressed={project.compression === compression}
              className="segmented-control selection-control"
              onClick={() =>
                dispatch({
                  type: "set-compression",
                  compression,
                  updatedAt: new Date().toISOString(),
                })
              }
            >
              {t(key)}
            </button>
          ))}
        </div>
      </div>

      <div className={settingsWellClass}>
        <Slider
          label={t("workshop.bead.irregularity")}
          tooltip={t("workshop.bead.irregularityHint")}
          value={project.irregularity ?? 0}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(irregularity) =>
            dispatch({
              type: "set-irregularity",
              irregularity,
              updatedAt: new Date().toISOString(),
            })
          }
        />
      </div>

      <div className={settingsWellClass}>
        <h2 className="settings-well__heading">
          {t("workshop.bead.fusionSectionSpecs")}
        </h2>
        <label className="field bead-editor-pitch-field">
          <span className="label-with-help">
            <span className="field-label">{t("workshop.bead.beadPitch")}</span>
            <HelpDot
              title={t("workshop.bead.beadPitch")}
              description={t("workshop.bead.beadPitchHint")}
            />
          </span>
          <input
            aria-label={t("workshop.bead.beadPitch")}
            type="number"
            min={0.5}
            max={10}
            step={0.1}
            value={project.beadPitchMm}
            className={cx(workstationInputClass, "field-input--card")}
            onChange={(event) =>
              dispatch({
                type: "set-bead-pitch",
                beadPitchMm: Number(event.target.value),
                updatedAt: new Date().toISOString(),
              })
            }
          />
        </label>
        <div className="bead-editor-size-summary">
          <p className="physical-size">
            {interpolate(t("workshop.bead.physicalSize"), {
              width: formatMillimeters(size.widthMm),
              height: formatMillimeters(size.heightMm),
            })}
          </p>
          <p className="sample-summary">
            {interpolate(t("workshop.bead.estimatedThickness"), {
              thickness: formatMillimeters(estimatedThicknessMm),
            })}
          </p>
        </div>
      </div>
    </div>
  );

  const printControls = (
    <div className="bead-editor-inspector">
      <div className={settingsWellClass}>
        {previewColorControls}
      </div>

      <div className={cx(settingsWellClass, "bead-editor-print-status")}>
        <h2 className="settings-well__heading">
          {t("workshop.bead.printSectionLibrary")}
        </h2>
        {colorLibrary ? (
          <p className="sample-summary">
            {interpolate(t("workshop.bead.printLibraryLabel"), {
              label: colorLibrary.label,
            })}
          </p>
        ) : (
          <>
            <StatusBanner>
              {t("workshop.bead.printLibraryUnavailable")}
            </StatusBanner>
            <Button
              label={t("workshop.bead.reloadPrintLibrary")}
              variant="secondary"
              size="small"
              loading={colorLibraryRefreshing}
              onClick={onReloadColorLibrary}
            />
          </>
        )}
        {colorLibrary && !printMapping ? (
          <Button
            label={t("workshop.bead.createPrintMapping")}
            variant="secondary"
            size="small"
            onClick={onRefreshPrintMapping}
          />
        ) : null}
        {colorLibrary && printMappingStale ? (
          <>
            <StatusBanner tone="warning">
              {t("workshop.bead.printMappingStale")}
            </StatusBanner>
            <Button
              label={t("workshop.bead.refreshPrintMapping")}
              variant="secondary"
              size="small"
              onClick={onRefreshPrintMapping}
            />
          </>
        ) : null}
      </div>

      {colorLibrary && hasCurrentPrintMapping ? (
        <div className="print-mapping-list">
          {project.palette.map((sourceColor, index) => {
            const mappedId = mappingByPaletteIndex.get(index) ?? "";
            const mappedEntry = libraryEntryById.get(mappedId);
            return (
              <label className="print-mapping-row" key={index}>
                <span className="print-mapping-row__swatches" aria-hidden="true">
                  <span
                    className="print-mapping-row__source"
                    style={{
                      backgroundColor: `rgb(${sourceColor[0]} ${sourceColor[1]} ${sourceColor[2]})`,
                    }}
                  />
                  <span className="print-mapping-row__arrow">→</span>
                  <span
                    className="print-mapping-row__target"
                    style={{
                      backgroundColor: mappedEntry?.hex ?? "transparent",
                    }}
                  />
                </span>
                <span className="print-mapping-row__field">
                  <span className="field-label">
                    {interpolate(t("workshop.bead.printColorFor"), {
                      index: index + 1,
                    })}
                  </span>
                  <select
                    className={cx(workstationInputClass, "field-input--card")}
                    aria-label={interpolate(t("workshop.bead.printColorFor"), {
                      index: index + 1,
                    })}
                    value={mappedId}
                    onChange={(event) =>
                      onSetPrintMappingEntry?.(index, event.target.value)
                    }
                  >
                    {colorLibrary.colors.map((entry, entryIndex) => (
                      <option key={`${entry.id}-${entryIndex}`} value={entry.id}>
                        {entry.label} · {entry.hex}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  return (
    <BeadEditorWorkspace
      mode={workbenchMode}
      labels={{
        project: t("workshop.bead.workspace.project"),
        workflow: t("workshop.bead.workspace.workflow"),
        tools: t("workshop.bead.toolsTitle"),
        modeControls: t("workshop.bead.workspace.modeControls"),
        output: t("workshop.bead.workspace.output"),
        auxiliary: t("workshop.bead.workspace.auxiliary"),
      }}
      projectControls={
        <div className="bead-editor-project-control">
          <span className="bead-editor-project-control__identity">
            <span
              className="bead-editor-project-control__title"
              title={projectTitle}
            >
              {projectTitle}
            </span>
            <span className="bead-editor-project-control__size">
              {project.columns} × {project.rows}
            </span>
          </span>
          <span className="bead-editor-project-actions">
            {sourceRaster !== null && onReturnCalibration ? (
              <Button
                label={t("workshop.bead.returnCalibration")}
                variant="secondary"
                size="small"
                onClick={onReturnCalibration}
              />
            ) : null}
            <Button
              label={t("workshop.bead.newProject")}
              variant="secondary"
              size="small"
              onClick={onNewProject}
            />
          </span>
        </div>
      }
      workflowControls={
        <div className="bead-editor-workflow-tabs">
          {(["edit", "fusion", "print"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={workbenchMode === mode}
              className="segmented-control workflow-step-tab"
              onClick={() => setWorkbenchMode(mode)}
            >
              {t(`workshop.bead.workspace.mode.${mode}`)}
            </button>
          ))}
        </div>
      }
      toolControls={
        workbenchMode === "edit" ? (
          <>
            <div className="bead-editor-tool-rail">
              {toolNames.map((tool) => (
                <button
                  key={tool}
                  type="button"
                  data-tool={tool}
                  aria-pressed={state.activeTool === tool}
                  className="segmented-control selection-control editor-tool-button"
                  aria-description={t(`workshop.bead.toolHint.${tool}`)}
                  title={t(`workshop.bead.toolHint.${tool}`)}
                  onClick={() => dispatch({ type: "set-tool", tool })}
                >
                  <EditorToolIcon tool={tool} />
                  <span>{t(`workshop.bead.tool.${tool}`)}</span>
                  <span className="editor-tool-button__key" aria-hidden="true">
                    {TOOL_SHORTCUT_KEY[tool]}
                  </span>
                </button>
              ))}
            </div>
            <div className="editor-history-row">
              <button
                type="button"
                className="segmented-control selection-control"
                disabled={state.past.length === 0}
                onClick={() => dispatch({ type: "undo" })}
              >
                {t("workshop.bead.undo")}
              </button>
              <button
                type="button"
                className="segmented-control selection-control"
                disabled={state.future.length === 0}
                onClick={() => dispatch({ type: "redo" })}
              >
                {t("workshop.bead.redo")}
              </button>
            </div>
          </>
        ) : null
      }
      modeControls={
        workbenchMode === "edit"
          ? paletteControls
          : workbenchMode === "fusion"
            ? fusionControls
            : printControls
      }
      outputControls={
        <>
          <span className="bead-editor-output-summary">
            <span className="bead-editor-bead-count">
              {interpolate(t("workshop.bead.beadCount"), {
                count: coloredBeadCount,
              })}
            </span>
            <span>
              {project.compression}% · {formatMillimeters(project.beadPitchMm)} mm ·{" "}
              {formatMillimeters(size.widthMm)} × {formatMillimeters(size.heightMm)} mm
            </span>
          </span>
          {onHandoff ? (
            <Button
              label={t("workshop.bead.handoff")}
              className="bead-editor-output-button"
              icon={
                <span
                  className="bead-editor-output-button__compact"
                  aria-hidden
                >
                  {t("workshop.bead.workspace.printShort")}
                </span>
              }
              onClick={(event) => onHandoff(event.currentTarget)}
              loading={handoffBusy}
              disabled={!hasColoredBeads}
              title={
                hasColoredBeads
                  ? t("workshop.bead.handoff")
                  : t("workshop.bead.handoffEmpty")
              }
            />
          ) : null}
        </>
      }
      canvas={
        <>
          <h1 className="bead-editor-workspace__title">
            {t("workshop.bead.editorTitle")}
          </h1>
          <div className="canvas-stage canvas-stage--pegboard">
            <div className="bead-three-preview-stack">
              <BeadThreePreview
                project={displayProject}
                translate={t}
                onPickCell={workbenchMode === "edit" ? applyAt : undefined}
                onPickCells={
                  workbenchMode === "edit" ? applyAtCells : undefined
                }
                activeTool={state.activeTool}
                brushSize={state.activeTool === "erase" ? eraserSize : 1}
                activeColor={
                  displayProject.palette[state.activePaletteIndex] ?? null
                }
                allowDrag={
                  workbenchMode === "edit" &&
                  (state.activeTool === "paint" || state.activeTool === "erase")
                }
                selectedCellIndex={state.selectedCellIndex}
                editingEnabled={workbenchMode === "edit"}
                ariaLabel={t(
                  supportsThreePreview
                    ? "workshop.bead.threeCanvas"
                    : "workshop.bead.threeFallbackCanvas",
                )}
              />
              {supportsThreePreview ? (
                <div className="bead-three-preview__help">
                  <HelpDot
                    title={t("workshop.bead.threeHelpLabel")}
                    ariaLabel={t("workshop.bead.threeHelpLabel")}
                    description={t("workshop.bead.threeHint")}
                    className="bead-three-preview__help-dot"
                    bubbleClassName="bead-three-preview__hint"
                    keepInDom
                  />
                </div>
              ) : (
                <p className="bead-three-preview__hint bead-three-preview__hint--limit">
                  {interpolate(t("workshop.bead.threeLimitHint"), {
                    count: coloredBeadCount,
                    limit: MAX_THREE_PREVIEW_BEADS,
                  })}
                </p>
              )}
            </div>
          </div>
        </>
      }
      auxiliaryExpanded={auxiliaryExpanded}
      onCollapseAuxiliary={() => setAuxiliaryExpanded(false)}
      auxiliaryView={
        <div className="bead-editor-auxiliary">
          <header className="bead-editor-auxiliary__header">
            <div className="bead-editor-auxiliary__title-row">
              <strong>{t("workshop.bead.workspace.auxiliary")}</strong>
              {project.confidenceIssues.length > 0 ? (
                <span
                  className={cx(
                    "review-summary",
                    unresolvedIssueIndices.length > 0 && "review-summary--pending",
                  )}
                >
                  {interpolate(t("workshop.bead.reviewSummary"), {
                    pending: unresolvedIssueIndices.length,
                    total: project.confidenceIssues.length,
                  })}
                </span>
              ) : (
                <span className="bead-editor-auxiliary__inline-grid-toggle">
                  <Checkbox
                    label={t("workshop.bead.showGrid")}
                    checked={showGrid}
                    onChange={setShowGrid}
                  />
                </span>
              )}
              <button
                type="button"
                className="segmented-control selection-control bead-editor-auxiliary__expand"
                aria-label={t(
                  auxiliaryExpanded
                    ? "workshop.bead.workspace.auxiliaryCollapse"
                    : "workshop.bead.workspace.auxiliaryExpand",
                )}
                aria-expanded={auxiliaryExpanded}
                onClick={() => setAuxiliaryExpanded((expanded) => !expanded)}
              >
                {auxiliaryExpanded ? "↙" : "↗"}
              </button>
            </div>
            {project.confidenceIssues.length > 0 ? (
              <div className="bead-editor-auxiliary__review">
                <div className="bead-editor-auxiliary__steppers">
                  <button
                    type="button"
                    className="segmented-control selection-control"
                    aria-label={t("workshop.bead.previousIssue")}
                    title={t("workshop.bead.previousIssue")}
                    disabled={unresolvedIssueIndices.length === 0}
                    onClick={() => selectIssue(-1)}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="segmented-control selection-control"
                    aria-label={t("workshop.bead.nextIssue")}
                    title={t("workshop.bead.nextIssue")}
                    disabled={unresolvedIssueIndices.length === 0}
                    onClick={() => selectIssue(1)}
                  >
                    ›
                  </button>
                </div>
                <Checkbox
                  label={t("workshop.bead.showGrid")}
                  checked={showGrid}
                  onChange={setShowGrid}
                />
              </div>
            ) : null}
          </header>
          <div
            className="bead-editor-auxiliary__tabs"
            role="toolbar"
            aria-label={t("workshop.bead.workspace.auxiliaryViews")}
            hidden={!auxiliaryExpanded}
          >
            {(["matrix", "pressure", "original"] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className="segmented-control selection-control"
                aria-pressed={auxiliaryView === candidate}
                disabled={candidate === "original" && sourceRaster === null}
                onClick={() => setAuxiliaryView(candidate)}
              >
                {t(`workshop.bead.view.${candidate}`)}
              </button>
            ))}
          </div>
          <div className="bead-editor-auxiliary__body">
            <div className="bead-editor-auxiliary__canvas">
              {auxiliaryExpanded ? (
                <BeadCanvasViewport
                  viewKey={auxiliaryView}
                  contentWidth={
                    auxiliaryView === "original" && sourceRaster
                      ? sourceRaster.width
                      : project.columns * 12
                  }
                  contentHeight={
                    auxiliaryView === "original" && sourceRaster
                      ? sourceRaster.height
                      : project.rows * 12
                  }
                  ariaLabel={t(
                    auxiliaryView === "original"
                      ? "workshop.bead.originalCanvas"
                      : auxiliaryView === "pressure"
                        ? "workshop.bead.pressureCanvas"
                        : "workshop.bead.matrixCanvas",
                  )}
                  translate={t}
                >
                  {renderAuxiliaryCanvas()}
                </BeadCanvasViewport>
              ) : (
                renderAuxiliaryCanvas()
              )}
            </div>
            {!auxiliaryExpanded && state.selectedCellIndex !== null ? (
              <div
                className="bead-editor-auxiliary__inspection"
                role="group"
                aria-label={t("workshop.bead.magnifier")}
              >
                <BeadMatrixCanvas
                  project={displayProject}
                  selectedCellIndex={state.selectedCellIndex}
                  viewport={{ centerCellIndex: state.selectedCellIndex, radius: 2 }}
                  showGrid
                  ariaLabel={t("workshop.bead.magnifier")}
                />
              </div>
            ) : null}
          </div>
        </div>
      }
    />
  );
}
