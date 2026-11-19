import { fireEvent, render, screen } from "@testing-library/react";
import { useReducer } from "react";
import { InstancedMesh, Matrix4, Quaternion, Scene, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";

import { BeadEditorStep } from "../src/app/BeadEditorStep";
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
import { createBeadProject } from "../src/domain/project";
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
});
