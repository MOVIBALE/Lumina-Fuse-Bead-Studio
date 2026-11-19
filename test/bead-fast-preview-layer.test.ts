import {
  Color,
  ExtrudeGeometry,
  InstancedMesh,
  Matrix4,
  MeshPhysicalMaterial,
  Quaternion,
  Scene,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vitest";

import {
  BEAD_EXIT_ANIMATION_MS,
  BEAD_PLACEMENT_ANIMATION_MS,
  createBeadFastPreviewLayer,
  resolveFastBeadSuperellipseExponent,
} from "../src/app/beadFastPreviewLayer";
import {
  buildFastBeadPreviewModel,
  type FastBeadPreviewModel,
} from "../src/domain/fastPreviewModel";
import { createBeadProject } from "../src/domain/project";
import type { BeadCell } from "../src/domain/types";

const EMPTY: BeadCell = { kind: "empty" };
const RED: BeadCell = { kind: "color", paletteIndex: 0 };
const BLUE: BeadCell = { kind: "color", paletteIndex: 1 };
const BLACK: BeadCell = { kind: "color", paletteIndex: 2 };

function makeModel(
  cells: BeadCell[],
  overrides: {
    compression?: number;
    irregularity?: number;
    projectId?: string;
    rows?: number;
    columns?: number;
  } = {},
): FastBeadPreviewModel {
  const rows = overrides.rows ?? 1;
  const columns = overrides.columns ?? cells.length;
  return buildFastBeadPreviewModel(
    createBeadProject({
      projectId: overrides.projectId ?? "fast-layer-test",
      moduleVersion: "1.0.8-dev.34",
      now: "2026-08-12T00:00:00.000Z",
      rows,
      columns,
      cells,
      palette: [
        [239, 56, 72],
        [40, 114, 224],
        [0, 0, 0],
      ],
      beadPitchMm: 2.6,
      compression: overrides.compression ?? 65,
      irregularity: overrides.irregularity ?? 35,
    }),
  );
}

function fastMesh(scene: Scene): InstancedMesh {
  const mesh = scene.getObjectByName("bead-preview-fast-beads");
  expect(mesh).toBeInstanceOf(InstancedMesh);
  return mesh as InstancedMesh;
}

function outgoingMesh(scene: Scene): InstancedMesh {
  const mesh = scene.getObjectByName("bead-preview-fast-outgoing");
  expect(mesh).toBeInstanceOf(InstancedMesh);
  return mesh as InstancedMesh;
}

function readTransform(mesh: InstancedMesh, cellIndex: number) {
  const matrix = new Matrix4();
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  mesh.getMatrixAt(cellIndex, matrix);
  matrix.decompose(position, rotation, scale);
  return { matrix, position, scale };
}

function finalMatrix(model: FastBeadPreviewModel, cellIndex: number) {
  const slot = model.slots[cellIndex];
  if (!slot) throw new Error(`Missing slot ${cellIndex}.`);
  return new Matrix4().compose(
    new Vector3(slot.xMm, model.heightMm / 2, slot.zMm),
    new Quaternion(),
    new Vector3(slot.scaleX, 1, slot.scaleZ),
  );
}

function expectMatrixClose(actual: Matrix4, expected: Matrix4): void {
  for (let index = 0; index < 16; index += 1) {
    // Instanced attributes are stored as Float32 even though Matrix4 uses
    // JavaScript doubles in memory.
    expect(actual.elements[index]).toBeCloseTo(expected.elements[index], 6);
  }
}

function readColor(mesh: InstancedMesh, cellIndex: number): Color {
  const color = new Color();
  mesh.getColorAt(cellIndex, color);
  return color;
}

function expectColorClose(actual: Color, expected: Color): void {
  expect(actual.r).toBeCloseTo(expected.r, 6);
  expect(actual.g).toBeCloseTo(expected.g, 6);
  expect(actual.b).toBeCloseTo(expected.b, 6);
}

function expectHidden(mesh: InstancedMesh, cellIndex: number): void {
  const { elements } = readTransform(mesh, cellIndex).matrix;
  expect(elements[0]).toBe(0);
  expect(elements[5]).toBe(0);
  expect(elements[10]).toBe(0);
}

function expectVisible(mesh: InstancedMesh, cellIndex: number): void {
  const { scale } = readTransform(mesh, cellIndex);
  expect(scale.x).toBeGreaterThan(0);
  expect(scale.y).toBeGreaterThan(0);
  expect(scale.z).toBeGreaterThan(0);
}

function diagonalOuterRatio(mesh: InstancedMesh, radiusMm: number): number {
  const positions = mesh.geometry.getAttribute("position");
  let diagonalExtent = 0;
  for (let index = 0; index < positions.count; index += 1) {
    const x = Math.abs(positions.getX(index));
    const z = Math.abs(positions.getZ(index));
    if (Math.abs(x - z) < 1e-5) diagonalExtent = Math.max(diagonalExtent, x);
  }
  return diagonalExtent / radiusMm;
}

describe("persistent fast bead preview layer", () => {
  it("uses stable main and outgoing instance meshes across edits", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, false);
    const initial = makeModel([EMPTY, RED]);
    const painted = makeModel([BLUE, RED]);
    const recolored = makeModel([RED, RED]);
    const erased = makeModel([EMPTY, RED]);

    layer.update(initial, 1, 0);
    const mesh = fastMesh(scene);
    const outgoing = outgoingMesh(scene);
    expect(mesh.count).toBe(2);
    expect(outgoing.count).toBe(2);
    expect(outgoing.geometry).toBe(mesh.geometry);
    expect(outgoing.material).toBe(mesh.material);
    expect(mesh.geometry).toBeInstanceOf(ExtrudeGeometry);
    expect(mesh.material).toBeInstanceOf(MeshPhysicalMaterial);
    expect(mesh.material).toMatchObject({
      vertexColors: false,
      roughness: 0.43,
      metalness: 0,
      clearcoat: 0.2,
      clearcoatRoughness: 0.5,
    });

    layer.update(painted, 2, 10);
    expect(fastMesh(scene)).toBe(mesh);
    expect(readTransform(mesh, 0).scale.x).toBeGreaterThan(0);

    layer.advance(10 + BEAD_PLACEMENT_ANIMATION_MS);
    layer.update(recolored, 3, 400);
    expect(fastMesh(scene)).toBe(mesh);
    expect(outgoingMesh(scene)).toBe(outgoing);
    expect(layer.hasActiveAnimations()).toBe(true);
    expectColorClose(
      readColor(mesh, 0),
      new Color().setStyle("rgb(239, 56, 72)"),
    );

    layer.update(erased, 4, 410);
    expect(fastMesh(scene)).toBe(mesh);
    expect(outgoingMesh(scene)).toBe(outgoing);
    expectHidden(mesh, 0);
    expectVisible(outgoing, 0);
    expect(layer.hasActiveAnimations()).toBe(true);
    expect(layer.revision).toBe(4);
  });

  it("keeps existing red while a new black instance starts placing", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, false);
    const initial = makeModel([RED, EMPTY]);
    const painted = makeModel([RED, BLACK]);

    layer.update(initial, 1, 0);
    const mesh = fastMesh(scene);
    layer.update(painted, 2, 10);

    expect(fastMesh(scene)).toBe(mesh);
    expect(mesh.geometry.getAttribute("color")).toBeUndefined();
    expect((mesh.material as MeshPhysicalMaterial).vertexColors).toBe(false);
    expect(mesh.instanceColor).not.toBeNull();
    expectColorClose(
      readColor(mesh, 0),
      new Color().setStyle("rgb(239, 56, 72)"),
    );
    expectColorClose(
      readColor(mesh, 1),
      new Color().setStyle("rgb(0, 0, 0)"),
    );
    expect(layer.hasActiveAnimations()).toBe(true);
  });

  it("renders only masked cells while preserving local paint and erase motion", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, false);
    const initial = makeModel([RED, EMPTY]);
    const painted = makeModel([RED, BLUE]);

    layer.update(initial, 1, 0);
    layer.update(painted, 2, 10, new Uint8Array([0, 1]));
    const mesh = fastMesh(scene);
    const outgoing = outgoingMesh(scene);
    expectHidden(mesh, 0);
    expectVisible(mesh, 1);

    layer.advance(10 + BEAD_PLACEMENT_ANIMATION_MS);
    const erased = makeModel([RED, EMPTY]);
    layer.update(erased, 3, 400, new Uint8Array([0, 1]));
    expectHidden(mesh, 0);
    expectHidden(mesh, 1);
    expectVisible(outgoing, 1);
  });

  it("ignores stale revisions without rolling back mesh or animation state", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, false);

    layer.update(makeModel([EMPTY]), 1, 0);
    layer.update(makeModel([RED]), 3, 10);
    const mesh = fastMesh(scene);
    const beforeStaleUpdate = readTransform(mesh, 0).matrix.clone();
    const colorBeforeStaleUpdate = readColor(mesh, 0);

    layer.update(makeModel([BLUE]), 2, 20);

    expect(layer.revision).toBe(3);
    expect(fastMesh(scene)).toBe(mesh);
    expectMatrixClose(readTransform(mesh, 0).matrix, beforeStaleUpdate);
    expectColorClose(readColor(mesh, 0), colorBeforeStaleUpdate);
    expect(layer.hasActiveAnimations()).toBe(true);
  });

  it("resets snapshots when project identity or same-capacity topology changes", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, false);
    const first = makeModel([EMPTY, EMPTY], {
      projectId: "project-a",
      rows: 1,
      columns: 2,
    });
    const nextProject = makeModel([RED, BLUE], {
      projectId: "project-b",
      rows: 1,
      columns: 2,
    });
    const nextTopology = makeModel([BLUE, RED], {
      projectId: "project-b",
      rows: 2,
      columns: 1,
    });

    layer.update(first, 1, 0);
    const mesh = fastMesh(scene);
    layer.update(nextProject, 2, 10);

    expect(fastMesh(scene)).toBe(mesh);
    expect(layer.hasActiveAnimations()).toBe(false);
    expectMatrixClose(readTransform(mesh, 0).matrix, finalMatrix(nextProject, 0));
    expectMatrixClose(readTransform(mesh, 1).matrix, finalMatrix(nextProject, 1));

    layer.update(nextTopology, 3, 20);

    expect(fastMesh(scene)).toBe(mesh);
    expect(layer.hasActiveAnimations()).toBe(false);
    expectMatrixClose(readTransform(mesh, 0).matrix, finalMatrix(nextTopology, 0));
    expectMatrixClose(readTransform(mesh, 1).matrix, finalMatrix(nextTopology, 1));
  });

  it("does not recompute an unused bounding sphere on updates or animation frames", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, false);
    layer.update(makeModel([EMPTY, RED]), 1, 0);
    const mesh = fastMesh(scene);
    const computeBoundingSphere = vi.spyOn(mesh, "computeBoundingSphere");

    layer.update(makeModel([BLUE, RED]), 2, 10);
    layer.advance(90);
    layer.advance(280);

    expect(fastMesh(scene)).toBe(mesh);
    expect(computeBoundingSphere).not.toHaveBeenCalled();
  });

  it("uses a circular 0% profile and increasingly square high-pressure geometry", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, false);
    const roundModel = makeModel([RED], {
      compression: 0,
      irregularity: 0,
    });
    const pressedModel = makeModel([RED], {
      compression: 100,
      irregularity: 0,
    });
    const standardModel = makeModel([RED], {
      compression: 50,
      irregularity: 0,
    });

    layer.update(roundModel, 1, 0);
    const roundRatio = diagonalOuterRatio(
      fastMesh(scene),
      roundModel.outerRadiusMm,
    );
    layer.update(pressedModel, 2, 10);
    const pressedRatio = diagonalOuterRatio(
      fastMesh(scene),
      pressedModel.outerRadiusMm,
    );

    expect(resolveFastBeadSuperellipseExponent(roundModel.pressure)).toBe(2);
    expect(resolveFastBeadSuperellipseExponent(standardModel.pressure)).toBe(2);
    expect(resolveFastBeadSuperellipseExponent(pressedModel.pressure))
      .toBeGreaterThan(2);
    expect(roundRatio).toBeCloseTo(Math.SQRT1_2, 4);
    expect(pressedRatio).toBeGreaterThan(0.88);
  });

  it("animates only empty-to-color changes across the approved 370ms curve", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, false);
    const initial = makeModel([EMPTY]);
    const painted = makeModel([RED]);
    const startedAt = 100;

    layer.update(initial, 1, 0);
    layer.update(painted, 2, startedAt);
    const mesh = fastMesh(scene);

    const atZero = readTransform(mesh, 0);
    expect(atZero.scale.x).toBeGreaterThan(0);
    expect(atZero.scale.x).toBeLessThan(painted.slots[0].scaleX);
    expect(atZero.position.y).toBeGreaterThan(painted.heightMm / 2);
    expect(layer.hasActiveAnimations()).toBe(true);

    expect(layer.advance(startedAt + 80)).toBe(true);
    const atAppearanceEnd = readTransform(mesh, 0);
    expect(atAppearanceEnd.scale.x).toBeCloseTo(
      painted.slots[0].scaleX,
      8,
    );
    expect(atAppearanceEnd.position.y).toBeGreaterThan(
      painted.heightMm / 2,
    );

    expect(layer.advance(startedAt + 270)).toBe(true);
    const atLanding = readTransform(mesh, 0);
    expect(atLanding.position.y - painted.heightMm * atLanding.scale.y / 2)
      .toBeCloseTo(0, 6);
    expect(atLanding.scale.y).toBeLessThan(1);

    expect(layer.advance(startedAt + 320)).toBe(true);
    const atRebound = readTransform(mesh, 0);
    expect(atRebound.position.y - painted.heightMm * atRebound.scale.y / 2)
      .toBeGreaterThan(0);

    expect(layer.advance(startedAt + 370)).toBe(false);
    const atEnd = readTransform(mesh, 0);
    expectMatrixClose(atEnd.matrix, finalMatrix(painted, 0));
    expect(layer.hasActiveAnimations()).toBe(false);
  });

  it("shows cells that exist on the first update at their final pose", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, false);
    const model = makeModel([RED, BLUE]);

    layer.update(model, 7, 500);

    expect(layer.hasActiveAnimations()).toBe(false);
    expectMatrixClose(readTransform(fastMesh(scene), 0).matrix, finalMatrix(model, 0));
    expectMatrixClose(readTransform(fastMesh(scene), 1).matrix, finalMatrix(model, 1));
  });

  it("lifts the old color while the replacement bead starts placing", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, false);
    const red = makeModel([RED]);
    const blue = makeModel([BLUE]);
    const startedAt = 100;

    layer.update(red, 1, 0);
    layer.update(blue, 2, startedAt);

    const mesh = fastMesh(scene);
    const outgoing = outgoingMesh(scene);
    expectVisible(mesh, 0);
    expectVisible(outgoing, 0);
    expectColorClose(
      readColor(mesh, 0),
      new Color().setStyle("rgb(40, 114, 224)"),
    );
    expectColorClose(
      readColor(outgoing, 0),
      new Color().setStyle("rgb(239, 56, 72)"),
    );
    expect(layer.hasActiveAnimations()).toBe(true);

    layer.advance(startedAt + BEAD_EXIT_ANIMATION_MS);
    expectHidden(outgoing, 0);
    expect(layer.hasActiveAnimations()).toBe(true);

    layer.advance(startedAt + BEAD_PLACEMENT_ANIMATION_MS);
    expectMatrixClose(readTransform(mesh, 0).matrix, finalMatrix(blue, 0));
    expect(layer.hasActiveAnimations()).toBe(false);
  });

  it("keeps a seated full footprint throughout a 100% no-hole replacement", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, false);
    const red = makeModel([RED], {
      compression: 100,
      irregularity: 0,
    });
    const blue = makeModel([BLUE], {
      compression: 100,
      irregularity: 0,
    });
    const startedAt = 100;
    const slot = blue.slots[0]!;

    layer.update(red, 1, 0);
    layer.update(blue, 2, startedAt);

    const mesh = fastMesh(scene);
    expect(blue.holeRadiusMm).toBe(0);
    for (const elapsedMs of [0, 40, 80, 219, 270, 320, 370]) {
      if (elapsedMs > 0) layer.advance(startedAt + elapsedMs);
      const current = readTransform(mesh, 0);
      expect(current.scale.x).toBeGreaterThanOrEqual(slot.scaleX - 1e-6);
      expect(current.scale.z).toBeGreaterThanOrEqual(slot.scaleZ - 1e-6);
      expect(
        current.position.y - blue.heightMm * current.scale.y / 2,
      ).toBeCloseTo(0, 6);
      expect(
        current.position.y + blue.heightMm * current.scale.y / 2,
      ).toBeGreaterThan(blue.board.pegHeightMm);
    }
  });

  it("cross-fades a 100% no-hole replacement without a centered outgoing bead", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, false);
    const red = makeModel([RED], {
      compression: 100,
      irregularity: 0,
    });
    const blue = makeModel([BLUE], {
      compression: 100,
      irregularity: 0,
    });
    const startedAt = 100;

    layer.update(red, 1, 0);
    layer.update(blue, 2, startedAt);

    const mesh = fastMesh(scene);
    const outgoing = outgoingMesh(scene);
    expectHidden(outgoing, 0);
    expectColorClose(
      readColor(mesh, 0),
      new Color().setStyle("rgb(239, 56, 72)"),
    );

    layer.advance(startedAt + BEAD_EXIT_ANIMATION_MS / 2);
    const midway = readColor(mesh, 0);
    const redLinear = new Color().setStyle("rgb(239, 56, 72)");
    const blueLinear = new Color().setStyle("rgb(40, 114, 224)");
    expect(midway.r).toBeLessThan(redLinear.r);
    expect(midway.r).toBeGreaterThan(blueLinear.r);
    expect(midway.b).toBeGreaterThan(redLinear.b);
    expect(midway.b).toBeLessThan(blueLinear.b);

    layer.advance(startedAt + BEAD_EXIT_ANIMATION_MS);
    expectColorClose(readColor(mesh, 0), blueLinear);
    expectHidden(outgoing, 0);
  });

  it("lifts an erased bead from its current animated pose", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, false);

    layer.update(makeModel([EMPTY]), 1, 0);
    layer.update(makeModel([RED]), 2, 10);
    layer.advance(90);
    const current = readTransform(fastMesh(scene), 0);
    expect(layer.hasActiveAnimations()).toBe(true);

    layer.update(makeModel([EMPTY]), 3, 90);

    expectHidden(fastMesh(scene), 0);
    const outgoing = readTransform(outgoingMesh(scene), 0);
    expect(outgoing.position.y).toBeCloseTo(current.position.y, 6);
    expect(outgoing.scale.x).toBeCloseTo(current.scale.x, 6);
    expect(layer.hasActiveAnimations()).toBe(true);

    layer.advance(90 + BEAD_EXIT_ANIMATION_MS);
    expectHidden(outgoingMesh(scene), 0);
    expect(layer.hasActiveAnimations()).toBe(false);
  });

  it("writes the final pose immediately when reduced motion is enabled", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, true);
    const painted = makeModel([RED]);

    layer.update(makeModel([EMPTY]), 1, 0);
    layer.update(painted, 2, 10);

    expect(layer.hasActiveAnimations()).toBe(false);
    expectHidden(outgoingMesh(scene), 0);
    expect(layer.advance(20)).toBe(false);
    expectMatrixClose(
      readTransform(fastMesh(scene), 0).matrix,
      finalMatrix(painted, 0),
    );
  });

  it("toggles visibility without replacing the mesh", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, false);
    layer.update(makeModel([RED]), 1, 0);
    const mesh = fastMesh(scene);
    const outgoing = outgoingMesh(scene);

    layer.setVisible(false);
    expect(mesh.visible).toBe(false);
    expect(outgoing.visible).toBe(false);
    layer.setVisible(true);
    expect(mesh.visible).toBe(true);
    expect(outgoing.visible).toBe(true);
    expect(fastMesh(scene)).toBe(mesh);
    expect(outgoingMesh(scene)).toBe(outgoing);
  });

  it("disposes mesh geometry and material exactly once", () => {
    const scene = new Scene();
    const layer = createBeadFastPreviewLayer(scene, false);
    layer.update(makeModel([RED]), 1, 0);
    const mesh = fastMesh(scene);
    const outgoing = outgoingMesh(scene);
    const geometryDispose = vi.spyOn(mesh.geometry, "dispose");
    const material = mesh.material as MeshPhysicalMaterial;
    const materialDispose = vi.spyOn(material, "dispose");
    const meshDispose = vi.spyOn(mesh, "dispose");
    const outgoingDispose = vi.spyOn(outgoing, "dispose");

    layer.dispose();
    layer.dispose();

    expect(scene.getObjectByName("bead-preview-fast-beads")).toBeUndefined();
    expect(scene.getObjectByName("bead-preview-fast-outgoing")).toBeUndefined();
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(meshDispose).toHaveBeenCalledTimes(1);
    expect(outgoingDispose).toHaveBeenCalledTimes(1);
  });
});
