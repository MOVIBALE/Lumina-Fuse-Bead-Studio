// @vitest-environment node
import { describe, expect, it } from "vitest";
import { beadEditorReducer, createBeadEditorState } from "../src/domain/editorReducer";
import { createBeadProject } from "../src/domain/project";
import { BEAD_WORKSPACE_SCHEMA, prepareBeadWorkspace, type BeadWorkspaceState } from "../src/domain/workspaceSnapshot";

function workspace(): BeadWorkspaceState {
  const project = createBeadProject({ projectId: "draft", moduleVersion: "1.0.9-dev.0", now: "2026-01-01T00:00:00Z", rows: 2, columns: 2 });
  let editor = createBeadEditorState(project);
  editor = beadEditorReducer(editor, { type: "apply-tool", cellIndex: 1 });
  editor = beadEditorReducer(editor, { type: "select-cell", cellIndex: 1 });
  return { stage: "editor", editorState: editor, originalRaster: null, workingRaster: null, projectSource: null, classification: null, calibrationDraft: null, crop: null, cropOpen: false, recalibrationSession: null, colorLibrary: null, previewColorMode: "source" };
}
describe("bead workspace snapshots", () => {
  it("preserves painted cells, selection and undo/redo using the current reducer", () => {
    const state = workspace();
    const restored = prepareBeadWorkspace({ schemaVersion: BEAD_WORKSPACE_SCHEMA, state });
    expect(restored.editorState?.selectedCellIndex).toBe(1);
    expect(restored.editorState?.present.cells[1]).toEqual({ kind: "color", paletteIndex: 0 });
    const undone = beadEditorReducer(restored.editorState!, { type: "undo" });
    expect(undone.present.cells[1]).toEqual({ kind: "empty" });
    expect(beadEditorReducer(undone, { type: "redo" }).present.cells).toEqual(state.editorState!.present.cells);
    expect(restored).not.toBe(state);
  });
  it("preserves source Blob bytes and editable calibration before recognition", async () => {
    const state = workspace();
    const data = new Uint8ClampedArray(4 * 4 * 4);
    state.stage = "calibration";
    state.originalRaster = state.workingRaster = { width: 4, height: 4, data };
    state.projectSource = { blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), fileName: "source.png", mimeType: "image/png", pixelWidth: 4, pixelHeight: 4 };
    state.calibrationDraft = { inputMode: "hard-pixel", rows: 2, columns: 2, geometry: { originX: 0, originY: 0, cellWidth: 2, cellHeight: 2 }, orientation: { rotation: 90, flipHorizontal: true, flipVertical: false }, emptySelection: { kind: "none" } };
    const restored = prepareBeadWorkspace({ schemaVersion: BEAD_WORKSPACE_SCHEMA, state });
    expect([...new Uint8Array(await restored.projectSource!.blob.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(restored.calibrationDraft).toEqual(state.calibrationDraft);
    expect(restored.workingRaster?.data).toEqual(data);
  });
  it("rejects corrupt raster sizes, history indices and unknown versions before commit", () => {
    const state = workspace();
    expect(() => prepareBeadWorkspace({ schemaVersion: "future/v99", state })).toThrow();
    expect(() => prepareBeadWorkspace({ schemaVersion: BEAD_WORKSPACE_SCHEMA, state: { ...state, workingRaster: { width: 500, height: 500, data: new Uint8ClampedArray(1) } } })).toThrow();
    const entry = state.editorState!.past[0];
    if (entry.kind === "patch") entry.cellPatches[0].index = 1_000_000;
    expect(() => prepareBeadWorkspace({ schemaVersion: BEAD_WORKSPACE_SCHEMA, state })).toThrow();
  });
});
