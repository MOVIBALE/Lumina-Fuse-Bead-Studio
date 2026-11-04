import type { WorkshopColorLibrary, WorkshopCurrentProject } from "@lumina/workshop-sdk";
import type { BeadCalibrationDraft } from "../app/BeadCalibrationStep";
import { beadEditorReducer, type BeadEditorState } from "./editorReducer";
import { createBeadProject, validateBeadProject } from "./project";
import { BEAD_MODULE_VERSION, MAX_BEAD_GRID_SIZE, type BeadProjectSource, type CropRect, type PatternClassification, type Raster } from "./types";

export const BEAD_WORKSPACE_SCHEMA = "bead-workspace/v1";
export interface BeadWorkspaceState {
  stage: "upload" | "calibration" | "editor";
  editorState: BeadEditorState | null;
  originalRaster: Raster | null;
  workingRaster: Raster | null;
  projectSource: BeadProjectSource | null;
  classification: PatternClassification | null;
  calibrationDraft: BeadCalibrationDraft | null;
  crop: CropRect | null;
  cropOpen: boolean;
  recalibrationSession: { workingRaster: Raster; crop: CropRect | null } | null;
  colorLibrary: WorkshopColorLibrary | null;
  previewColorMode: "source" | "print";
}
function invalid(): never { throw new Error("The bead workspace snapshot is invalid or unsupported"); }
function validateRaster(value: Raster | null) {
  if (value === null) return;
  if (!value || !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.height < 1 || value.width * value.height > 16_777_216 || !(value.data instanceof Uint8ClampedArray) || value.data.length !== value.width * value.height * 4) invalid();
}
function validateHistory(editor: BeadEditorState) {
  validateBeadProject(editor.present);
  if (!Array.isArray(editor.past) || !Array.isArray(editor.future) || editor.past.length + editor.future.length > 2048) invalid();
  for (const action of ["undo", "redo"] as const) {
    let current = editor;
    const count = action === "undo" ? editor.past.length : editor.future.length;
    for (let index = 0; index < count; index++) {
      const entry = action === "undo" ? current.past.at(-1)! : current.future.at(-1)!;
      if (!entry || !["patch", "project"].includes(entry.kind)) invalid();
      if (entry.kind === "project") { validateBeadProject(entry.beforeProject); validateBeadProject(entry.afterProject); }
      else {
        if (!Array.isArray(entry.cellPatches) || !Array.isArray(entry.issuePatches)) invalid();
        if (entry.cellPatches.some((patch) => !Number.isInteger(patch.index) || patch.index < 0 || patch.index >= current.present.cells.length)) invalid();
        if (entry.issuePatches.some((patch) => !Number.isInteger(patch.index) || patch.index < 0 || patch.index >= current.present.confidenceIssues.length || typeof patch.before !== "boolean" || typeof patch.after !== "boolean")) invalid();
      }
      current = beadEditorReducer(current, { type: action });
      validateBeadProject(current.present);
    }
  }
  if (!["paint", "erase", "eraseFill", "eyedropper", "fill"].includes(editor.activeTool) || !Number.isInteger(editor.activePaletteIndex) || editor.activePaletteIndex < 0 || editor.activePaletteIndex >= editor.present.palette.length) invalid();
  for (const [selected, length] of [[editor.selectedCellIndex, editor.present.cells.length], [editor.selectedIssueIndex, editor.present.confidenceIssues.length]] as const) {
    if (selected !== null && (!Number.isInteger(selected) || selected < 0 || selected >= length)) invalid();
  }
}
export function prepareBeadWorkspace(snapshot: WorkshopCurrentProject): BeadWorkspaceState {
  if (snapshot.schemaVersion !== BEAD_WORKSPACE_SCHEMA || !snapshot.state || typeof snapshot.state !== "object") invalid();
  const state = structuredClone(snapshot.state) as BeadWorkspaceState;
  if (!["upload", "calibration", "editor"].includes(state.stage) || typeof state.cropOpen !== "boolean" || !["source", "print"].includes(state.previewColorMode)) invalid();
  validateRaster(state.originalRaster);
  validateRaster(state.workingRaster);
  if (state.recalibrationSession) validateRaster(state.recalibrationSession.workingRaster);
  if (state.editorState) validateHistory(state.editorState);
  if (state.stage === "editor" && !state.editorState) invalid();
  const draft = state.calibrationDraft;
  if (state.stage === "calibration" && (!draft || !state.workingRaster || !state.projectSource)) invalid();
  if (draft && (!draft.geometry || Object.values(draft.geometry).some((value) => !Number.isFinite(value)) || draft.geometry.cellWidth <= 0 || draft.geometry.cellHeight <= 0 || draft.rows > MAX_BEAD_GRID_SIZE || draft.columns > MAX_BEAD_GRID_SIZE)) invalid();
  // Validate source, crop, orientation and empty selection with the domain owner.
  createBeadProject({ projectId: "workspace-validation", moduleVersion: BEAD_MODULE_VERSION, now: "2026-01-01T00:00:00Z", rows: draft?.rows ?? 1, columns: draft?.columns ?? 1, source: state.projectSource, calibration: draft ? { inputMode: draft.inputMode, crop: state.crop, origin: { x: draft.geometry.originX, y: draft.geometry.originY }, orientation: draft.orientation, emptySelection: draft.emptySelection ?? { kind: "none" } } : undefined });
  if (state.classification && (!["numbered-grid", "hard-pixel", "ring-preview", "ambiguous"].includes(state.classification.mode) || !Number.isFinite(state.classification.confidence))) invalid();
  if (state.colorLibrary && (!Array.isArray(state.colorLibrary.colors) || typeof state.colorLibrary.id !== "string")) invalid();
  return state;
}
