import {
  BufferGeometry,
  Color,
  ExtrudeGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineLoop,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MOUSE,
  Quaternion,
  Scene,
  Vector3,
} from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { createBeadThreePreviewController } from "../src/app/beadThreePreviewController";
import {
  BEAD_EXIT_ANIMATION_MS,
  BEAD_PLACEMENT_ANIMATION_MS,
} from "../src/app/beadFastPreviewLayer";
import { buildFastBeadPreviewModel } from "../src/domain/fastPreviewModel";
import { buildPhysicalPreviewLayout } from "../src/domain/physicalPreviewModel";
import type { PhysicalPreviewModel } from "../src/domain/physicalPreviewModel";
import { createBeadProject } from "../src/domain/project";
import type { BeadCell, BeadProject } from "../src/domain/types";

const capturedControls = vi.hoisted(() => [] as Array<{
  camera: import("three").PerspectiveCamera;
  target: import("three").Vector3;
  mouseButtons: {
    LEFT: number;
    MIDDLE: number;
    RIGHT: number;
  };
}>);

const capturedRenderers = vi.hoisted(() => [] as Array<{
  render: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}>);

let nextAnimationFrameId = 1;
let pendingAnimationFrames = new Map<number, FrameRequestCallback>();

function flushFrame(timestamp: number): void {
  const callbacks = [...pendingAnimationFrames.values()];
  pendingAnimationFrames.clear();
  for (const callback of callbacks) callback(timestamp);
}

function pendingFrameCount(): number {
  return pendingAnimationFrames.size;
}

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();

  class WebGLRendererStub {
    outputColorSpace = "";
    readonly setClearColor = vi.fn();
    readonly setPixelRatio = vi.fn();
    readonly setSize = vi.fn();
    readonly render = vi.fn();
    readonly dispose = vi.fn();

    constructor() {
      capturedRenderers.push(this);
    }
  }

  return {
    ...actual,
    WebGLRenderer: WebGLRendererStub,
  };
});

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => {
  class OrbitControlsStub {
    readonly target = new Vector3();
    enableDamping = false;
    enablePan = false;
    minDistance = 0;
    maxDistance = Infinity;
    readonly mouseButtons = {
      LEFT: MOUSE.ROTATE,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.PAN,
    };
    readonly addEventListener = vi.fn();
    readonly removeEventListener = vi.fn();
    readonly update = vi.fn(() => {
      this.camera.lookAt(this.target);
      this.camera.updateMatrixWorld(true);
    });
    readonly dispose = vi.fn();

    constructor(private readonly camera: import("three").PerspectiveCamera) {
      capturedControls.push({
        camera,
        target: this.target,
        mouseButtons: this.mouseButtons,
      });
    }
  }

  return { OrbitControls: OrbitControlsStub };
});

function makeModel(
  pegCount: number,
  widthMm = pegCount * 2.6,
  depthMm = 2.6,
): PhysicalPreviewModel {
  const beadPitchMm = 2.6;
  return {
    widthMm,
    depthMm,
    heightMm: 1.4,
    beadPitchMm,
    surfacePaths: [{
      cellIndex: 0,
      d: `M 0 0 L ${widthMm / beadPitchMm} 0 L ${widthMm / beadPitchMm} ${depthMm / beadPitchMm} L 0 ${depthMm / beadPitchMm} Z`,
      fill: "rgb(230,40,50)",
      strokeWidth: 0,
    }],
    board: {
      widthMm: widthMm + beadPitchMm * 2.6,
      depthMm: depthMm + beadPitchMm * 2.6,
      thicknessMm: beadPitchMm * 0.45,
      cornerRadiusMm: beadPitchMm * 0.55,
      pegRadiusMm: beadPitchMm * 0.16,
      pegHeightMm: beadPitchMm * 0.32,
      pegs: Array.from({ length: pegCount }, (_, cellIndex) => ({
        cellIndex,
        xMm: (cellIndex - (pegCount - 1) / 2) * beadPitchMm,
        zMm: 0,
      })),
    },
  };
}

function makeMaximumSquareModel(): PhysicalPreviewModel {
  const side = 128;
  const pitchMm = 2.6;
  const model = makeModel(side * side, side * pitchMm, side * pitchMm);
  return {
    ...model,
    board: {
      ...model.board,
      pegs: model.board.pegs.map((peg, cellIndex) => ({
        ...peg,
        xMm: (cellIndex % side - (side - 1) / 2) * pitchMm,
        zMm: (Math.floor(cellIndex / side) - (side - 1) / 2) * pitchMm,
      })),
    },
  };
}

function projectBoundingBox(
  camera: import("three").PerspectiveCamera,
  model: PhysicalPreviewModel,
): Array<import("three").Vector3> {
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const halfWidth = model.board.widthMm / 2;
  const halfDepth = model.board.depthMm / 2;
  const minimumY = -model.board.thicknessMm;
  const maximumY = model.heightMm;
  return [-1, 1].flatMap((xSign) =>
    [minimumY, maximumY].flatMap((y) =>
      [-1, 1].map((zSign) =>
        new Vector3(
          xSign * halfWidth,
          y,
          zSign * halfDepth,
        ).project(camera),
      ),
    ),
  );
}

function setCanvasRect(
  canvas: HTMLCanvasElement,
  rect: { left: number; top: number; width: number; height: number },
): void {
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    ...rect,
    bottom: rect.top + rect.height,
    right: rect.left + rect.width,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  });
}

function projectToClient(
  camera: import("three").PerspectiveCamera,
  canvas: HTMLCanvasElement,
  worldPoint: Vector3,
): { clientX: number; clientY: number } {
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const projected = worldPoint.clone().project(camera);
  const rect = canvas.getBoundingClientRect();
  return {
    clientX: rect.left + (projected.x + 1) * rect.width / 2,
    clientY: rect.top + (1 - projected.y) * rect.height / 2,
  };
}

function makeGridModel(rows: number, columns: number): PhysicalPreviewModel {
  const pitchMm = 2.6;
  const model = makeModel(
    rows * columns,
    columns * pitchMm,
    rows * pitchMm,
  );
  return {
    ...model,
    board: {
      ...model.board,
      pegs: model.board.pegs.map((peg, cellIndex) => ({
        ...peg,
        xMm: (cellIndex % columns - (columns - 1) / 2) * pitchMm,
        zMm: (Math.floor(cellIndex / columns) - (rows - 1) / 2) * pitchMm,
      })),
    },
  };
}

const EMPTY_CELL: BeadCell = { kind: "empty" };
const RED_CELL: BeadCell = { kind: "color", paletteIndex: 0 };
const BLUE_CELL: BeadCell = { kind: "color", paletteIndex: 1 };

function makeProject(
  cells: BeadCell[],
  overrides: {
    projectId?: string;
    rows?: number;
    columns?: number;
    compression?: number;
    irregularity?: number;
  } = {},
): BeadProject {
  const rows = overrides.rows ?? 1;
  const columns = overrides.columns ?? cells.length;
  return createBeadProject({
    projectId: overrides.projectId ?? "controller-fast-preview-test",
    moduleVersion: "1.0.8-dev.34",
    now: "2026-08-12T00:00:00.000Z",
    rows,
    columns,
    cells,
    palette: [
      [239, 56, 72],
      [40, 114, 224],
    ],
    beadPitchMm: 2.6,
    compression: overrides.compression ?? 65,
    irregularity: overrides.irregularity ?? 35,
  });
}

function previewProject(
  controller: ReturnType<typeof createBeadThreePreviewController>,
  project: BeadProject,
  revision: number,
): void {
  expect(controller.previewProject).toBeTypeOf("function");
  controller.previewProject?.(project, revision);
}

function findNamedObject<T>(
  sceneAdd: MockInstance<Scene["add"]>,
  name: string,
): T {
  const object = sceneAdd.mock.calls
    .flat()
    .find((candidate) => candidate.name === name);
  expect(object).toBeDefined();
  return object as T;
}

function readInstanceScale(mesh: InstancedMesh, cellIndex: number): Vector3 {
  const matrix = new Matrix4();
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  mesh.getMatrixAt(cellIndex, matrix);
  matrix.decompose(position, rotation, scale);
  return scale;
}

function readInstanceMatrix(mesh: InstancedMesh, cellIndex: number): Matrix4 {
  const matrix = new Matrix4();
  mesh.getMatrixAt(cellIndex, matrix);
  return matrix;
}

function cellCenterForProject(project: BeadProject, cellIndex: number): Vector3 {
  const layout = buildPhysicalPreviewLayout(project);
  const row = Math.floor(cellIndex / project.columns);
  const column = cellIndex % project.columns;
  return new Vector3(
    (column + 0.5) * project.beadPitchMm - layout.widthMm / 2,
    Math.max(layout.heightMm, layout.board.pegHeightMm),
    (row + 0.5) * project.beadPitchMm - layout.depthMm / 2,
  );
}

function cellCenter(model: PhysicalPreviewModel, cellIndex: number): Vector3 {
  const columns = Math.round(model.widthMm / model.beadPitchMm);
  const row = Math.floor(cellIndex / columns);
  const column = cellIndex % columns;
  return new Vector3(
    (column + 0.5) * model.beadPitchMm - model.widthMm / 2,
    Math.max(model.heightMm, model.board.pegHeightMm),
    (row + 0.5) * model.beadPitchMm - model.depthMm / 2,
  );
}

describe("beadThreePreviewController resource lifecycle", () => {
  beforeEach(() => {
    capturedControls.length = 0;
    capturedRenderers.length = 0;
    nextAnimationFrameId = 1;
    pendingAnimationFrames = new Map();
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const id = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      pendingAnimationFrames.set(id, callback);
      return id;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => {
      pendingAnimationFrames.delete(id);
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the canonical fused surface above a board with every peg", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    const model = makeModel(6, 7.8, 5.2);

    controller.update(model);

    const added = sceneAdd.mock.calls.flat();
    const board = added.find((object) => object.name === "bead-preview-board");
    const pegs = added.find((object) => object.name === "bead-preview-pegs");
    const surface = added.find((object) => object.name === "bead-preview-surface-0");
    expect(board).toBeInstanceOf(Mesh);
    expect(pegs).toBeInstanceOf(InstancedMesh);
    expect((pegs as InstancedMesh).count).toBe(6);
    expect(surface).toBeInstanceOf(Mesh);
    expect((surface as Mesh).geometry).toBeInstanceOf(ExtrudeGeometry);
    (surface as Mesh).geometry.computeBoundingBox();
    expect((surface as Mesh).geometry.boundingBox?.min.y).toBeCloseTo(0, 5);
    expect((surface as Mesh).geometry.boundingBox?.max.y).toBeCloseTo(
      model.heightMm,
      5,
    );
    controller.dispose();
  });

  it("preserves canonical centre holes instead of filling them as cylinders", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    const model = makeModel(2, 5.2, 2.6);
    model.surfacePaths[0] = {
      ...model.surfacePaths[0]!,
      d: "M 0 0 L 2 0 L 2 1 L 0 1 Z M 0.75 0.25 L 1.25 0.25 L 1.25 0.75 L 0.75 0.75 Z",
    };

    controller.update(model);

    const surface = sceneAdd.mock.calls
      .flat()
      .find((object) => object.name === "bead-preview-surface-0") as Mesh;
    const shapes = (surface.geometry as ExtrudeGeometry).parameters.shapes;
    const shapeList = Array.isArray(shapes) ? shapes : [shapes];
    expect(shapeList).toHaveLength(1);
    expect(shapeList[0]?.holes).toHaveLength(1);
    controller.dispose();
  });

  it("maps the SVG top-left cell to the physical board top-left quadrant", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    const model = makeModel(4, 5.2, 5.2);
    model.surfacePaths[0] = {
      ...model.surfacePaths[0]!,
      d: "M 0 0 L 1 0 L 1 1 L 0 1 Z",
    };

    controller.update(model);

    const surface = sceneAdd.mock.calls
      .flat()
      .find((object) => object.name === "bead-preview-surface-0") as Mesh;
    surface.geometry.computeBoundingBox();
    expect(surface.geometry.boundingBox?.min.x).toBeCloseTo(-2.6, 5);
    expect(surface.geometry.boundingBox?.max.x).toBeCloseTo(0, 5);
    expect(surface.geometry.boundingBox?.min.z).toBeCloseTo(-2.6, 5);
    expect(surface.geometry.boundingBox?.max.z).toBeCloseTo(0, 5);
    controller.dispose();
  });

  it("disposes the previous board, peg, and surface meshes when board size changes", () => {
    const meshDispose = vi.spyOn(InstancedMesh.prototype, "dispose");
    const geometryDispose = vi.spyOn(
      ExtrudeGeometry.prototype,
      "dispose",
    );
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );

    controller.update(makeModel(1));
    controller.update(makeModel(2));

    expect(meshDispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("disposes the current board, peg, and surface resources exactly once", () => {
    const meshDispose = vi.spyOn(InstancedMesh.prototype, "dispose");
    const geometryDispose = vi.spyOn(
      ExtrudeGeometry.prototype,
      "dispose",
    );
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    controller.update(makeModel(1));

    controller.dispose();
    controller.dispose();

    expect(meshDispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
  });

  it("moves outward along the current view direction when a narrow resize needs more distance", () => {
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    controller.update(makeModel(4, 52, 26));
    controller.resize(800, 400, 1);
    const { camera, target } = capturedControls[0]!;
    const wideDistance = camera.position.distanceTo(target);
    const userDirection = new Vector3(1, 2, 3).normalize();
    camera.position.copy(target).addScaledVector(userDirection, wideDistance);

    controller.resize(300, 600, 1);

    expect(camera.position.distanceTo(target)).toBeGreaterThan(wideDistance);
    expect(
      camera.position.clone().sub(target).normalize().dot(userDirection),
    ).toBeCloseTo(1, 6);
    controller.dispose();
  });

  it.each([
    ["+Z", new Vector3(0, 0, 1)],
    ["-Z", new Vector3(0, 0, -1)],
  ])(
    "keeps the full board framed when resizing from the exact %s side view",
    (_label, viewDirection) => {
      const controller = createBeadThreePreviewController(
        document.createElement("canvas"),
        vi.fn(),
      );
      const model = makeModel(4, 52, 26);
      controller.resize(800, 400, 1);
      controller.update(model);
      const { camera, target } = capturedControls[0]!;
      const startingDistance = 40;
      camera.position
        .copy(target)
        .addScaledVector(viewDirection, startingDistance);

      controller.resize(300, 600, 1);

      const projectedCorners = projectBoundingBox(camera, model);
      expect(camera.position.distanceTo(target)).toBeGreaterThan(
        startingDistance,
      );
      expect(
        Math.max(...projectedCorners.map((corner) => Math.abs(corner.x))),
      ).toBeLessThanOrEqual(0.95);
      expect(
        Math.max(...projectedCorners.map((corner) => Math.abs(corner.y))),
      ).toBeLessThanOrEqual(0.95);
      expect(
        camera.position.clone().sub(target).normalize().dot(viewDirection),
      ).toBeCloseTo(1, 6);
      controller.dispose();
    },
  );

  it("keeps every maximum-board bounding-box corner inside the padded frustum", () => {
    const model = makeMaximumSquareModel();
    for (const [width, height] of [
      [800, 800],
      [900, 1_600],
    ] as const) {
      const controller = createBeadThreePreviewController(
        document.createElement("canvas"),
        vi.fn(),
      );
      controller.resize(width, height, 1);
      controller.update(model);
      const { camera } = capturedControls.at(-1)!;

      const projectedCorners = projectBoundingBox(camera, model);

      expect(
        Math.max(...projectedCorners.map((corner) => Math.abs(corner.x))),
      ).toBeLessThanOrEqual(0.95);
      expect(
        Math.max(...projectedCorners.map((corner) => Math.abs(corner.y))),
      ).toBeLessThanOrEqual(0.95);
      controller.dispose();
    }
  });

  it("does not pull in a user camera that is already farther than the resize minimum", () => {
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    controller.update(makeModel(4, 52, 26));
    controller.resize(800, 400, 1);
    const { camera, target } = capturedControls[0]!;
    const userDirection = new Vector3(-2, 3, 1).normalize();
    const farDistance = 400;
    camera.position.copy(target).addScaledVector(userDirection, farDistance);

    controller.resize(300, 600, 1);

    expect(camera.position.distanceTo(target)).toBeCloseTo(farDistance, 6);
    expect(
      camera.position.clone().sub(target).normalize().dot(userDirection),
    ).toBeCloseTo(1, 6);
    controller.dispose();
  });

  it("does not reset the camera for color and compression-only model updates", () => {
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    controller.resize(640, 480, 1);
    const model = makeModel(4, 52, 26);
    controller.update(model);
    const { camera, target } = capturedControls[0]!;
    target.set(7, 3, -5);
    camera.position.copy(target).add(new Vector3(3, 4, 5));
    const userPosition = camera.position.clone();
    const userTarget = target.clone();

    controller.update({
      ...model,
      heightMm: 0.7,
      surfacePaths: model.surfacePaths.map((path) => ({
        ...path,
        fill: "rgb(20,120,210)",
      })),
    });

    expect(camera.position).toEqual(userPosition);
    expect(target).toEqual(userTarget);
    controller.dispose();
  });

  it("starts directly above the board with the SVG top edge facing screen up", () => {
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    controller.resize(640, 480, 1);
    controller.update(makeModel(4, 52, 26));
    const { camera, target } = capturedControls[0]!;

    expect(camera.position.x).toBeCloseTo(target.x, 6);
    expect(camera.position.y).toBeGreaterThan(target.y);
    expect(camera.position.z).toBeCloseTo(target.z, 6);
    expect(camera.up).toEqual(new Vector3(0, 0, -1));
    controller.dispose();
  });

  it("zooms in and out around the current OrbitControls target", () => {
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    controller.resize(640, 480, 1);
    controller.update(makeModel(4, 52, 26));
    const { camera, target } = capturedControls[0]!;
    const initialDistance = camera.position.distanceTo(target);

    controller.zoomIn();
    const zoomedInDistance = camera.position.distanceTo(target);
    controller.zoomOut();

    expect(zoomedInDistance).toBeLessThan(initialDistance);
    expect(camera.position.distanceTo(target)).toBeCloseTo(
      initialDistance,
      6,
    );
    controller.dispose();
  });

  it("fits the current direction while recentering the latest model", () => {
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    controller.resize(640, 480, 1);
    const model = makeModel(4, 52, 26);
    controller.update(model);
    const { camera, target } = capturedControls[0]!;
    const userDirection = new Vector3(2, 3, 4).normalize();
    target.set(12, 5, -8);
    camera.position.copy(target).addScaledVector(userDirection, 10);

    controller.fit();

    expect(target.x).toBeCloseTo(0, 6);
    expect(target.y).toBeCloseTo(
      (-model.board.thicknessMm + model.heightMm) / 2,
      6,
    );
    expect(target.z).toBeCloseTo(0, 6);
    expect(
      camera.position.clone().sub(target).normalize().dot(userDirection),
    ).toBeCloseTo(1, 6);
    controller.dispose();
  });

  it.each([
    ["+Z", new Vector3(0, 0, 1)],
    ["-Z", new Vector3(0, 0, -1)],
  ])(
    "keeps the full board framed from the exact %s side view",
    (_label, viewDirection) => {
      const controller = createBeadThreePreviewController(
        document.createElement("canvas"),
        vi.fn(),
      );
      controller.resize(640, 480, 1);
      const model = makeModel(4, 52, 26);
      controller.update(model);
      const { camera, target } = capturedControls[0]!;
      camera.position.copy(target).addScaledVector(viewDirection, 10);

      controller.fit();

      const projectedCorners = projectBoundingBox(camera, model);
      expect(camera.position.distanceTo(target)).toBeGreaterThan(
        model.board.widthMm / 2,
      );
      expect(
        Math.max(...projectedCorners.map((corner) => Math.abs(corner.x))),
      ).toBeLessThanOrEqual(0.95);
      expect(
        Math.max(...projectedCorners.map((corner) => Math.abs(corner.y))),
      ).toBeLessThanOrEqual(0.95);
      expect(
        camera.position.clone().sub(target).normalize().dot(viewDirection),
      ).toBeCloseTo(1, 6);
      controller.dispose();
    },
  );

  it("resets a moved camera to the canonical top view", () => {
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    controller.resize(640, 480, 1);
    controller.update(makeModel(4, 52, 26));
    const { camera, target } = capturedControls[0]!;
    target.set(10, 20, 30);
    camera.position.set(100, 80, 60);
    camera.up.set(0, 1, 0);

    controller.resetView();

    expect(target.x).toBeCloseTo(0, 6);
    expect(target.z).toBeCloseTo(0, 6);
    expect(camera.position.x).toBeCloseTo(target.x, 6);
    expect(camera.position.y).toBeGreaterThan(target.y);
    expect(camera.position.z).toBeCloseTo(target.z, 6);
    expect(camera.up).toEqual(new Vector3(0, 0, -1));
    controller.dispose();
  });

  it("maps every corner cell from the default top view in constant-time grid space", () => {
    const canvas = document.createElement("canvas");
    setCanvasRect(canvas, { left: 0, top: 0, width: 600, height: 400 });
    const controller = createBeadThreePreviewController(canvas, vi.fn());
    const model = makeGridModel(3, 4);
    controller.resize(600, 400, 1);
    controller.update(model);
    const { camera } = capturedControls[0]!;

    for (const cellIndex of [0, 3, 8, 11]) {
      const point = projectToClient(camera, canvas, cellCenter(model, cellIndex));
      expect(controller.pickCellAt(point.clientX, point.clientY)).toBe(
        cellIndex,
      );
    }
    controller.dispose();
  });

  it("maps cells after OrbitControls rotates the camera", () => {
    const canvas = document.createElement("canvas");
    setCanvasRect(canvas, { left: 0, top: 0, width: 640, height: 480 });
    const controller = createBeadThreePreviewController(canvas, vi.fn());
    const model = makeGridModel(3, 4);
    controller.resize(640, 480, 1);
    controller.update(model);
    const { camera, target } = capturedControls[0]!;
    camera.position.copy(target).add(new Vector3(18, 24, 20));
    camera.lookAt(target);
    camera.updateMatrixWorld(true);

    for (const cellIndex of [0, 6, 11]) {
      const point = projectToClient(camera, canvas, cellCenter(model, cellIndex));
      expect(controller.pickCellAt(point.clientX, point.clientY)).toBe(
        cellIndex,
      );
    }
    controller.dispose();
  });

  it("accounts for canvas page offsets when mapping client coordinates", () => {
    const canvas = document.createElement("canvas");
    setCanvasRect(canvas, { left: 137, top: 83, width: 720, height: 360 });
    const controller = createBeadThreePreviewController(canvas, vi.fn());
    const model = makeGridModel(2, 3);
    controller.resize(720, 360, 1);
    controller.update(model);
    const { camera } = capturedControls[0]!;
    const point = projectToClient(camera, canvas, cellCenter(model, 4));

    expect(controller.pickCellAt(point.clientX, point.clientY)).toBe(4);
    controller.dispose();
  });

  it("picks empty and holed cells from the logical grid instead of render meshes", () => {
    const canvas = document.createElement("canvas");
    setCanvasRect(canvas, { left: 0, top: 0, width: 500, height: 500 });
    const controller = createBeadThreePreviewController(canvas, vi.fn());
    const emptyModel = makeGridModel(3, 3);
    emptyModel.surfacePaths = [];
    controller.resize(500, 500, 1);
    controller.update(emptyModel);
    const { camera } = capturedControls[0]!;
    let point = projectToClient(camera, canvas, cellCenter(emptyModel, 4));
    expect(controller.pickCellAt(point.clientX, point.clientY)).toBe(4);

    const holedModel = makeGridModel(3, 3);
    holedModel.surfacePaths[0] = {
      ...holedModel.surfacePaths[0]!,
      d: "M 0 0 L 3 0 L 3 3 L 0 3 Z M 1 1 L 2 1 L 2 2 L 1 2 Z",
    };
    controller.update(holedModel);
    point = projectToClient(camera, canvas, cellCenter(holedModel, 4));
    expect(controller.pickCellAt(point.clientX, point.clientY)).toBe(4);
    controller.dispose();
  });

  it("rejects board-margin hits outside the logical bead grid", () => {
    const canvas = document.createElement("canvas");
    setCanvasRect(canvas, { left: 0, top: 0, width: 600, height: 400 });
    const controller = createBeadThreePreviewController(canvas, vi.fn());
    const model = makeGridModel(2, 3);
    controller.resize(600, 400, 1);
    controller.update(model);
    const { camera } = capturedControls[0]!;
    const point = projectToClient(
      camera,
      canvas,
      new Vector3(
        model.widthMm / 2 + model.beadPitchMm * 0.4,
        Math.max(model.heightMm, model.board.pegHeightMm),
        0,
      ),
    );

    expect(controller.pickCellAt(point.clientX, point.clientY)).toBeNull();
    controller.dispose();
  });

  it("returns no cell before the first model update", () => {
    const canvas = document.createElement("canvas");
    setCanvasRect(canvas, { left: 0, top: 0, width: 600, height: 400 });
    const controller = createBeadThreePreviewController(canvas, vi.fn());
    controller.resize(600, 400, 1);

    expect(controller.pickCellAt(300, 200)).toBeNull();
    controller.setHoveredCell(0);
    controller.setSelectedCell(0);
    controller.dispose();
  });

  it("positions and hides preview-only hover and selection cell outlines", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    const model = makeGridModel(2, 3);
    controller.update(model);
    const added = sceneAdd.mock.calls.flat();
    const hoverMarker = added.find(
      (object) => object.name === "bead-preview-hover-cell",
    ) as LineLoop;
    const selectedMarker = added.find(
      (object) => object.name === "bead-preview-selected-cell",
    ) as LineLoop;

    expect(hoverMarker).toBeInstanceOf(LineLoop);
    expect(selectedMarker).toBeInstanceOf(LineLoop);
    expect(hoverMarker.visible).toBe(false);
    expect(selectedMarker.visible).toBe(false);

    controller.setHoveredCell(0);
    controller.setSelectedCell(5);
    expect(hoverMarker.visible).toBe(true);
    expect(hoverMarker.position.x).toBeCloseTo(-model.beadPitchMm, 6);
    expect(hoverMarker.position.z).toBeCloseTo(-model.beadPitchMm / 2, 6);
    expect(selectedMarker.visible).toBe(true);
    expect(selectedMarker.position.x).toBeCloseTo(model.beadPitchMm, 6);
    expect(selectedMarker.position.z).toBeCloseTo(model.beadPitchMm / 2, 6);
    expect(selectedMarker.position.y).toBeGreaterThan(
      Math.max(model.heightMm, model.board.pegHeightMm),
    );

    controller.setHoveredCell(null);
    controller.setSelectedCell(6);
    expect(hoverMarker.visible).toBe(false);
    expect(selectedMarker.visible).toBe(false);
    controller.dispose();
  });

  it("disposes marker geometry and materials exactly once", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    const markers = [...new Set(
      sceneAdd.mock.calls
        .flat()
        .filter((object) =>
          object.name === "bead-preview-hover-cell" ||
          object.name === "bead-preview-selected-cell"),
    )] as LineLoop[];
    expect(markers).toHaveLength(2);
    const geometrySpies = markers.map((marker) =>
      vi.spyOn(marker.geometry as BufferGeometry, "dispose"));
    const materialSpies = markers.map((marker) =>
      vi.spyOn(marker.material as LineBasicMaterial, "dispose"));

    controller.dispose();
    controller.dispose();

    for (const dispose of [...geometrySpies, ...materialSpies]) {
      expect(dispose).toHaveBeenCalledTimes(1);
    }
  });

  it("builds the board and logical picking before the first exact surface", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const canvas = document.createElement("canvas");
    setCanvasRect(canvas, { left: 20, top: 30, width: 640, height: 480 });
    const controller = createBeadThreePreviewController(canvas, vi.fn());
    const project = makeProject(
      [EMPTY_CELL, RED_CELL, BLUE_CELL, EMPTY_CELL],
      { rows: 2, columns: 2 },
    );
    controller.resize(640, 480, 1);

    previewProject(controller, project, 1);

    const added = sceneAdd.mock.calls.flat();
    expect(added.some((object) => object.name === "bead-preview-board")).toBe(true);
    expect(added.some((object) => object.name === "bead-preview-pegs")).toBe(true);
    expect(
      added.some((object) => object.name.startsWith("bead-preview-surface-")),
    ).toBe(false);
    const { camera } = capturedControls[0]!;
    const point = projectToClient(
      camera,
      canvas,
      cellCenterForProject(project, 2),
    );
    expect(controller.pickCellAt(point.clientX, point.clientY)).toBe(2);
    controller.dispose();
  });

  it("coalesces A B C previews into one fast mesh containing only C", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    previewProject(controller, makeProject([EMPTY_CELL, EMPTY_CELL]), 1);
    previewProject(controller, makeProject([RED_CELL, EMPTY_CELL]), 2);
    previewProject(controller, makeProject([RED_CELL, BLUE_CELL]), 3);

    expect(
      sceneAdd.mock.calls.flat().filter(
        (object) => object.name === "bead-preview-fast-beads",
      ),
    ).toHaveLength(0);
    expect(
      sceneAdd.mock.calls.flat().filter(
        (object) => object.name === "bead-preview-board",
      ),
    ).toHaveLength(1);
    expect(
      sceneAdd.mock.calls.flat().filter(
        (object) => object.name === "bead-preview-pegs",
      ),
    ).toHaveLength(1);

    flushFrame(10);

    const fastMeshes = sceneAdd.mock.calls.flat().filter(
      (object) => object.name === "bead-preview-fast-beads",
    ) as InstancedMesh[];
    expect(fastMeshes).toHaveLength(1);
    expect(readInstanceScale(fastMeshes[0]!, 0).x).toBeGreaterThan(0);
    expect(readInstanceScale(fastMeshes[0]!, 1).x).toBeGreaterThan(0);
    const secondColor = new Color();
    fastMeshes[0]!.getColorAt(1, secondColor);
    const expectedColor = new Color().setStyle("rgb(40, 114, 224)");
    expect(secondColor.r).toBeCloseTo(expectedColor.r, 6);
    expect(secondColor.g).toBeCloseTo(expectedColor.g, 6);
    expect(secondColor.b).toBeCloseTo(expectedColor.b, 6);
    expect(capturedRenderers[0]?.render).toHaveBeenCalledTimes(1);
    expect(pendingFrameCount()).toBe(0);
    controller.dispose();
  });

  it("ignores negative and fractional revisions before building a preview", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    const project = makeProject([RED_CELL]);

    previewProject(controller, project, -1);
    previewProject(controller, project, 0.5);

    const addedNames = sceneAdd.mock.calls.flat().map((object) => object.name);
    expect(addedNames).not.toContain("bead-preview-board");
    expect(addedNames).not.toContain("bead-preview-pegs");
    expect(addedNames).not.toContain("bead-preview-fast-beads");
    expect(pendingFrameCount()).toBe(0);
    controller.dispose();
  });

  it("ignores same revision paint and erase without changing fast exact state", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    const initial = makeProject([RED_CELL, EMPTY_CELL], {
      projectId: "accepted-project",
    });
    const exact = makeGridModel(1, 2);
    exact.surfacePaths[0] = {
      ...exact.surfacePaths[0]!,
      d: "M 0 0 L 1 0 L 1 1 L 0 1 Z",
    };
    previewProject(controller, initial, 1);
    flushFrame(0);
    controller.update(exact, 1);
    flushFrame(1);
    flushFrame(2);
    const fastMesh = findNamedObject<InstancedMesh>(
      sceneAdd,
      "bead-preview-fast-beads",
    );
    const exactMesh = findNamedObject<Mesh>(
      sceneAdd,
      "bead-preview-surface-0",
    );
    const renderCount = capturedRenderers[0]!.render.mock.calls.length;
    const acceptedFirstMatrix = readInstanceMatrix(fastMesh, 0);
    const acceptedSecondMatrix = readInstanceMatrix(fastMesh, 1);
    expect(acceptedFirstMatrix.elements[0]).toBeGreaterThan(0);
    expect(acceptedSecondMatrix.elements[0]).toBe(0);
    expect(acceptedSecondMatrix.elements[5]).toBe(0);
    expect(acceptedSecondMatrix.elements[10]).toBe(0);
    expect(fastMesh.visible).toBe(false);
    expect(exactMesh.visible).toBe(true);
    expect(pendingFrameCount()).toBe(0);

    previewProject(
      controller,
      makeProject([RED_CELL, BLUE_CELL], { projectId: "rejected-paint" }),
      1,
    );
    previewProject(
      controller,
      makeProject([EMPTY_CELL, EMPTY_CELL], { projectId: "rejected-erase" }),
      1,
    );
    flushFrame(10);

    expect(readInstanceMatrix(fastMesh, 0).elements).toEqual(
      acceptedFirstMatrix.elements,
    );
    expect(readInstanceMatrix(fastMesh, 1).elements).toEqual(
      acceptedSecondMatrix.elements,
    );
    expect(fastMesh.visible).toBe(false);
    expect(exactMesh.visible).toBe(true);
    expect(capturedRenderers[0]?.render).toHaveBeenCalledTimes(renderCount);
    expect(
      sceneAdd.mock.calls.flat().filter(
        (object) => object.name === "bead-preview-fast-beads",
      ),
    ).toHaveLength(1);
    expect(pendingFrameCount()).toBe(0);
    controller.dispose();
  });

  it("keeps the 100% fused surface stable and previews only the painted cell", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    const initial = makeProject(
      [RED_CELL, RED_CELL, EMPTY_CELL],
      { compression: 100 },
    );
    const painted = makeProject(
      [RED_CELL, RED_CELL, BLUE_CELL],
      { compression: 100 },
    );
    const exact = makeGridModel(1, 3);
    exact.surfacePaths[0] = {
      ...exact.surfacePaths[0]!,
      d: "M 0 0 L 2 0 L 2 1 L 0 1 Z",
    };

    previewProject(controller, initial, 1);
    flushFrame(0);
    controller.update(exact, 1);
    flushFrame(1);
    flushFrame(2);
    const exactMesh = findNamedObject<Mesh>(
      sceneAdd,
      "bead-preview-surface-0",
    );
    const fastMesh = findNamedObject<InstancedMesh>(
      sceneAdd,
      "bead-preview-fast-beads",
    );
    expect(exactMesh.visible).toBe(true);
    expect(fastMesh.visible).toBe(false);

    previewProject(controller, painted, 2);
    flushFrame(10);

    expect(fastMesh.visible).toBe(true);
    expect(exactMesh.visible).toBe(true);

    const material = exactMesh.material as MeshPhysicalMaterial;
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "#include <begin_vertex>",
      fragmentShader: "#include <clipping_planes_fragment>",
    };
    material.onBeforeCompile(shader as never, {} as never);
    const mask = shader.uniforms.beadEditMask?.value as {
      image: { data: Uint8Array };
    };
    expect(Array.from(mask.image.data)).toEqual([0, 255, 255]);
    expect(shader.fragmentShader).toContain("discard");
    expect(shader.fragmentShader).toContain("clamp(");
    expect(readInstanceMatrix(fastMesh, 0).elements[0]).toBe(0);
    expect(readInstanceMatrix(fastMesh, 0).elements[5]).toBe(0);
    expect(readInstanceMatrix(fastMesh, 0).elements[10]).toBe(0);
    expect(readInstanceScale(fastMesh, 1).x).toBeGreaterThan(0);
    expect(readInstanceScale(fastMesh, 2).x).toBeGreaterThan(0);
    controller.dispose();
  });

  it("keeps the 50% fused surface stable and previews only the affected cells", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    const initial = makeProject(
      [RED_CELL, RED_CELL, EMPTY_CELL],
      { compression: 50, irregularity: 0 },
    );
    const painted = makeProject(
      [RED_CELL, RED_CELL, BLUE_CELL],
      { compression: 50, irregularity: 0 },
    );
    const exact = makeGridModel(1, 3);
    exact.surfacePaths[0] = {
      ...exact.surfacePaths[0]!,
      d: "M 0 0 L 2 0 L 2 1 L 0 1 Z",
    };

    previewProject(controller, initial, 1);
    flushFrame(0);
    controller.update(exact, 1);
    flushFrame(1);
    flushFrame(2);
    const exactMesh = findNamedObject<Mesh>(
      sceneAdd,
      "bead-preview-surface-0",
    );
    const fastMesh = findNamedObject<InstancedMesh>(
      sceneAdd,
      "bead-preview-fast-beads",
    );
    expect(exactMesh.visible).toBe(true);
    expect(fastMesh.visible).toBe(false);

    previewProject(controller, painted, 2);
    flushFrame(10);

    expect(exactMesh.visible).toBe(true);
    expect(fastMesh.visible).toBe(true);
    const material = exactMesh.material as MeshPhysicalMaterial;
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "#include <begin_vertex>",
      fragmentShader: "#include <clipping_planes_fragment>",
    };
    material.onBeforeCompile(shader as never, {} as never);
    const mask = shader.uniforms.beadEditMask?.value as {
      image: { data: Uint8Array };
    };
    expect(Array.from(mask.image.data)).toEqual([0, 255, 255]);
    expect(readInstanceMatrix(fastMesh, 0).elements[0]).toBe(0);
    expect(readInstanceScale(fastMesh, 1).x).toBeGreaterThan(0);
    expect(readInstanceScale(fastMesh, 2).x).toBeGreaterThan(0);
    controller.dispose();
  });

  it("keeps a 100% no-hole replacement seated while exact fusion catches up", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    const initial = makeProject([RED_CELL], {
      compression: 100,
      irregularity: 0,
    });
    const replaced = makeProject([BLUE_CELL], {
      compression: 100,
      irregularity: 0,
    });

    previewProject(controller, initial, 1);
    flushFrame(0);
    controller.update(makeGridModel(1, 1), 1);
    flushFrame(1);
    flushFrame(2);

    previewProject(controller, replaced, 2);
    flushFrame(10);
    const fastMesh = findNamedObject<InstancedMesh>(
      sceneAdd,
      "bead-preview-fast-beads",
    );
    const expectedScale = buildFastBeadPreviewModel(replaced).slots[0]!;

    for (const elapsedMs of [0, 40, 80, 219, 270, 320, 370]) {
      if (elapsedMs > 0) flushFrame(10 + elapsedMs);
      const scale = readInstanceScale(fastMesh, 0);
      expect(scale.x).toBeGreaterThanOrEqual(expectedScale.scaleX - 1e-6);
      expect(scale.z).toBeGreaterThanOrEqual(expectedScale.scaleZ - 1e-6);
    }
    controller.dispose();
  });

  it("rebuilds the exact edit mask when equal-capacity grid dimensions change", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    const horizontal = makeProject(
      [RED_CELL, RED_CELL],
      { rows: 1, columns: 2, compression: 100 },
    );
    const vertical = makeProject(
      [RED_CELL, BLUE_CELL],
      { rows: 2, columns: 1, compression: 100 },
    );

    previewProject(controller, horizontal, 1);
    flushFrame(0);
    controller.update(makeGridModel(1, 2), 1);
    flushFrame(1);
    flushFrame(2);
    const firstExactMesh = sceneAdd.mock.calls
      .flat()
      .find((candidate) => candidate.name === "bead-preview-surface-0") as Mesh;
    const firstShader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "#include <begin_vertex>",
      fragmentShader: "#include <clipping_planes_fragment>",
    };
    (firstExactMesh.material as MeshPhysicalMaterial).onBeforeCompile(
      firstShader as never,
      {} as never,
    );
    const firstTexture = firstShader.uniforms.beadEditMask?.value;

    previewProject(controller, vertical, 2);
    flushFrame(10);
    const liveTexture = firstShader.uniforms.beadEditMask?.value as {
      image: { width: number; height: number };
    };
    const liveGrid = firstShader.uniforms.beadEditGrid?.value as {
      x: number;
      y: number;
    };
    expect(liveTexture).not.toBe(firstTexture);
    expect(liveTexture.image.width).toBe(1);
    expect(liveTexture.image.height).toBe(2);
    expect(liveGrid.x).toBe(1);
    expect(liveGrid.y).toBe(2);
    controller.update(makeGridModel(2, 1), 2);
    flushFrame(10 + BEAD_PLACEMENT_ANIMATION_MS);
    flushFrame(10 + BEAD_PLACEMENT_ANIMATION_MS + 1);

    const exactMeshes = sceneAdd.mock.calls
      .flat()
      .filter((candidate) => candidate.name === "bead-preview-surface-0");
    const material = (exactMeshes.at(-1) as Mesh | undefined)
      ?.material as MeshPhysicalMaterial;
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "#include <begin_vertex>",
      fragmentShader: "#include <clipping_planes_fragment>",
    };
    material.onBeforeCompile(shader as never, {} as never);
    const texture = shader.uniforms.beadEditMask?.value as {
      image: { width: number; height: number };
    };
    expect(texture.image.width).toBe(1);
    expect(texture.image.height).toBe(2);
    controller.dispose();
  });

  it("uses a full fast preview for global 100% irregularity changes", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    const initial = makeProject(
      [RED_CELL, BLUE_CELL],
      { compression: 100, irregularity: 0 },
    );
    const changed = makeProject(
      [RED_CELL, BLUE_CELL],
      { compression: 100, irregularity: 100 },
    );

    previewProject(controller, initial, 1);
    flushFrame(0);
    controller.update(makeGridModel(1, 2), 1);
    flushFrame(1);
    flushFrame(2);
    const exactMesh = findNamedObject<Mesh>(
      sceneAdd,
      "bead-preview-surface-0",
    );
    const fastMesh = findNamedObject<InstancedMesh>(
      sceneAdd,
      "bead-preview-fast-beads",
    );

    previewProject(controller, changed, 2);
    flushFrame(10);

    expect(exactMesh.visible).toBe(false);
    expect(readInstanceScale(fastMesh, 0).x).toBeGreaterThan(0);
    expect(readInstanceScale(fastMesh, 1).x).toBeGreaterThan(0);
    controller.dispose();
  });

  it("keeps the 100% fused surface stable while one bead erases locally", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    const initial = makeProject(
      [RED_CELL, RED_CELL, BLUE_CELL],
      { compression: 100 },
    );
    const erased = makeProject(
      [RED_CELL, RED_CELL, EMPTY_CELL],
      { compression: 100 },
    );
    const exact = makeGridModel(1, 3);
    exact.surfacePaths[0] = {
      ...exact.surfacePaths[0]!,
      d: "M 0 0 L 3 0 L 3 1 L 0 1 Z",
    };

    previewProject(controller, initial, 1);
    flushFrame(0);
    controller.update(exact, 1);
    flushFrame(1);
    flushFrame(2);
    const exactMesh = findNamedObject<Mesh>(
      sceneAdd,
      "bead-preview-surface-0",
    );
    const fastMesh = findNamedObject<InstancedMesh>(
      sceneAdd,
      "bead-preview-fast-beads",
    );
    const outgoing = findNamedObject<InstancedMesh>(
      sceneAdd,
      "bead-preview-fast-outgoing",
    );

    previewProject(controller, erased, 2);
    flushFrame(10);

    expect(exactMesh.visible).toBe(true);
    const material = exactMesh.material as MeshPhysicalMaterial;
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "#include <begin_vertex>",
      fragmentShader: "#include <clipping_planes_fragment>",
    };
    material.onBeforeCompile(shader as never, {} as never);
    const mask = shader.uniforms.beadEditMask?.value as {
      image: { data: Uint8Array };
    };
    expect(Array.from(mask.image.data)).toEqual([0, 255, 255]);
    expect(readInstanceMatrix(fastMesh, 0).elements[0]).toBe(0);
    expect(readInstanceMatrix(fastMesh, 0).elements[5]).toBe(0);
    expect(readInstanceMatrix(fastMesh, 0).elements[10]).toBe(0);
    expect(readInstanceScale(fastMesh, 1).x).toBeGreaterThan(0);
    expect(readInstanceMatrix(fastMesh, 2).elements[0]).toBe(0);
    expect(readInstanceMatrix(fastMesh, 2).elements[5]).toBe(0);
    expect(readInstanceMatrix(fastMesh, 2).elements[10]).toBe(0);
    expect(readInstanceScale(outgoing, 2).x).toBeGreaterThan(0);
    controller.dispose();
  });

  it("hands the latest fast revision to exact only after placement finishes", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    const initial = makeProject([RED_CELL, EMPTY_CELL]);
    const painted = makeProject([RED_CELL, BLUE_CELL]);
    const exactInitial = makeGridModel(1, 2);
    exactInitial.surfacePaths[0] = {
      ...exactInitial.surfacePaths[0]!,
      d: "M 0 0 L 1 0 L 1 1 L 0 1 Z",
    };
    const exactPainted = makeGridModel(1, 2);
    exactPainted.surfacePaths[0] = {
      ...exactPainted.surfacePaths[0]!,
      d: "M 0 0 L 2 0 L 2 1 L 0 1 Z",
    };

    previewProject(controller, initial, 1);
    flushFrame(0);
    controller.update(exactInitial);
    previewProject(controller, painted, 2);
    flushFrame(10);
    const fastMesh = findNamedObject<InstancedMesh>(
      sceneAdd,
      "bead-preview-fast-beads",
    );
    const oldExact = findNamedObject<Mesh>(
      sceneAdd,
      "bead-preview-surface-0",
    );
    const parse = vi.spyOn(SVGLoader.prototype, "parse");

    controller.update(exactPainted, 2);
    expect(parse).not.toHaveBeenCalled();

    for (const timestamp of [80, 190, 379]) {
      flushFrame(timestamp);
      expect(parse).not.toHaveBeenCalled();
      expect(fastMesh.visible).toBe(true);
      expect(oldExact.visible).toBe(false);
    }

    flushFrame(10 + BEAD_PLACEMENT_ANIMATION_MS);
    expect(parse).not.toHaveBeenCalled();
    expect(fastMesh.visible).toBe(true);
    expect(oldExact.visible).toBe(false);
    expect(pendingFrameCount()).toBe(1);

    flushFrame(10 + BEAD_PLACEMENT_ANIMATION_MS + 1);
    const exactMeshes = sceneAdd.mock.calls.flat().filter(
      (object) => object.name === "bead-preview-surface-0",
    ) as Mesh[];
    const latestExact = exactMeshes.at(-1)!;
    expect(parse).toHaveBeenCalledTimes(1);
    expect(fastMesh.visible).toBe(false);
    expect(latestExact).not.toBe(oldExact);
    expect(latestExact.visible).toBe(true);
    expect(pendingFrameCount()).toBe(0);
    controller.dispose();
  });

  it("waits for erase exit motion before exact geometry takes over", () => {
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    previewProject(controller, makeProject([RED_CELL]), 1);
    flushFrame(0);
    previewProject(controller, makeProject([EMPTY_CELL]), 2);
    flushFrame(10);
    controller.update(makeGridModel(1, 1), 2);
    const parse = vi.spyOn(SVGLoader.prototype, "parse");

    flushFrame(10 + BEAD_EXIT_ANIMATION_MS - 1);
    expect(parse).not.toHaveBeenCalled();
    flushFrame(10 + BEAD_EXIT_ANIMATION_MS);
    expect(parse).not.toHaveBeenCalled();
    flushFrame(10 + BEAD_EXIT_ANIMATION_MS + 1);
    expect(parse).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("ignores stale exact revision N without hiding fast revision N plus 1", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    const initial = makeProject([RED_CELL, EMPTY_CELL]);
    const painted = makeProject([RED_CELL, BLUE_CELL]);
    const exactInitial = makeGridModel(1, 2);

    previewProject(controller, initial, 1);
    flushFrame(0);
    controller.update(exactInitial, 1);
    flushFrame(1);
    flushFrame(2);
    previewProject(controller, painted, 2);
    flushFrame(10);
    const fastMesh = findNamedObject<InstancedMesh>(
      sceneAdd,
      "bead-preview-fast-beads",
    );
    const oldExact = findNamedObject<Mesh>(
      sceneAdd,
      "bead-preview-surface-0",
    );
    const parse = vi.spyOn(SVGLoader.prototype, "parse");

    controller.update(makeGridModel(1, 2), 1);
    flushFrame(20);

    expect(parse).not.toHaveBeenCalled();
    expect(fastMesh.visible).toBe(true);
    expect(oldExact.visible).toBe(true);
    controller.dispose();
  });

  it("drops a deferred exact model when a newer preview revision arrives", () => {
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    previewProject(controller, makeProject([RED_CELL, EMPTY_CELL]), 1);
    flushFrame(0);
    const parse = vi.spyOn(SVGLoader.prototype, "parse");

    controller.update(makeGridModel(1, 2), 1);
    flushFrame(1);
    expect(parse).not.toHaveBeenCalled();
    expect(pendingFrameCount()).toBe(1);

    previewProject(controller, makeProject([RED_CELL, BLUE_CELL]), 2);
    flushFrame(2);
    flushFrame(2 + BEAD_PLACEMENT_ANIMATION_MS);

    expect(parse).not.toHaveBeenCalled();
    expect(pendingFrameCount()).toBe(0);
    controller.dispose();
  });

  it("builds only the latest exact model received for one revision", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    previewProject(controller, makeProject([RED_CELL, BLUE_CELL]), 1);
    flushFrame(0);
    const firstExact = makeGridModel(1, 2);
    firstExact.surfacePaths[0] = {
      ...firstExact.surfacePaths[0]!,
      d: "M 0 0 L 1 0 L 1 1 L 0 1 Z",
    };
    const latestExact = makeGridModel(1, 2);
    latestExact.surfacePaths[0] = {
      ...latestExact.surfacePaths[0]!,
      d: "M 0 0 L 2 0 L 2 1 L 0 1 Z",
    };
    const parse = vi.spyOn(SVGLoader.prototype, "parse");

    controller.update(firstExact, 1);
    controller.update(latestExact, 1);
    expect(parse).not.toHaveBeenCalled();
    flushFrame(1);
    expect(parse).not.toHaveBeenCalled();
    flushFrame(2);

    expect(parse).toHaveBeenCalledTimes(1);
    const surface = sceneAdd.mock.calls.flat().find(
      (object) => object.name === "bead-preview-surface-0",
    ) as Mesh;
    surface.geometry.computeBoundingBox();
    expect(surface.geometry.boundingBox?.max.x).toBeCloseTo(2.6, 5);
    expect(pendingFrameCount()).toBe(0);
    controller.dispose();
  });

  it("preserves camera position quaternion up and target across fast exact handoff", () => {
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    const initial = makeProject([RED_CELL, EMPTY_CELL]);
    const painted = makeProject([RED_CELL, BLUE_CELL]);
    const exactInitial = makeGridModel(1, 2);
    const exactPainted = makeGridModel(1, 2);
    exactPainted.surfacePaths[0] = {
      ...exactPainted.surfacePaths[0]!,
      d: "M 0 0 L 2 0 L 2 1 L 0 1 Z",
    };

    previewProject(controller, initial, 1);
    flushFrame(0);
    controller.update(exactInitial, 1);
    flushFrame(1);
    flushFrame(2);
    const { camera, target } = capturedControls[0]!;
    camera.position.set(17, 23, -11);
    camera.quaternion.setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.61);
    camera.up.set(0.2, 0.9, -0.3).normalize();
    target.set(3, 4, 5);
    const position = camera.position.clone();
    const quaternion = camera.quaternion.clone();
    const up = camera.up.clone();
    const savedTarget = target.clone();

    previewProject(controller, painted, 2);
    flushFrame(10);
    controller.update(exactPainted, 2);
    flushFrame(10 + BEAD_PLACEMENT_ANIMATION_MS);
    flushFrame(10 + BEAD_PLACEMENT_ANIMATION_MS + 1);

    expect(camera.position).toEqual(position);
    expect(camera.quaternion.angleTo(quaternion)).toBeCloseTo(0, 12);
    expect(camera.up).toEqual(up);
    expect(target).toEqual(savedTarget);
    controller.dispose();
  });

  it("keeps the displayed exact surface when a two phase rebuild throws", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    const current = makeGridModel(1, 2);
    controller.update(current);
    const currentExact = findNamedObject<Mesh>(
      sceneAdd,
      "bead-preview-surface-0",
    );
    const failing = makeGridModel(1, 2);
    failing.surfacePaths = [
      {
        ...failing.surfacePaths[0]!,
        d: "M 0 0 L 1 0 L 1 1 L 0 1 Z",
      },
      {
        ...failing.surfacePaths[0]!,
        d: "M 1 0 L 2 0 L 2 1 L 1 1 Z",
      },
    ];
    const originalParse = SVGLoader.prototype.parse;
    vi.spyOn(SVGLoader.prototype, "parse")
      .mockImplementationOnce(function (this: SVGLoader, source: string) {
        return originalParse.call(this, source);
      })
      .mockImplementationOnce(() => {
        throw new Error("synthetic exact build failure");
      });
    const geometryDispose = vi.spyOn(ExtrudeGeometry.prototype, "dispose");
    const materialDispose = vi.spyOn(
      MeshPhysicalMaterial.prototype,
      "dispose",
    );

    expect(() => controller.update(failing)).not.toThrow();

    const exactMeshes = sceneAdd.mock.calls.flat().filter(
      (object) => object.name.startsWith("bead-preview-surface-"),
    );
    expect(exactMeshes).toEqual([currentExact]);
    expect(currentExact.visible).toBe(true);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("attempts a deferred exact failure once without leaving a RAF retry", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    previewProject(controller, makeProject([RED_CELL]), 1);
    flushFrame(0);
    const fastMesh = findNamedObject<InstancedMesh>(
      sceneAdd,
      "bead-preview-fast-beads",
    );
    const failing = makeGridModel(1, 2);
    failing.surfacePaths = [
      {
        ...failing.surfacePaths[0]!,
        d: "M 0 0 L 1 0 L 1 1 L 0 1 Z",
      },
      {
        ...failing.surfacePaths[0]!,
        d: "M 1 0 L 2 0 L 2 1 L 1 1 Z",
      },
    ];
    const originalParse = SVGLoader.prototype.parse;
    const parse = vi.spyOn(SVGLoader.prototype, "parse")
      .mockImplementationOnce(function (this: SVGLoader, source: string) {
        return originalParse.call(this, source);
      })
      .mockImplementationOnce(() => {
        throw new Error("synthetic deferred exact build failure");
      });

    controller.update(failing, 1);
    expect(parse).not.toHaveBeenCalled();
    flushFrame(1);
    expect(parse).not.toHaveBeenCalled();
    expect(fastMesh.visible).toBe(true);
    expect(pendingFrameCount()).toBe(1);

    flushFrame(2);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(fastMesh.visible).toBe(true);
    expect(pendingFrameCount()).toBe(0);
    flushFrame(3);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(pendingFrameCount()).toBe(0);
    controller.dispose();
  });

  it("rebuilds the fast layer for reduced motion changes and removes listeners", () => {
    let matches = false;
    let changeListener: ((event: MediaQueryListEvent) => void) | null = null;
    const addEventListener = vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        changeListener = listener;
      },
    );
    const removeEventListener = vi.fn();
    const mediaQuery = {
      get matches() {
        return matches;
      },
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener,
      removeEventListener,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
    vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    previewProject(controller, makeProject([EMPTY_CELL]), 1);
    flushFrame(0);
    const firstFast = findNamedObject<InstancedMesh>(
      sceneAdd,
      "bead-preview-fast-beads",
    );
    const firstFastDispose = vi.spyOn(firstFast, "dispose");

    matches = true;
    expect(changeListener).not.toBeNull();
    changeListener!({ matches: true } as MediaQueryListEvent);
    flushFrame(1);

    const fastMeshes = sceneAdd.mock.calls.flat().filter(
      (object) => object.name === "bead-preview-fast-beads",
    ) as InstancedMesh[];
    expect(firstFastDispose).toHaveBeenCalledTimes(1);
    expect(fastMeshes).toHaveLength(2);
    previewProject(controller, makeProject([RED_CELL]), 2);
    flushFrame(10);
    expect(pendingFrameCount()).toBe(0);

    controller.dispose();
    expect(removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });

  it("uses and cleans up legacy reduced motion listeners", () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    const mediaQuery = {
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      addListener,
      removeListener,
    } as unknown as MediaQueryList;
    vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );

    expect(addListener).toHaveBeenCalledWith(expect.any(Function));
    controller.dispose();
    expect(removeListener).toHaveBeenCalledWith(expect.any(Function));
  });

  it("cancels the unified frame and releases the fast layer exactly once", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    previewProject(controller, makeProject([EMPTY_CELL]), 1);
    flushFrame(0);
    const fastMesh = findNamedObject<InstancedMesh>(
      sceneAdd,
      "bead-preview-fast-beads",
    );
    const fastDispose = vi.spyOn(fastMesh, "dispose");
    previewProject(controller, makeProject([RED_CELL]), 2);
    expect(pendingFrameCount()).toBe(1);

    controller.dispose();
    controller.dispose();

    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(pendingFrameCount()).toBe(0);
    expect(fastDispose).toHaveBeenCalledTimes(1);
    expect(capturedRenderers[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it("releases pending fast resources once when WebGL context is lost", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const onUnavailable = vi.fn();
    const canvas = document.createElement("canvas");
    const controller = createBeadThreePreviewController(canvas, onUnavailable);
    previewProject(controller, makeProject([EMPTY_CELL]), 1);
    flushFrame(0);
    const fastMesh = findNamedObject<InstancedMesh>(
      sceneAdd,
      "bead-preview-fast-beads",
    );
    const fastDispose = vi.spyOn(fastMesh, "dispose");
    previewProject(controller, makeProject([RED_CELL]), 2);

    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    controller.dispose();

    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(pendingFrameCount()).toBe(0);
    expect(fastDispose).toHaveBeenCalledTimes(1);
  });

  it("reserves primary drag for editing while keeping mouse navigation", () => {
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );

    expect(capturedControls[0]?.mouseButtons).toEqual({
      LEFT: MOUSE.ROTATE,
      MIDDLE: MOUSE.PAN,
      RIGHT: MOUSE.ROTATE,
    });
    controller.dispose();
  });

  it("renders a tapering rose-pink eraser comet trail across swiped cells and self-terminates", () => {
    const sceneAdd = vi.spyOn(Scene.prototype, "add");
    const controller = createBeadThreePreviewController(
      document.createElement("canvas"),
      vi.fn(),
    );
    previewProject(controller, makeProject([RED_CELL, BLUE_CELL]), 1);
    flushFrame(0);

    controller.setHoverHighlight?.({
      mode: "erase",
      anchorCellIndex: 0,
      brushSize: 1,
      cells: [{ cellIndex: 0, occupied: true }],
    });
    flushFrame(10);
    // Stationary hover does not keep scheduling extra animation frames
    expect(pendingFrameCount()).toBe(0);

    // Swipe eraser onto cell 1 -> cell 0 becomes a glowing comet trail wake
    controller.setHoverHighlight?.({
      mode: "erase",
      anchorCellIndex: 1,
      brushSize: 1,
      cells: [{ cellIndex: 1, occupied: true }],
    });
    const highlightMesh = findNamedObject<InstancedMesh>(
      sceneAdd,
      "bead-preview-hover-highlight",
    );
    expect(highlightMesh.count).toBe(2);

    flushFrame(100);
    expect(pendingFrameCount()).toBe(1);
    flushFrame(230);
    expect(highlightMesh.count).toBe(2);
    expect(pendingFrameCount()).toBe(1);

    // After 280ms, comet wake expires and rAF loop stops cleanly
    flushFrame(385);
    expect(highlightMesh.count).toBe(1);
    expect(pendingFrameCount()).toBe(0);

    controller.dispose();
  });

});
