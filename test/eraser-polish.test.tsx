import { fireEvent, render, screen } from "@testing-library/react";
import { useReducer } from "react";
import { InstancedMesh, Matrix4, Quaternion, Scene, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";

import { BeadEditorStep } from "../src/app/BeadEditorStep";
import { BeadThreePreview } from "../src/app/BeadThreePreview";
import type { BeadThreePreviewController } from "../src/app/beadThreePreviewController";
import {
  BEAD_EXIT_ANIMATION_MS,
  createBeadFastPreviewLayer,
} from "../src/app/beadFastPreviewLayer";
import {
  beadEditorReducer,
  createBeadEditorState,
} from "../src/domain/editorReducer";
import { buildFastBeadPreviewModel } from "../src/domain/fastPreviewModel";
import {
  expandBrushFootprint,
  interpolateGridCells,
} from "../src/domain/gridBrush";
import {
  AUTO_EXPAND_CANVAS_INITIAL_SIZE,
  createBeadProject,
} from "../src/domain/project";
import { translate } from "../src/i18n/translations";

const t = (key: string) => translate("zh-CN", key);

describe("eraser brush, stroke interpolation, and single-stroke undo", () => {
  it("interpolates fast diagonal and horizontal pointer jumps without skipping cells", () => {
    // 5x5 grid: jump from top-left (0, 0) = 0 to bottom-right (4, 4) = 24
    expect(interpolateGridCells(5, 5, 0, 24)).toEqual([0, 6, 12, 18, 24]);
    // Horizontal jump from (1, 0) = 5 to (1, 4) = 9
    expect(interpolateGridCells(5, 5, 5, 9)).toEqual([5, 6, 7, 8, 9]);
  });

  it("expands 1x1, 2x2, and 3x3 brush footprints while clamping cleanly at board edges", () => {
    expect(expandBrushFootprint(4, 4, 5, 1)).toEqual([5]);
    expect(expandBrushFootprint(4, 4, 5, 2)).toEqual([5, 6, 9, 10]);
    expect(expandBrushFootprint(4, 4, 5, 3)).toEqual([
      0, 1, 2, 4, 5, 6, 8, 9, 10,
    ]);
    // Bottom-right corner (cell 15) clamps without wrapping across rows
    expect(expandBrushFootprint(4, 4, 15, 3)).toEqual([10, 11, 14, 15]);
  });

  it("coalesces a multi-frame drag erase stroke into a single undo/redo step", () => {
    const project = createBeadProject({
      projectId: "stroke-undo",
      moduleVersion: "1.0.9-dev.0",
      now: "2026-11-18T00:00:00.000Z",
      rows: 1,
      columns: 5,
      palette: [[239, 68, 68]],
      cells: Array.from({ length: 5 }, () => ({
        kind: "color" as const,
        paletteIndex: 0,
      })),
    });

    let state = createBeadEditorState(project);
    state = beadEditorReducer(state, { type: "set-tool", tool: "erase" });
    state = beadEditorReducer(state, {
      type: "apply-tool",
      cellIndex: 0,
      cellIndices: [0, 1],
      strokeId: "drag-1",
    });
    state = beadEditorReducer(state, {
      type: "apply-tool",
      cellIndex: 4,
      cellIndices: [2, 3, 4],
      strokeId: "drag-1",
    });

    expect(state.present.cells.every((cell) => cell.kind === "empty")).toBe(
      true,
    );
    expect(state.past).toHaveLength(1);

    const undone = beadEditorReducer(state, { type: "undo" });
    expect(undone.present.cells.every((cell) => cell.kind === "color")).toBe(
      true,
    );

    const redone = beadEditorReducer(undone, { type: "redo" });
    expect(redone.present.cells.every((cell) => cell.kind === "empty")).toBe(
      true,
    );
  });

  it("exposes 1x1 / 2x2 / 3x3 eraser sizes and keyboard shortcuts (E, [, ], Cmd+Z)", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const project = createBeadProject({
      projectId: "eraser-ui",
      moduleVersion: "1.0.9-dev.0",
      now: "2026-11-18T00:00:00.000Z",
      rows: 4,
      columns: 4,
      palette: [[239, 68, 68]],
      cells: Array.from({ length: 16 }, () => ({
        kind: "color" as const,
        paletteIndex: 0,
      })),
    });

    function Harness() {
      const [state, dispatch] = useReducer(
        beadEditorReducer,
        createBeadEditorState(project),
      );
      return (
        <>
          <BeadEditorStep
            state={state}
            sourceRaster={null}
            translate={t}
            dispatch={dispatch}
            onNewProject={vi.fn()}
          />
          <output data-testid="colored-count">
            {state.present.cells.filter((c) => c.kind === "color").length}
          </output>
        </>
      );
    }

    render(<Harness />);
    expect(
      screen.queryByRole("group", { name: "橡皮大小" }),
    ).not.toBeInTheDocument();

    // Press E to switch to Eraser and reveal contextual size bar
    fireEvent.keyDown(window, { key: "e" });
    expect(
      screen.getByRole("button", { name: "擦除" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("group", { name: "橡皮大小" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "单颗 1×1" }),
    ).toHaveAttribute("aria-pressed", "true");

    // Press ] twice to step up to 3x3 eraser
    fireEvent.keyDown(window, { key: "]" });
    expect(
      screen.getByRole("button", { name: "中号 2×2" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(window, { key: "]" });
    expect(
      screen.getByRole("button", { name: "大号 3×3" }),
    ).toHaveAttribute("aria-pressed", "true");

    // Expand 2D reference and click center cell (1, 1) -> erases 3x3 = 9 beads!
    fireEvent.click(screen.getByRole("button", { name: "放大 2D 对照" }));
    const matrixCanvas = screen.getByRole("img", { name: "拼豆平面豆格图" });
    vi.spyOn(matrixCanvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 160,
      bottom: 160,
      width: 160,
      height: 160,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(matrixCanvas, {
      pointerId: 1,
      clientX: 60,
      clientY: 60,
    });
    fireEvent.pointerUp(matrixCanvas, {
      pointerId: 1,
      clientX: 60,
      clientY: 60,
    });
    expect(screen.getByTestId("colored-count")).toHaveTextContent("7");

    // Cmd+Z restores all 9 erased beads in one undo!
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(screen.getByTestId("colored-count")).toHaveTextContent("16");
  });

  it("animates erased beads with elastic pop, 3D tumble, spark burst, and neighbor spring bounce", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, false);
    const makePairModel = (leftFilled: boolean, rightFilled: boolean) =>
      buildFastBeadPreviewModel(
        createBeadProject({
          projectId: "erase-vfx-pair",
          moduleVersion: "1.0.9-dev.0",
          now: "2026-11-18T00:00:00.000Z",
          rows: 1,
          columns: 2,
          palette: [[239, 68, 68]],
          cells: [
            leftFilled ? { kind: "color", paletteIndex: 0 } : { kind: "empty" },
            rightFilled
              ? { kind: "color", paletteIndex: 0 }
              : { kind: "empty" },
          ],
          compression: 0,
          irregularity: 0,
        }),
      );

    const bothModel = makePairModel(true, true);
    const erasedLeftModel = makePairModel(false, true);

    layer.update(bothModel, 1, 0);
    layer.update(erasedLeftModel, 2, 10);

    const fastMesh = scene.getObjectByName(
      "bead-preview-fast-beads",
    ) as InstancedMesh;
    const outgoingMesh = scene.getObjectByName(
      "bead-preview-fast-outgoing",
    ) as InstancedMesh;
    const sparkMesh = scene.getObjectByName(
      "bead-preview-fast-sparks",
    ) as InstancedMesh;
    const ringMesh = scene.getObjectByName(
      "bead-preview-fast-rings",
    ) as InstancedMesh;
    expect(sparkMesh).toBeInstanceOf(InstancedMesh);
    expect(ringMesh).toBeInstanceOf(InstancedMesh);

    const readPose = (mesh: InstancedMesh, index: number) => {
      const matrix = new Matrix4();
      const position = new Vector3();
      const quaternion = new Quaternion();
      const scale = new Vector3();
      mesh.getMatrixAt(index, matrix);
      matrix.decompose(position, quaternion, scale);
      return { position, quaternion, scale };
    };

    const startPose = readPose(outgoingMesh, 0);

    // Phase 1 (t = 10 + 35ms): elastic outward swell pop + 8 faceted 3D sparks + expanding shockwave ring + neighbor bounce
    layer.advance(45);
    const popPose = readPose(outgoingMesh, 0);
    expect(popPose.scale.x).toBeGreaterThan(startPose.scale.x * 1.12);
    expect(sparkMesh.visible).toBe(true);
    expect(sparkMesh.count).toBe(8);
    expect(ringMesh.visible).toBe(true);
    expect(ringMesh.count).toBe(1);

    const neighborBouncePose = readPose(fastMesh, 1);
    expect(neighborBouncePose.scale.x).toBeGreaterThan(1.01);

    // Phase 2 (t = 10 + 165ms): wide parabolic hop + directional flick + dramatic 3D quaternion somersault
    layer.advance(175);
    const midPose = readPose(outgoingMesh, 0);
    const tumbleAngleRad =
      2 * Math.acos(Math.min(1, Math.abs(midPose.quaternion.w)));
    expect(tumbleAngleRad).toBeGreaterThan(1.2);
    expect(
      Math.hypot(
        midPose.position.x - startPose.position.x,
        midPose.position.z - startPose.position.z,
      ),
    ).toBeGreaterThan(1.0);

    // Phase 3 (t = 10 + BEAD_EXIT_ANIMATION_MS): cleanly settled with 0 sparks and 0 rings
    layer.advance(10 + BEAD_EXIT_ANIMATION_MS);
    expect(sparkMesh.count).toBe(0);
    expect(sparkMesh.visible).toBe(false);
    expect(ringMesh.count).toBe(0);
    expect(ringMesh.visible).toBe(false);
    expect(layer.hasActiveAnimations()).toBe(false);
    expect(readPose(fastMesh, 1).scale.x).toBeCloseTo(1, 5);
  });

  it("radiates multi-bead erases from the clicked origin and ripples restored beads back in", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, false);
    const full3x3 = buildFastBeadPreviewModel(
      createBeadProject({
        projectId: "erase-domino-3x3",
        moduleVersion: "1.0.9-dev.0",
        now: "2026-11-18T00:00:00.000Z",
        rows: 3,
        columns: 3,
        palette: [[239, 68, 68]],
        cells: Array.from({ length: 9 }, () => ({
          kind: "color" as const,
          paletteIndex: 0,
        })),
      }),
    );
    const empty3x3 = buildFastBeadPreviewModel(
      createBeadProject({
        projectId: "erase-domino-3x3",
        moduleVersion: "1.0.9-dev.0",
        now: "2026-11-18T00:00:00.000Z",
        rows: 3,
        columns: 3,
        palette: [[239, 68, 68]],
        cells: Array.from({ length: 9 }, () => ({ kind: "empty" as const })),
      }),
    );

    layer.update(full3x3, 1, 0);
    // Click top-left cell (0) -> domino wave radiates outward toward bottom-right (8)
    layer.setActionOriginCell?.(0);
    layer.update(empty3x3, 2, 10);

    // At 10 + BEAD_EXIT_ANIMATION_MS, origin cell (0) finished while far corner (8) is still cascading
    layer.advance(10 + BEAD_EXIT_ANIMATION_MS);
    expect(layer.hasActiveAnimations()).toBe(true);

    // Once far corner delay (~68ms for 2*sqrt(2) cells) completes, everything settles cleanly
    layer.advance(10 + BEAD_EXIT_ANIMATION_MS + 100);
    expect(layer.hasActiveAnimations()).toBe(false);

    // Undo / batch restore ripples beads back onto the pegs in a staggered wave
    layer.update(full3x3, 3, 600);
    expect(layer.hasActiveAnimations()).toBe(true);
    layer.advance(600 + 370);
    expect(layer.hasActiveAnimations()).toBe(true);
    layer.advance(600 + 370 + 100);
    expect(layer.hasActiveAnimations()).toBe(false);
  });

  it("keeps separate undo steps across 2D auxiliary collapse and re-expand", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const project = createBeadProject({
      projectId: "remount-stroke-id",
      moduleVersion: "1.0.9-dev.0",
      now: "2026-11-19T00:00:00.000Z",
      rows: 4,
      columns: 4,
      palette: [[239, 68, 68]],
      cells: Array.from({ length: 16 }, () => ({
        kind: "color" as const,
        paletteIndex: 0,
      })),
    });

    let latestState = createBeadEditorState(project);
    function Harness() {
      const [state, dispatch] = useReducer(beadEditorReducer, latestState);
      latestState = state;
      return (
        <>
          <BeadEditorStep
            state={state}
            sourceRaster={null}
            translate={t}
            dispatch={dispatch}
            onNewProject={vi.fn()}
          />
          <output data-testid="colored-count">
            {state.present.cells.filter((c) => c.kind === "color").length}
          </output>
        </>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "擦除" }));

    // 1. Expand 2D view and erase cell A (0, 0) -> index 0
    fireEvent.click(screen.getByRole("button", { name: "放大 2D 对照" }));
    const firstCanvas = screen.getByRole("img", { name: "拼豆平面豆格图" });
    vi.spyOn(firstCanvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 160,
      bottom: 160,
      width: 160,
      height: 160,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(firstCanvas, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(firstCanvas, { pointerId: 1, clientX: 20, clientY: 20 });
    expect(screen.getByTestId("colored-count")).toHaveTextContent("15");

    // 2. Collapse and re-expand 2D view (remounts BeadMatrixCanvas), then erase cell B (1, 1) -> index 5
    fireEvent.click(screen.getByRole("button", { name: "收起 2D 对照" }));
    fireEvent.click(screen.getByRole("button", { name: "放大 2D 对照" }));
    const secondCanvas = screen.getByRole("img", { name: "拼豆平面豆格图" });
    vi.spyOn(secondCanvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 160,
      bottom: 160,
      width: 160,
      height: 160,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(secondCanvas, { pointerId: 2, clientX: 60, clientY: 60 });
    fireEvent.pointerUp(secondCanvas, { pointerId: 2, clientX: 60, clientY: 60 });
    expect(screen.getByTestId("colored-count")).toHaveTextContent("14");

    // 3. Collapse so toolbar Undo button is accessible, then click Undo ONCE -> only B is restored!
    fireEvent.click(screen.getByRole("button", { name: "收起 2D 对照" }));
    const undoButton = screen.getByRole("button", { name: "撤销" });
    fireEvent.click(undoButton);

    expect(screen.getByTestId("colored-count")).toHaveTextContent("15");
    expect(latestState.present.cells[0]?.kind).toBe("empty");
    expect(latestState.present.cells[5]?.kind).toBe("color");
    expect(undoButton).not.toBeDisabled();

    // 4. Second Undo restores A and disables Undo
    fireEvent.click(undoButton);
    expect(screen.getByTestId("colored-count")).toHaveTextContent("16");
    expect(latestState.present.cells[0]?.kind).toBe("color");
    expect(undoButton).toBeDisabled();
  });

  it("remaps stroke origin when auto-expand grows the 2D board mid-drag on right and left edges", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const makeBlank32 = (id: string) =>
      createBeadProject({
        projectId: id,
        moduleVersion: "1.0.9-dev.0",
        now: "2026-11-19T00:00:00.000Z",
        rows: AUTO_EXPAND_CANVAS_INITIAL_SIZE,
        columns: AUTO_EXPAND_CANVAS_INITIAL_SIZE,
        palette: [[37, 99, 235]],
        canvasMode: "auto-expand",
      });

    let latestState = createBeadEditorState(makeBlank32("auto-expand-2d-right"));
    function Harness() {
      const [state, dispatch] = useReducer(beadEditorReducer, latestState);
      latestState = state;
      return (
        <BeadEditorStep
          state={state}
          sourceRaster={null}
          translate={t}
          dispatch={dispatch}
          onNewProject={vi.fn()}
        />
      );
    }

    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "放大 2D 对照" }));
    const matrixCanvas = screen.getByRole("img", {
      name: "拼豆平面豆格图",
    }) as HTMLCanvasElement;
    vi.spyOn(matrixCanvas, "getBoundingClientRect").mockImplementation(() => {
      const width = latestState.present.columns * 10;
      const height = latestState.present.rows * 10;
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON: () => ({}),
      };
    });

    // Row 17 (0-based row 16), drag continuously from col 28 -> 29 -> 30 (expands 32->40) -> 31
    fireEvent.pointerDown(matrixCanvas, {
      pointerId: 1,
      clientX: 285,
      clientY: 165,
    });
    fireEvent.pointerMove(matrixCanvas, {
      pointerId: 1,
      clientX: 295,
      clientY: 165,
    });
    fireEvent.pointerMove(matrixCanvas, {
      pointerId: 1,
      clientX: 305,
      clientY: 165,
    });
    expect(latestState.present.columns).toBe(40);
    fireEvent.pointerMove(matrixCanvas, {
      pointerId: 1,
      clientX: 315,
      clientY: 165,
    });
    fireEvent.pointerUp(matrixCanvas, {
      pointerId: 1,
      clientX: 315,
      clientY: 165,
    });

    const coloredRight = latestState.present.cells.flatMap((cell, idx) =>
      cell.kind === "color" ? [idx] : [],
    );
    expect(coloredRight).toEqual([
      16 * 40 + 28,
      16 * 40 + 29,
      16 * 40 + 30,
      16 * 40 + 31,
    ]);

    // Single Undo reverses the entire continuous drag (including expansion) in one step
    fireEvent.click(screen.getByRole("button", { name: "收起 2D 对照" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(latestState.present.columns).toBe(32);
    expect(
      latestState.present.cells.every((cell) => cell.kind === "empty"),
    ).toBe(true);

    // Also verify left-edge expansion (addLeft = 8 shifts existing columns right by +8)
    fireEvent.click(screen.getByRole("button", { name: "放大 2D 对照" }));
    const leftCanvas = screen.getByRole("img", {
      name: "拼豆平面豆格图",
    }) as HTMLCanvasElement;
    vi.spyOn(leftCanvas, "getBoundingClientRect").mockImplementation(() => {
      const width = latestState.present.columns * 10;
      const height = latestState.present.rows * 10;
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON: () => ({}),
      };
    });
    // Row 16: drag left from col 3 -> col 2 -> col 1 (expands left by +8, so col 1 becomes col 9) -> col 8
    fireEvent.pointerDown(leftCanvas, { pointerId: 2, clientX: 35, clientY: 165 });
    fireEvent.pointerMove(leftCanvas, { pointerId: 2, clientX: 25, clientY: 165 });
    fireEvent.pointerMove(leftCanvas, { pointerId: 2, clientX: 15, clientY: 165 });
    expect(latestState.present.columns).toBe(40);
    fireEvent.pointerMove(leftCanvas, { pointerId: 2, clientX: 85, clientY: 165 });
    fireEvent.pointerUp(leftCanvas, { pointerId: 2, clientX: 85, clientY: 165 });

    const coloredLeft = latestState.present.cells.flatMap((cell, idx) =>
      cell.kind === "color" ? [idx] : [],
    );
    expect(coloredLeft).toEqual([
      16 * 40 + 8,
      16 * 40 + 9,
      16 * 40 + 10,
      16 * 40 + 11,
    ]);
    view.unmount();
  });

  it("remaps 3D drag stroke origin when auto-expand grows the board mid-stroke", () => {
    let nextPickCell: number | null = null;
    const controller: BeadThreePreviewController = {
      previewProject: vi.fn(),
      update: vi.fn(),
      pickCellAt: vi.fn(() => nextPickCell),
      setSelectedCell: vi.fn(),
      setHoveredCell: vi.fn(),
      setHoverHighlight: vi.fn(),
      setActionOriginCell: vi.fn(),
      resize: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      fit: vi.fn(),
      resetView: vi.fn(),
      dispose: vi.fn(),
    };

    const initial = createBeadProject({
      projectId: "auto-expand-3d",
      moduleVersion: "1.0.9-dev.0",
      now: "2026-11-19T00:00:00.000Z",
      rows: AUTO_EXPAND_CANVAS_INITIAL_SIZE,
      columns: AUTO_EXPAND_CANVAS_INITIAL_SIZE,
      palette: [[37, 99, 235]],
      canvasMode: "auto-expand",
    });

    let latestState = createBeadEditorState(initial);
    function ThreeHarness() {
      const [state, dispatch] = useReducer(beadEditorReducer, latestState);
      latestState = state;
      return (
        <BeadThreePreview
          project={state.present}
          ariaLabel="三维扩板拖绘"
          createController={() => controller}
          createSurfaceRenderer={() => ({
            render: () => new Promise(() => undefined),
            dispose: vi.fn(),
          })}
          activeTool="paint"
          allowDrag
          editingEnabled
          onPickCells={(cellIndices, strokeId) => {
            if (cellIndices.length === 0) return;
            dispatch({
              type: "apply-tool",
              tool: "paint",
              cellIndex: cellIndices[cellIndices.length - 1]!,
              cellIndices,
              paletteIndex: 0,
              ...(strokeId ? { strokeId } : {}),
            });
          }}
        />
      );
    }

    render(<ThreeHarness />);
    const canvas = screen.getByRole("img", { name: "三维扩板拖绘" });

    // Row 16: col 28 -> 29 -> 30 (expands 32x32 -> 32x40) -> 31 in 32x40
    nextPickCell = 16 * 32 + 28;
    fireEvent.pointerDown(canvas, {
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 100,
      clientY: 100,
    });
    nextPickCell = 16 * 32 + 29;
    fireEvent.pointerMove(canvas, {
      buttons: 1,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 110,
      clientY: 100,
    });
    nextPickCell = 16 * 32 + 30;
    fireEvent.pointerMove(canvas, {
      buttons: 1,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 120,
      clientY: 100,
    });
    expect(latestState.present.columns).toBe(40);

    nextPickCell = 16 * 40 + 31;
    fireEvent.pointerMove(canvas, {
      buttons: 1,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 130,
      clientY: 100,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 130,
      clientY: 100,
    });

    const colored3d = latestState.present.cells.flatMap((cell, idx) =>
      cell.kind === "color" ? [idx] : [],
    );
    expect(colored3d).toEqual([
      16 * 40 + 28,
      16 * 40 + 29,
      16 * 40 + 30,
      16 * 40 + 31,
    ]);
    expect(latestState.past).toHaveLength(1);
  });

  it("keeps grid cells stationary under the pen during default-fit 2D auto-expand and re-fits on release", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const getRectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function mockViewportLayoutRect(this: HTMLElement) {
        if (
          this.getAttribute("data-testid") === "bead-canvas-viewport-surface"
        ) {
          return {
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            right: 1200,
            bottom: 464,
            width: 1200,
            height: 464,
            toJSON: () => ({}),
          } as DOMRect;
        }
        const content = this.closest(
          '[data-testid="bead-canvas-viewport-content"]',
        ) as HTMLElement | null;
        if (content && this.tagName === "CANVAS") {
          const match = content.style.transform.match(
            /translate3d\(([-\d.]+)px,\s*([-\d.]+)px,\s*0(?:px)?\)\s*scale\(([-\d.]+)\)/,
          );
          const tx = match ? Number(match[1]) : 0;
          const ty = match ? Number(match[2]) : 0;
          const scale = match ? Number(match[3]) : 1;
          const width = parseFloat(content.style.width || "0") * scale;
          const height = parseFloat(content.style.height || "0") * scale;
          return {
            x: tx,
            y: ty,
            left: tx,
            top: ty,
            right: tx + width,
            bottom: ty + height,
            width,
            height,
            toJSON: () => ({}),
          } as DOMRect;
        }
        return {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          toJSON: () => ({}),
        } as DOMRect;
      });

    try {
      const initial = createBeadProject({
        projectId: "default-fit-stationary-pen",
        moduleVersion: "1.0.9-dev.0",
        now: "2026-11-19T00:00:00.000Z",
        rows: AUTO_EXPAND_CANVAS_INITIAL_SIZE,
        columns: AUTO_EXPAND_CANVAS_INITIAL_SIZE,
        palette: [[37, 99, 235]],
        canvasMode: "auto-expand",
      });

      let latestState = createBeadEditorState(initial);
      function FitHarness() {
        const [state, dispatch] = useReducer(beadEditorReducer, latestState);
        latestState = state;
        return (
          <BeadEditorStep
            state={state}
            sourceRaster={null}
            translate={t}
            dispatch={dispatch}
            onNewProject={vi.fn()}
          />
        );
      }

      render(<FitHarness />);
      fireEvent.click(screen.getByRole("button", { name: "放大 2D 对照" }));
      expect(
        screen.getByRole("button", { name: "适合窗口" }),
      ).toHaveAttribute("aria-pressed", "true");

      const matrixCanvas = screen.getByRole("img", {
        name: "拼豆平面豆格图",
      }) as HTMLCanvasElement;
      const initialRect = matrixCanvas.getBoundingClientRect();
      // 384x384 fitted into 1200x464 -> left = 368px, width = 464px (14.5px per cell)
      expect(initialRect.left).toBeCloseTo(368, 3);
      const cellPx = initialRect.width / 32;
      const row17Y = initialRect.top + 16.5 * cellPx;
      const col29X = initialRect.left + 28.5 * cellPx;
      const col30X = initialRect.left + 29.5 * cellPx;
      const col31X = initialRect.left + 30.5 * cellPx;
      const col32X = initialRect.left + 31.5 * cellPx;

      // Drag straight across fixed screen coordinates from col 29 -> initial col 32 without chasing the canvas
      fireEvent.pointerDown(matrixCanvas, {
        pointerId: 1,
        clientX: col29X,
        clientY: row17Y,
      });
      fireEvent.pointerMove(matrixCanvas, {
        pointerId: 1,
        clientX: col30X,
        clientY: row17Y,
      });
      fireEvent.pointerMove(matrixCanvas, {
        pointerId: 1,
        clientX: col31X,
        clientY: row17Y,
      });
      expect(latestState.present.columns).toBe(40);
      // While pointer is still pressed, existing cells must stay at their exact screen coordinates
      expect(matrixCanvas.getBoundingClientRect().left).toBeCloseTo(368, 3);

      fireEvent.pointerMove(matrixCanvas, {
        pointerId: 1,
        clientX: col32X,
        clientY: row17Y,
      });
      expect(
        latestState.present.cells.flatMap((c, i) =>
          c.kind === "color" ? [i] : [],
        ),
      ).toEqual([
        16 * 40 + 28,
        16 * 40 + 29,
        16 * 40 + 30,
        16 * 40 + 31,
      ]);

      // Releasing the pointer now triggers the deferred fit-to-window centering (40x32 -> left = 310px)
      fireEvent.pointerUp(matrixCanvas, {
        pointerId: 1,
        clientX: col32X,
        clientY: row17Y,
      });
      expect(matrixCanvas.getBoundingClientRect().left).toBeCloseTo(310, 3);
      expect(
        screen.getByRole("button", { name: "适合窗口" }),
      ).toHaveAttribute("aria-pressed", "true");

      // Undo back to blank 32x32, then verify left-edge auto-expand also keeps existing cells stationary under pen
      fireEvent.click(screen.getByRole("button", { name: "收起 2D 对照" }));
      fireEvent.click(screen.getByRole("button", { name: "撤销" }));
      fireEvent.click(screen.getByRole("button", { name: "放大 2D 对照" }));

      const leftCanvas = screen.getByRole("img", {
        name: "拼豆平面豆格图",
      }) as HTMLCanvasElement;
      const leftInitialRect = leftCanvas.getBoundingClientRect();
      const leftCellPx = leftInitialRect.width / 32;
      const leftRowY = leftInitialRect.top + 16.5 * leftCellPx;
      const col4X = leftInitialRect.left + 3.5 * leftCellPx;
      const col3X = leftInitialRect.left + 2.5 * leftCellPx;
      const col2X = leftInitialRect.left + 1.5 * leftCellPx;
      const col1X = leftInitialRect.left + 0.5 * leftCellPx;

      fireEvent.pointerDown(leftCanvas, {
        pointerId: 2,
        clientX: col4X,
        clientY: leftRowY,
      });
      fireEvent.pointerMove(leftCanvas, {
        pointerId: 2,
        clientX: col3X,
        clientY: leftRowY,
      });
      fireEvent.pointerMove(leftCanvas, {
        pointerId: 2,
        clientX: col2X,
        clientY: leftRowY,
      });
      expect(latestState.present.columns).toBe(40);
      // 8 columns added on left -> left edge shifts left by 8 * cellPx so old col 0 stays at 368px!
      expect(
        leftCanvas.getBoundingClientRect().left + 8 * leftCellPx,
      ).toBeCloseTo(368, 3);

      fireEvent.pointerMove(leftCanvas, {
        pointerId: 2,
        clientX: col1X,
        clientY: leftRowY,
      });
      expect(
        latestState.present.cells.flatMap((c, i) =>
          c.kind === "color" ? [i] : [],
        ),
      ).toEqual([
        16 * 40 + 8,
        16 * 40 + 9,
        16 * 40 + 10,
        16 * 40 + 11,
      ]);

      fireEvent.pointerUp(leftCanvas, {
        pointerId: 2,
        clientX: col1X,
        clientY: leftRowY,
      });
      expect(leftCanvas.getBoundingClientRect().left).toBeCloseTo(310, 3);

      // Undo back to blank 32x32, then verify top-edge auto-expand keeps existing rows stationary under pen
      fireEvent.click(screen.getByRole("button", { name: "收起 2D 对照" }));
      fireEvent.click(screen.getByRole("button", { name: "撤销" }));
      fireEvent.click(screen.getByRole("button", { name: "放大 2D 对照" }));

      const topCanvas = screen.getByRole("img", {
        name: "拼豆平面豆格图",
      }) as HTMLCanvasElement;
      const topInitialRect = topCanvas.getBoundingClientRect();
      const topCellPx = topInitialRect.height / 32;
      const col17X = topInitialRect.left + 16.5 * topCellPx;
      const row4Y = topInitialRect.top + 3.5 * topCellPx;
      const row3Y = topInitialRect.top + 2.5 * topCellPx;
      const row2Y = topInitialRect.top + 1.5 * topCellPx;
      const row1Y = topInitialRect.top + 0.5 * topCellPx;

      fireEvent.pointerDown(topCanvas, {
        pointerId: 3,
        clientX: col17X,
        clientY: row4Y,
      });
      fireEvent.pointerMove(topCanvas, {
        pointerId: 3,
        clientX: col17X,
        clientY: row3Y,
      });
      fireEvent.pointerMove(topCanvas, {
        pointerId: 3,
        clientX: col17X,
        clientY: row2Y,
      });
      expect(latestState.present.rows).toBe(40);
      expect(
        topCanvas.getBoundingClientRect().top + 8 * topCellPx,
      ).toBeCloseTo(topInitialRect.top, 3);

      fireEvent.pointerMove(topCanvas, {
        pointerId: 3,
        clientX: col17X,
        clientY: row1Y,
      });
      expect(
        latestState.present.cells.flatMap((c, i) =>
          c.kind === "color" ? [i] : [],
        ),
      ).toEqual([
        8 * 32 + 16,
        9 * 32 + 16,
        10 * 32 + 16,
        11 * 32 + 16,
      ]);

      fireEvent.pointerUp(topCanvas, {
        pointerId: 3,
        clientX: col17X,
        clientY: row1Y,
      });
      expect(topCanvas.getBoundingClientRect().height).toBeCloseTo(464, 3);

      // In manual 100% zoom mode, left expansion keeps existing cells pinned even after pointerUp
      fireEvent.click(screen.getByRole("button", { name: "重置为 100%" }));
      const manualBeforeLeft = topCanvas.getBoundingClientRect().left;
      const manualRowY = topCanvas.getBoundingClientRect().top + 20.5 * 12;
      fireEvent.pointerDown(topCanvas, {
        pointerId: 4,
        clientX: manualBeforeLeft + 1.5 * 12,
        clientY: manualRowY,
      });
      fireEvent.pointerUp(topCanvas, {
        pointerId: 4,
        clientX: manualBeforeLeft + 1.5 * 12,
        clientY: manualRowY,
      });
      expect(latestState.present.columns).toBe(40);
      expect(topCanvas.getBoundingClientRect().left + 8 * 12).toBeCloseTo(
        manualBeforeLeft,
        3,
      );
    } finally {
      getRectSpy.mockRestore();
    }
  });
});
