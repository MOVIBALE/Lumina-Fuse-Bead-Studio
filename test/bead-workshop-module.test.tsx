import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BeadWorkshopModule,
  type BeadImageCodec,
  type BeadProcessingEngine,
} from "../src/app/BeadWorkshopModule";
import { createBeadProject } from "../src/domain/project";
import { beadEditorReducer, createBeadEditorState } from "../src/domain/editorReducer";
import type { BeadWorkspaceState } from "../src/domain/workspaceSnapshot";
import { renderBeadProject } from "../src/domain/renderer";
import type {
  BeadCell,
  BeadProject,
  PatternClassification,
  Raster,
  RecognitionRequest,
  RecognitionResult,
} from "../src/domain/types";
import type {
  WorkshopClient,
  WorkshopColorLibrary,
} from "@lumina/workshop-sdk";
import { createSdkHarness } from "./helpers/sdkHarness";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function sourceRaster(width = 4, height = 4): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  return { width, height, data };
}

function canvasContextStub(): CanvasRenderingContext2D {
  return {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    createImageData: vi.fn((width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    })),
    fillRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    putImageData: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

const DEFAULT_CLASSIFICATION: PatternClassification = {
  mode: "hard-pixel",
  confidence: 0.94,
  scores: {
    "numbered-grid": 0.1,
    "hard-pixel": 0.94,
    "ring-preview": 0.1,
  },
};

function recognitionResult(
  rows = 2,
  columns = 2,
): RecognitionResult {
  const cells = Array.from(
    { length: rows * columns },
    (_, index) =>
      index % 4 === 2
        ? ({ kind: "empty" } as const)
        : index % 4 === 3
          ? ({ kind: "empty" } as const)
          : ({
              kind: "color",
              paletteIndex: index % 2,
            } as const),
  );
  return {
    mode: "hard-pixel",
    rows,
    columns,
    palette: [
      [230, 40, 50],
      [20, 120, 210],
    ],
    cells,
    confidenceIssues: [],
  };
}

interface FakeEngineOptions {
  classifications?: Array<
    PatternClassification | Promise<PatternClassification>
  >;
  recognitions?: Array<
    RecognitionResult | Promise<RecognitionResult>
  >;
}

class FakeEngine implements BeadProcessingEngine {
  private nextId = 1;

  private readonly classifications: Array<
    PatternClassification | Promise<PatternClassification>
  >;

  private readonly recognitions: Array<
    RecognitionResult | Promise<RecognitionResult>
  >;

  readonly dispose = vi.fn();

  readonly cancelBefore = vi.fn();

  readonly cancel = vi.fn();

  readonly recognitionRequests: RecognitionRequest[] = [];

  readonly renderRequests: Array<{
    project: BeadProject;
    compression: number;
    pixelsPerCell: number;
  }> = [];

  constructor(options: FakeEngineOptions = {}) {
    this.classifications = [...(options.classifications ?? [])];
    this.recognitions = [...(options.recognitions ?? [])];
  }

  classify(_source: Raster) {
    const result =
      this.classifications.shift() ?? DEFAULT_CLASSIFICATION;
    return { id: this.nextId++, promise: Promise.resolve(result) };
  }

  recognize(request: RecognitionRequest) {
    this.recognitionRequests.push(request);
    const result =
      this.recognitions.shift() ?? recognitionResult();
    return { id: this.nextId++, promise: Promise.resolve(result) };
  }

  render(
    project: BeadProject,
    compression: number,
    pixelsPerCell: number,
  ) {
    this.renderRequests.push({ project, compression, pixelsPerCell });
    return {
      id: this.nextId++,
      promise: Promise.resolve(
        renderBeadProject(project, {
          compression,
          pixelsPerCell,
        }),
      ),
    };
  }
}

function imageCodecFor(raster: Raster): BeadImageCodec {
  return {
    decode: vi.fn().mockResolvedValue(raster),
    encodePng: vi.fn().mockResolvedValue(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
    ),
  };
}

function storedProjectRecord(project: BeadProject) {
  const source = project.source;
  return {
    projectId: project.projectId,
    schemaVersion: project.schemaVersion,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    project: {
      ...project,
      source: source
        ? {
            fileName: source.fileName,
            mimeType: source.mimeType,
            bytes: new Uint8Array([1, 2, 3]).buffer,
            pixelWidth: source.pixelWidth,
            pixelHeight: source.pixelHeight,
          }
        : null,
    },
  };
}

function projectWithSource(
  overrides: Partial<BeadProject> = {},
): BeadProject {
  const raster = sourceRaster(30, 20);
  const project = createBeadProject({
    projectId: "transactional-project",
    moduleVersion: "1.0.0",
    now: "2026-07-31T00:00:00.000Z",
    rows: 2,
    columns: 2,
    palette: [
      [230, 40, 50],
      [20, 120, 210],
    ],
    cells: [
      { kind: "color", paletteIndex: 0 },
      { kind: "empty" },
      { kind: "empty" },
      { kind: "color", paletteIndex: 1 },
    ],
    source: {
      fileName: "restored.png",
      mimeType: "image/png",
      blob: new Blob([new Uint8Array([1, 2, 3])], {
        type: "image/png",
      }),
      pixelWidth: raster.width,
      pixelHeight: raster.height,
    },
    calibration: {
      inputMode: "hard-pixel",
      crop: { x: 5, y: 0, width: 20, height: 20 },
      origin: { x: 0, y: 0 },
      orientation: {
        rotation: 0,
        flipHorizontal: false,
        flipVertical: false,
      },
      emptySelection: { kind: "none" },
    },
    beadPitchMm: 3.1,
    compression: 77,
    irregularity: 63,
    printMapping: {
      libraryId: "test-library",
      libraryLabel: "Test library",
      entries: [
        { sourcePaletteIndex: 0, colorEntryId: "red" },
        { sourcePaletteIndex: 1, colorEntryId: "blue" },
      ],
    },
  });
  return { ...project, ...overrides };
}

async function openCropAndSet(
  crop: { x: number; y: number; width: number; height: number },
) {
  fireEvent.click(
    await screen.findByRole("button", { name: "裁剪图案" }),
  );
  expect(
    screen.getByRole("dialog", { name: "裁剪图案" }),
  ).toBeInTheDocument();
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "左边距" }),
    { target: { value: crop.x } },
  );
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "上边距" }),
    { target: { value: crop.y } },
  );
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "宽度" }),
    { target: { value: crop.width } },
  );
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "高度" }),
    { target: { value: crop.height } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "应用裁剪" }),
  );
  await waitFor(() => {
    expect(
      screen.queryByRole("dialog", { name: "裁剪图案" }),
    ).not.toBeInTheDocument();
  });
}

async function expectCrop(
  crop: { x: number; y: number; width: number; height: number },
) {
  fireEvent.click(
    await screen.findByRole("button", { name: "裁剪图案" }),
  );
  expect(
    screen.getByRole("spinbutton", { name: "左边距" }),
  ).toHaveValue(crop.x);
  expect(
    screen.getByRole("spinbutton", { name: "上边距" }),
  ).toHaveValue(crop.y);
  expect(
    screen.getByRole("spinbutton", { name: "宽度" }),
  ).toHaveValue(crop.width);
  expect(
    screen.getByRole("spinbutton", { name: "高度" }),
  ).toHaveValue(crop.height);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
}

const codec: BeadImageCodec = {
  decode: vi.fn().mockResolvedValue(sourceRaster()),
  encodePng: vi.fn().mockResolvedValue(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
  ),
};

const RETRIED_LIBRARY: WorkshopColorLibrary = {
  id: "lut:aliz-ready",
  label: "Aliz RYBW",
  sourceKind: "lut",
  colors: [
    {
      id: "slot:red",
      label: "Red",
      hex: "#E3212A",
      materialId: null,
    },
  ],
};

function mountWorkshop(
  client: WorkshopClient,
  engine: BeadProcessingEngine,
  imageCodec: BeadImageCodec = codec,
) {
  return render(
    <BeadWorkshopModule
      client={client}
      locale="zh-CN"
      createEngine={() => engine}
      imageCodec={imageCodec}
      autosaveDelayMs={0}
    />,
  );
}

async function startPickedCalibration(
  engine: BeadProcessingEngine,
  raster: Raster,
  fileName = "pattern.png",
) {
  const harness = createSdkHarness({
    pickedImage: {
      name: fileName,
      mimeType: "image/png",
      bytes: new Uint8Array([1, 2, 3]).buffer,
      raster,
    },
  });
  const client = await harness.connect();
  mountWorkshop(client, engine);
  fireEvent.click(
    await screen.findByRole("button", { name: "选择拼豆图纸" }),
  );
  await screen.findByRole("heading", { name: "校准图纸" });
  return { client, harness };
}

async function startRestoredEditor(
  project: BeadProject,
  engine: BeadProcessingEngine,
  raster = sourceRaster(30, 20),
) {
  const harness = createSdkHarness({
    latestProject: storedProjectRecord(project),
  });
  const client = await harness.connect();
  mountWorkshop(client, engine, imageCodecFor(raster));
  await screen.findByRole("heading", { name: "编辑豆子" });
  return { client, harness };
}

function setGridDimensions(rows: number, columns: number) {
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "行数" }),
    { target: { value: rows } },
  );
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "列数" }),
    { target: { value: columns } },
  );
}

async function returnToCalibration() {
  fireEvent.click(
    screen.getByRole("button", { name: "返回校准" }),
  );
  await screen.findByRole("heading", { name: "校准图纸" });
}

async function returnToEditor() {
  fireEvent.click(
    screen.getByRole("button", { name: "返回编辑器" }),
  );
  await screen.findByRole("heading", { name: "编辑豆子" });
}

async function recognizeAndOpenEditor() {
  const recognizeButton = screen.getByRole("button", {
    name: "识别拼豆矩阵",
  });
  await waitFor(() => expect(recognizeButton).toBeEnabled());
  fireEvent.click(recognizeButton);
  await screen.findByRole("heading", { name: "编辑豆子" });
}

function switchWorkbenchMode(name: "编辑豆子" | "调整熨烫" | "打印准备") {
  fireEvent.click(screen.getByRole("button", { name }));
}

function expandAuxiliaryView() {
  fireEvent.click(
    screen.getByRole("button", { name: "展开 2D 校对" }),
  );
}

describe("BeadWorkshopModule", () => {
  beforeEach(() => {
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getContext",
    ).mockReturnValue(null);
    vi.mocked(codec.decode).mockClear();
    vi.mocked(codec.encodePng).mockClear();
  });

  it("runs upload, calibration, recognition, editing, and autosave through SDK RPC", async () => {
    const raster = sourceRaster();
    const harness = createSdkHarness({
      pickedImage: {
        name: "pattern.png",
        mimeType: "image/png",
        bytes: new Uint8Array([1, 2, 3]).buffer,
        raster,
      },
    });
    const client = await harness.connect();
    render(
      <BeadWorkshopModule
        client={client}
        locale="zh-CN"
        createEngine={() => new FakeEngine()}
        imageCodec={codec}
        autosaveDelayMs={0}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "选择拼豆图纸" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "选择拼豆图纸" }).closest("main"),
    ).not.toHaveClass("module-shell--editor");
    fireEvent.click(
      screen.getByRole("button", { name: "选择拼豆图纸" }),
    );
    expect(
      await screen.findByRole("heading", { name: "校准图纸" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "图中没有空位" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "识别拼豆矩阵" }),
    );

    expect(
      await screen.findByRole("heading", { name: "编辑豆子" }),
    ).toBeInTheDocument();
    const editorShell = screen
      .getByRole("heading", { name: "编辑豆子" })
      .closest("main");
    expect(editorShell).toHaveClass("module-shell--editor");
    expect(editorShell?.querySelector(".workbench-stack")).toHaveClass(
      "workbench-stack--editor",
    );
    await waitFor(() => {
      expect(harness.savedProjects().length).toBeGreaterThan(0);
    });
    const saved = harness.savedProjects().at(-1);
    expect(saved?.project).toMatchObject({
      rows: 2,
      columns: 2,
      compression: 50,
      source: {
        fileName: "pattern.png",
        mimeType: "image/png",
      },
    });
    expect(harness.methods()).toEqual(
      expect.arrayContaining([
        "project.latest",
        "image.pick",
        "project.save",
        "status.diagnostics",
      ]),
    );
    client.close();
    harness.close();
  });

  it("opens a saved auto-expanding blank board without picking an image", async () => {
    const harness = createSdkHarness();
    const client = await harness.connect();
    mountWorkshop(client, new FakeEngine());

    fireEvent.click(
      await screen.findByRole("button", { name: "新建空白底板" }),
    );

    expect(
      await screen.findByRole("heading", { name: "编辑豆子" }),
    ).toBeInTheDocument();
    expandAuxiliaryView();
    expect(screen.getByRole("button", { name: "原图" })).toBeDisabled();
    await waitFor(() => {
      expect(harness.savedProjects().length).toBeGreaterThan(0);
    });
    expect(harness.savedProjects().at(-1)?.project).toMatchObject({
      rows: 32,
      columns: 32,
      source: null,
      canvasMode: "auto-expand",
    });
    expect(harness.methods()).not.toContain("image.pick");
    client.close();
    harness.close();
  });

  it("captures a live unsaved workspace and adopts a prepared snapshot through the SDK channel", async () => {
    const harness = createSdkHarness();
    const client = await harness.connect();
    const engine = new FakeEngine();
    const mounted = render(<BeadWorkshopModule client={client} locale="zh-CN" createEngine={() => engine} imageCodec={codec} autosaveDelayMs={60_000} />);
    await screen.findByRole("button", { name: "新建空白底板" });
    const empty = await harness.projectRequest("capture");
    fireEvent.click(screen.getByRole("button", { name: "新建空白底板" }));
    await screen.findByRole("heading", { name: "编辑豆子" });
    const live = await harness.projectRequest("capture");
    expect(live).toMatchObject({ schemaVersion: "bead-workspace/v1", state: { stage: "editor", editorState: { present: { rows: 32, columns: 32 } } } });
    expect(harness.savedProjects()).toHaveLength(0);
    const prepared = await harness.projectRequest("prepare", empty);
    expect(screen.getByRole("heading", { name: "编辑豆子" })).toBeInTheDocument();
    let committed!: Promise<unknown>;
    await act(async () => {
      committed = harness.projectRequest("commit", prepared);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await committed;
    expect(await harness.projectRequest("capture")).toMatchObject({ state: { stage: "upload", editorState: null } });
    const restore = await harness.projectRequest("prepare", live);
    await act(async () => {
      committed = harness.projectRequest("commit", restore);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await committed;
    expect(screen.getByRole("heading", { name: "编辑豆子" })).toBeInTheDocument();
    mounted.unmount(); client.close(); harness.close();
  });

  it("round-trips a long live editing history through the SDK snapshot channel", async () => {
    const harness = createSdkHarness();
    const client = await harness.connect();
    const mounted = render(
      <BeadWorkshopModule
        client={client}
        locale="zh-CN"
        createEngine={() => new FakeEngine()}
        imageCodec={codec}
        autosaveDelayMs={60_000}
      />,
    );
    try {
      await screen.findByRole("button", { name: "新建空白底板" });
      const snapshot = await harness.projectRequest("capture") as {
        schemaVersion: string;
        state: BeadWorkspaceState;
      };
      let editor = createBeadEditorState(createBeadProject({
        projectId: "long-history",
        moduleVersion: "1.0.9-dev.0",
        now: "2026-01-01T00:00:00Z",
        rows: 2,
        columns: 2,
      }));
      for (let index = 0; index < 2049; index++) {
        editor = beadEditorReducer(editor, {
          type: "apply-tool",
          tool: index % 2 === 0 ? "paint" : "erase",
          cellIndex: 1,
        });
      }
      editor = beadEditorReducer(editor, { type: "undo" });
      expect(editor.past).toHaveLength(2048);
      expect(editor.future).toHaveLength(1);
      snapshot.state = { ...snapshot.state, stage: "editor", editorState: editor };
      const prepared = await harness.projectRequest("prepare", snapshot);
      let committed!: Promise<unknown>;
      await act(async () => {
        committed = harness.projectRequest("commit", prepared);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      await committed;
      await screen.findByRole("heading", { name: "编辑豆子" });
      expect(await harness.projectRequest("capture")).toMatchObject({
        state: { editorState: editor },
      });
      fireEvent.click(screen.getByRole("button", { name: "重做" }));
      const redone = beadEditorReducer(editor, { type: "redo" });
      expect(await harness.projectRequest("capture")).toMatchObject({
        state: { editorState: redone },
      });
      fireEvent.click(screen.getByRole("button", { name: "撤销" }));
      expect(await harness.projectRequest("capture")).toMatchObject({
        state: { editorState: editor },
      });
      expect(harness.savedProjects()).toHaveLength(0);
    } finally {
      mounted.unmount();
      client.close();
      harness.close();
    }
  });

  it("trims blank auto-canvas margins before rendering the Lumina handoff", async () => {
    const cells: BeadCell[] = Array.from(
      { length: 4 * 4 },
      () => ({ kind: "empty" }),
    );
    cells[1 * 4 + 2] = { kind: "color", paletteIndex: 0 };
    const project = createBeadProject({
      projectId: "auto-handoff",
      moduleVersion: "1.0.0",
      now: "2026-07-31T00:00:00.000Z",
      rows: 4,
      columns: 4,
      palette: [[230, 40, 50]],
      cells,
      canvasMode: "auto-expand",
    });
    const engine = new FakeEngine();
    const { client, harness } = await startRestoredEditor(project, engine);

    fireEvent.click(
      screen.getByRole("button", { name: "生成打印文件" }),
    );
    await screen.findByRole("dialog", {
      name: "确认生成打印文件？",
    });

    expect(engine.renderRequests).toHaveLength(1);
    expect(engine.renderRequests[0]?.project).toMatchObject({
      rows: 1,
      columns: 1,
      canvasMode: "auto-expand",
    });
    expect(engine.renderRequests[0]?.project.cells).toEqual([
      { kind: "color", paletteIndex: 0 },
    ]);
    client.close();
    harness.close();
  });

  it("replaces an unsafe screenshot guess with the post-crop suggestion", async () => {
    const engine = new FakeEngine({
      classifications: [
        {
          mode: "numbered-grid",
          confidence: 0.94,
          scores: {
            "numbered-grid": 0.94,
            "hard-pixel": 0.15,
            "ring-preview": 0.73,
          },
          requiresCrop: true,
        },
        {
          mode: "ring-preview",
          confidence: 0.91,
          scores: {
            "numbered-grid": 0.2,
            "hard-pixel": 0.15,
            "ring-preview": 0.91,
          },
          requiresCrop: false,
        },
      ],
    });
    const { client, harness } = await startPickedCalibration(
      engine,
      sourceRaster(30, 20),
      "screenshot.png",
    );

    expect(
      await screen.findByText(
        "检测到截图边框、多图布局或图纸未完整显示，请先裁剪并只保留一张完整图纸。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "图纸类型" }),
    ).toHaveValue("numbered-grid");

    await openCropAndSet({ x: 5, y: 0, width: 20, height: 20 });

    await screen.findByText("建议：圆豆俯视图 · 置信度 91%");
    expect(
      screen.getByRole("combobox", { name: "图纸类型" }),
    ).toHaveValue("ring-preview");
    expect(
      screen.queryByText(
        "检测到截图边框、多图布局或图纸未完整显示，请先裁剪并只保留一张完整图纸。",
      ),
    ).not.toBeInTheDocument();

    client.close();
    harness.close();
  });

  it("wires recalibration, committed draft restoration, rollback, crop, and new-project navigation", async () => {
    const raster = sourceRaster(30, 20);
    const engine = new FakeEngine({
      recognitions: [recognitionResult(2, 4)],
    });
    const { client, harness } = await startPickedCalibration(
      engine,
      raster,
      "transaction.png",
    );

    await screen.findByText("建议：硬边像素图 · 置信度 94%");
    await openCropAndSet({ x: 5, y: 5, width: 20, height: 10 });
    setGridDimensions(2, 4);
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "网格原点 X" }),
      { target: { value: 4 } },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "网格原点 Y" }),
      { target: { value: 2 } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "旋转 180°" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "水平翻转" }),
    );
    const canvas = screen.getByRole("img", {
      name: "拼豆图纸网格校准",
    });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 200,
      width: 400,
      height: 200,
      toJSON: () => ({}),
    });
    fireEvent.click(
      screen.getByRole("button", { name: "选择一个空位" }),
    );
    fireEvent.pointerDown(canvas, { clientX: 120, clientY: 80 });
    expect(screen.getByText("空位样本：第 1 格")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "选择透明支撑" }),
    ).not.toBeInTheDocument();

    await recognizeAndOpenEditor();
    await waitFor(() => {
      expect(harness.savedProjects().at(-1)?.project).toMatchObject({
        rows: 2,
        columns: 4,
        calibration: {
          crop: { x: 5, y: 5, width: 20, height: 10 },
          origin: { x: 4, y: 2 },
          orientation: {
            rotation: 180,
            flipHorizontal: true,
            flipVertical: false,
          },
          emptySelection: { kind: "sample", cellIndex: 0 },
        },
      });
    });
    const committed = harness.savedProjects().at(-1)?.project;
    expect(
      screen.getByRole("button", { name: "返回校准" }),
    ).toBeInTheDocument();

    await returnToCalibration();
    expect(
      screen.getByRole("spinbutton", { name: "行数" }),
    ).toHaveValue(2);
    expect(
      screen.getByRole("spinbutton", { name: "列数" }),
    ).toHaveValue(4);
    expect(
      screen.getByRole("spinbutton", { name: "网格原点 X" }),
    ).toHaveValue(4);
    expect(
      screen.getByRole("spinbutton", { name: "网格原点 Y" }),
    ).toHaveValue(2);
    expect(
      screen.getByRole("button", { name: "旋转 180°" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "水平翻转" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("空位样本：第 1 格")).toBeInTheDocument();
    await expectCrop({ x: 5, y: 5, width: 20, height: 10 });

    await returnToEditor();
    expect(screen.getByText("4 × 2")).toBeInTheDocument();
    expect(harness.savedProjects().at(-1)?.project).toEqual(
      committed,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "新建图纸" }),
    );
    expect(
      await screen.findByRole("button", { name: "选择拼豆图纸" }),
    ).toBeInTheDocument();
    client.close();
    harness.close();
  });

  it("restores pre-rotation dimensions for non-square 90-degree recognition", async () => {
    const raster = sourceRaster(30, 20);
    const engine = new FakeEngine({
      recognitions: [
        recognitionResult(3, 2),
        recognitionResult(3, 2),
      ],
    });
    const { client, harness } = await startPickedCalibration(
      engine,
      raster,
      "rotated.png",
    );

    await screen.findByText("建议：硬边像素图 · 置信度 94%");
    setGridDimensions(2, 3);
    fireEvent.click(
      screen.getByRole("button", { name: "旋转 90°" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "图中没有空位" }),
    );
    await recognizeAndOpenEditor();

    await returnToCalibration();
    expect(
      screen.getByRole("spinbutton", { name: "行数" }),
    ).toHaveValue(2);
    expect(
      screen.getByRole("spinbutton", { name: "列数" }),
    ).toHaveValue(3);
    await recognizeAndOpenEditor();

    expect(engine.recognitionRequests).toHaveLength(2);
    expect(engine.recognitionRequests.map(({ rows, columns }) => ({
      rows,
      columns,
    }))).toEqual([
      { rows: 2, columns: 3 },
      { rows: 2, columns: 3 },
    ]);
    client.close();
    harness.close();
  });

  it("keeps calibrated grid intent when the crop is refined", async () => {
    const raster = sourceRaster(30, 20);
    const project = projectWithSource({
      calibration: {
        inputMode: "numbered-grid",
        crop: { x: 5, y: 0, width: 20, height: 20 },
        origin: { x: 0, y: 0 },
        orientation: {
          rotation: 180,
          flipHorizontal: true,
          flipVertical: false,
        },
        emptySelection: { kind: "sample", cellIndex: 0 },
      },
    });
    const { client, harness } = await startRestoredEditor(
      project,
      new FakeEngine(),
      raster,
    );

    await returnToCalibration();
    await openCropAndSet({ x: 3, y: 0, width: 22, height: 20 });

    expect(
      screen.getByRole("spinbutton", { name: "行数" }),
    ).toHaveValue(2);
    expect(
      screen.getByRole("spinbutton", { name: "列数" }),
    ).toHaveValue(2);
    expect(
      screen.getByRole("spinbutton", { name: "网格原点 X" }),
    ).toHaveValue(2);
    expect(
      screen.getByRole("spinbutton", { name: "网格原点 Y" }),
    ).toHaveValue(0);
    expect(
      screen.getByRole("button", { name: "旋转 180°" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "水平翻转" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("空位样本：第 1 格")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "识别拼豆矩阵" }),
      ).toBeEnabled();
    });

    client.close();
    harness.close();
  });

  it("reanalyzes a refined crop without overwriting confirmed calibration", async () => {
    const raster = sourceRaster(30, 20);
    const project = projectWithSource({
      calibration: {
        inputMode: "numbered-grid",
        crop: { x: 5, y: 0, width: 20, height: 20 },
        origin: { x: 0, y: 0 },
        orientation: {
          rotation: 0,
          flipHorizontal: false,
          flipVertical: false,
        },
        emptySelection: { kind: "none" },
      },
    });
    const engine = new FakeEngine({
      classifications: [
        DEFAULT_CLASSIFICATION,
        {
          mode: "ring-preview",
          confidence: 0.88,
          scores: {
            "numbered-grid": 0.12,
            "hard-pixel": 0.18,
            "ring-preview": 0.88,
          },
        },
      ],
    });
    const { client, harness } = await startRestoredEditor(
      project,
      engine,
      raster,
    );

    await returnToCalibration();
    await screen.findByText("建议：硬边像素图 · 置信度 94%");
    await openCropAndSet({ x: 3, y: 0, width: 22, height: 20 });

    expect(
      await screen.findByText("建议：圆豆俯视图 · 置信度 88%"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "图纸类型" }),
    ).toHaveValue("numbered-grid");
    expect(
      screen.getByRole("spinbutton", { name: "行数" }),
    ).toHaveValue(2);
    expect(
      screen.getByRole("spinbutton", { name: "列数" }),
    ).toHaveValue(2);

    client.close();
    harness.close();
  });

  it("visibly tightens a non-square calibration to the confirmed grid", async () => {
    const raster = sourceRaster(30, 20);
    const project = projectWithSource({
      calibration: {
        inputMode: "numbered-grid",
        crop: { x: 5, y: 0, width: 20, height: 16 },
        origin: { x: 0, y: 0 },
        orientation: {
          rotation: 0,
          flipHorizontal: false,
          flipVertical: false,
        },
        emptySelection: { kind: "none" },
      },
    });
    const { client, harness } = await startRestoredEditor(
      project,
      new FakeEngine(),
      raster,
    );

    await returnToCalibration();
    expect(
      screen.getByText(
        "当前网格不是正方形。可自动收紧右侧或下侧边界，也可手动调整行列、原点与裁剪。",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "自动收紧到正方形网格",
      }),
    );

    expect(
      screen.queryByText(
        "当前网格不是正方形。可自动收紧右侧或下侧边界，也可手动调整行列、原点与裁剪。",
      ),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "识别拼豆矩阵" }),
      ).toBeEnabled();
    });
    await expectCrop({ x: 5, y: 0, width: 16, height: 16 });

    client.close();
    harness.close();
  });

  it("discards staged crop and grid edits when returning to the editor", async () => {
    const raster = sourceRaster(30, 20);
    const engine = new FakeEngine({
      recognitions: [recognitionResult(2, 2)],
    });
    const { client, harness } = await startPickedCalibration(
      engine,
      raster,
      "rollback.png",
    );

    await screen.findByText("建议：硬边像素图 · 置信度 94%");
    await openCropAndSet({ x: 5, y: 0, width: 20, height: 20 });
    setGridDimensions(2, 2);
    fireEvent.click(
      screen.getByRole("button", { name: "图中没有空位" }),
    );
    await recognizeAndOpenEditor();

    await returnToCalibration();
    await openCropAndSet({ x: 0, y: 0, width: 10, height: 20 });
    setGridDimensions(2, 1);
    await returnToEditor();

    await returnToCalibration();
    expect(
      screen.getByRole("spinbutton", { name: "行数" }),
    ).toHaveValue(2);
    expect(
      screen.getByRole("spinbutton", { name: "列数" }),
    ).toHaveValue(2);
    await expectCrop({ x: 5, y: 0, width: 20, height: 20 });
    client.close();
    harness.close();
  });

  it("rolls back a rejected recalibration without mutating the committed project", async () => {
    const raster = sourceRaster(30, 20);
    const project = projectWithSource();
    const recognition = deferred<RecognitionResult>();
    const engine = new FakeEngine({
      recognitions: [recognition.promise],
    });
    const { client, harness } = await startRestoredEditor(
      project,
      engine,
      raster,
    );
    await waitFor(() => {
      expect(harness.savedProjects().at(-1)?.project).toBeDefined();
    });
    const committed = harness.savedProjects().at(-1)?.project;

    await returnToCalibration();
    await openCropAndSet({ x: 0, y: 0, width: 10, height: 20 });
    setGridDimensions(2, 1);
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "网格原点 X" }),
      { target: { value: 0 } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "图中没有空位" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "识别拼豆矩阵" }),
    );
    await act(async () => {
      recognition.reject(new Error("recognition failed"));
      await recognition.promise.catch(() => undefined);
    });

    expect(
      await screen.findByRole("heading", {
        name: "编辑豆子",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "本地图像处理失败。项目仍在本机，请重试当前步骤。",
      ),
    ).toBeInTheDocument();
    expect(harness.savedProjects().at(-1)?.project).toEqual(
      committed,
    );
    expect(committed).toMatchObject({
      projectId: project.projectId,
      cells: project.cells,
      beadPitchMm: 3.1,
      compression: 77,
      irregularity: 63,
      printMapping: project.printMapping,
      calibration: {
        crop: { x: 5, y: 0, width: 20, height: 20 },
      },
    });

    await returnToCalibration();
    await expectCrop({ x: 5, y: 0, width: 20, height: 20 });
    client.close();
    harness.close();
  });

  it("atomically replaces a recalibrated project and preserves full undo and redo checkpoints", async () => {
    const raster = sourceRaster(30, 20);
    const oldUpdatedAt = "2099-01-01T00:00:00.000Z";
    const project = projectWithSource({ updatedAt: oldUpdatedAt });
    const replacement = recognitionResult(1, 3);
    const engine = new FakeEngine({
      recognitions: [replacement],
    });
    const { client, harness } = await startRestoredEditor(
      project,
      engine,
      raster,
    );

    await returnToCalibration();
    await recognizeAndOpenEditor();
    await waitFor(() => {
      expect(harness.savedProjects().at(-1)?.project).toMatchObject({
        rows: 1,
        columns: 3,
        cells: replacement.cells,
        printMapping: null,
      });
    });
    const savedReplacement = harness.savedProjects().at(-1)
      ?.project as BeadProject;
    expect(savedReplacement).toMatchObject({
      projectId: project.projectId,
      createdAt: project.createdAt,
      beadPitchMm: project.beadPitchMm,
      compression: project.compression,
      irregularity: project.irregularity,
      cells: replacement.cells,
      source: {
        fileName: "restored.png",
        pixelWidth: 30,
        pixelHeight: 20,
      },
      printMapping: null,
    });
    expect(savedReplacement.updatedAt).toBe(
      "2099-01-01T00:00:00.001Z",
    );

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => {
      expect(harness.savedProjects().at(-1)?.project).toMatchObject({
        rows: project.rows,
        columns: project.columns,
        cells: project.cells,
        printMapping: project.printMapping,
      });
    });
    const undone = harness.savedProjects().at(-1)
      ?.project as BeadProject;
    expect({
      ...undone,
      source: undefined,
      updatedAt: undefined,
    }).toMatchObject({
      ...project,
      source: undefined,
      updatedAt: undefined,
    });
    expect(undone.updatedAt).toBe(savedReplacement.updatedAt);

    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    await waitFor(() => {
      expect(harness.savedProjects().at(-1)?.project).toMatchObject({
        rows: 1,
        columns: 3,
        cells: replacement.cells,
        printMapping: null,
      });
    });
    const redone = harness.savedProjects().at(-1)
      ?.project as BeadProject;
    expect(redone.projectId).toBe(project.projectId);
    expect(redone.createdAt).toBe(project.createdAt);
    expect(redone.updatedAt).toBe(savedReplacement.updatedAt);
    const saveTimes = harness
      .savedProjects()
      .map((record) => Date.parse(record.updatedAt));
    expect(
      saveTimes.every(
        (timestamp, index) =>
          index === 0 || timestamp >= saveTimes[index - 1],
      ),
    ).toBe(true);
    client.close();
    harness.close();
  });

  it("keeps a staged original image aligned with recalibration checkpoints through undo and redo", async () => {
    vi.mocked(
      HTMLCanvasElement.prototype.getContext,
    ).mockReturnValue(canvasContextStub());
    const raster = sourceRaster(30, 20);
    const project = projectWithSource();
    const engine = new FakeEngine({
      recognitions: [recognitionResult(2, 3)],
    });
    const { client, harness } = await startRestoredEditor(
      project,
      engine,
      raster,
    );

    await returnToCalibration();
    fireEvent.click(
      screen.getByRole("button", { name: "裁剪图案" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "使用原图" }),
    );
    setGridDimensions(2, 3);
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "网格原点 X" }),
      { target: { value: 0 } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "图中没有空位" }),
    );
    await recognizeAndOpenEditor();
    expect(engine.recognitionRequests.at(-1)?.source).toMatchObject({
      width: 30,
      height: 20,
    });
    await waitFor(() => {
      expect(
        (
          harness.savedProjects().at(-1)?.project as
            | BeadProject
            | undefined
        )?.calibration.crop,
      ).toBeNull();
    });

    expandAuxiliaryView();
    fireEvent.click(screen.getByRole("button", { name: "原图" }));
    const sourceCanvas = screen.getByRole("img", {
      name: "拼豆图纸原图",
    }) as HTMLCanvasElement;
    await waitFor(() => {
      expect(sourceCanvas.width).toBe(30);
      expect(sourceCanvas.height).toBe(20);
    });

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => {
      expect(sourceCanvas.width).toBe(20);
      expect(sourceCanvas.height).toBe(20);
    });
    await returnToCalibration();
    await expectCrop({ x: 5, y: 0, width: 20, height: 20 });

    await returnToEditor();
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expandAuxiliaryView();
    fireEvent.click(screen.getByRole("button", { name: "原图" }));
    const redoneSourceCanvas = screen.getByRole("img", {
      name: "拼豆图纸原图",
    }) as HTMLCanvasElement;
    await waitFor(() => {
      expect(redoneSourceCanvas.width).toBe(30);
      expect(redoneSourceCanvas.height).toBe(20);
    });
    await waitFor(() => {
      expect(
        (
          harness.savedProjects().at(-1)?.project as
            | BeadProject
            | undefined
        )?.calibration.crop,
      ).toBeNull();
    });
    await returnToCalibration();
    await expectCrop({ x: 0, y: 0, width: 30, height: 20 });

    client.close();
    harness.close();
  });

  it.each(["resolve", "reject"] as const)(
    "keeps a newer classification authoritative when an old task %s arrives late",
    async (settlement) => {
      const raster = sourceRaster(30, 20);
      const project = projectWithSource();
      const oldClassification = deferred<PatternClassification>();
      const newClassification = deferred<PatternClassification>();
      const engine = new FakeEngine({
        classifications: [
          oldClassification.promise,
          newClassification.promise,
        ],
      });
      const { client, harness } = await startRestoredEditor(
        project,
        engine,
        raster,
      );

      await returnToCalibration();
      expect(
        screen.getByText("正在分析图纸类型…"),
      ).toBeInTheDocument();
      const returnButton = screen.getByRole("button", {
        name: "返回编辑器",
      });
      expect(returnButton).toBeEnabled();
      fireEvent.click(returnButton);
      await screen.findByRole("heading", {
        name: "编辑豆子",
      });
      await returnToCalibration();
      expect(
        screen.getByText("正在分析图纸类型…"),
      ).toBeInTheDocument();

      await act(async () => {
        if (settlement === "resolve") {
          oldClassification.resolve({
            mode: "numbered-grid",
            confidence: 0.99,
            scores: {
              "numbered-grid": 0.99,
              "hard-pixel": 0.01,
              "ring-preview": 0,
            },
          });
          await oldClassification.promise;
        } else {
          oldClassification.reject(new Error("stale classifier"));
          await oldClassification.promise.catch(() => undefined);
        }
      });
      expect(
        screen.getByText("正在分析图纸类型…"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          "本地图像处理失败。项目仍在本机，请重试当前步骤。",
        ),
      ).not.toBeInTheDocument();
      expect(
        harness.payloads("status.progress").at(-1),
      ).not.toBeNull();

      await act(async () => {
        newClassification.resolve({
          mode: "ring-preview",
          confidence: 0.88,
          scores: {
            "numbered-grid": 0.02,
            "hard-pixel": 0.1,
            "ring-preview": 0.88,
          },
        });
        await newClassification.promise;
      });
      expect(
        await screen.findByText(
          "建议：圆豆俯视图 · 置信度 88%",
        ),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(
          harness.payloads("status.progress").at(-1),
        ).toBeNull();
      });
      client.close();
      harness.close();
    },
  );

  it("keeps classification failure neutral while recognition has its own progress state", async () => {
    const raster = sourceRaster(30, 20);
    const classification = deferred<PatternClassification>();
    const recognition = deferred<RecognitionResult>();
    const engine = new FakeEngine({
      classifications: [classification.promise],
      recognitions: [recognition.promise],
    });
    const { client, harness } = await startPickedCalibration(
      engine,
      raster,
      "manual-confirmation.png",
    );

    expect(
      screen.getByText("正在分析图纸类型…"),
    ).toBeInTheDocument();
    await act(async () => {
      classification.reject(new Error("classification unavailable"));
      await classification.promise.catch(() => undefined);
    });
    expect(
      await screen.findByText(
        "未能自动判断图纸类型，请手动确认。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "本地图像处理失败。项目仍在本机，请重试当前步骤。",
      ),
    ).not.toBeInTheDocument();

    setGridDimensions(2, 3);
    fireEvent.click(
      screen.getByRole("button", { name: "图中没有空位" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "识别拼豆矩阵" }),
    );
    expect(
      screen.getByText(
        "未能自动判断图纸类型，请手动确认。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("正在分析图纸类型…"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "正在识别拼豆矩阵…",
      }),
    ).toBeDisabled();

    await act(async () => {
      recognition.resolve(recognitionResult(2, 2));
      await recognition.promise;
    });
    expect(
      await screen.findByRole("heading", {
        name: "编辑豆子",
      }),
    ).toBeInTheDocument();
    client.close();
    harness.close();
  });

  it("clears the host error when a failed image pick is retried successfully", async () => {
    const raster = sourceRaster();
    const harness = createSdkHarness();
    const client = await harness.connect();
    vi.spyOn(client.image, "pick")
      .mockRejectedValueOnce(new Error("decode failed"))
      .mockResolvedValueOnce({
        name: "pattern.png",
        mimeType: "image/png",
        bytes: new Uint8Array([1, 2, 3]).buffer,
        raster,
      });
    render(
      <BeadWorkshopModule
        client={client}
        locale="zh-CN"
        createEngine={() => new FakeEngine()}
        imageCodec={codec}
        autosaveDelayMs={0}
      />,
    );

    const pickImage = await screen.findByRole("button", {
      name: "选择拼豆图纸",
    });
    fireEvent.click(pickImage);
    expect(
      await screen.findByText(
        "无法读取这张图。请确认文件格式后重试。",
      ),
    ).toBeInTheDocument();
    expect(harness.payloads("status.error")).toContainEqual({
      code: "image-pick-failed",
      message: "无法读取这张图。请确认文件格式后重试。",
      retryable: true,
    });

    fireEvent.click(pickImage);
    expect(
      await screen.findByRole("heading", { name: "校准图纸" }),
    ).toBeInTheDocument();
    expect(harness.payloads("status.error").at(-1)).toBeNull();

    client.close();
    harness.close();
  });

  it("clears a transient autosave error after the next save succeeds", async () => {
    const project = projectWithSource();
    const raster = sourceRaster(30, 20);
    const harness = createSdkHarness({
      latestProject: storedProjectRecord(project),
    });
    const client = await harness.connect();
    const save = vi
      .spyOn(client.projects, "save")
      .mockRejectedValueOnce(new Error("temporary save failure"))
      .mockResolvedValue(undefined);
    mountWorkshop(client, new FakeEngine(), imageCodecFor(raster));

    await screen.findByRole("heading", {
      name: "编辑豆子",
    });
    expect(
      await screen.findByText(
        "自动保存暂时失败。当前页面中的编辑不会丢失。",
      ),
    ).toBeInTheDocument();
    expect(harness.payloads("status.error")).toContainEqual({
      code: "project-save-failed",
      message: "自动保存暂时失败。当前页面中的编辑不会丢失。",
      retryable: true,
    });

    switchWorkbenchMode("调整熨烫");
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "豆子间距" }),
      { target: { value: "3.2" } },
    );

    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByText(
          "自动保存暂时失败。当前页面中的编辑不会丢失。",
        ),
      ).not.toBeInTheDocument();
    });
    expect(harness.payloads("status.error").at(-1)).toBeNull();

    client.close();
    harness.close();
  });

  it("ignores a stale autosave failure after a newer save succeeds", async () => {
    const project = projectWithSource();
    const raster = sourceRaster(30, 20);
    const firstSave = deferred<void>();
    const harness = createSdkHarness({
      latestProject: storedProjectRecord(project),
    });
    const client = await harness.connect();
    const save = vi
      .spyOn(client.projects, "save")
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValue(undefined);
    mountWorkshop(client, new FakeEngine(), imageCodecFor(raster));

    await screen.findByRole("heading", {
      name: "编辑豆子",
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    switchWorkbenchMode("调整熨烫");
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "豆子间距" }),
      { target: { value: "3.2" } },
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));

    await act(async () => {
      firstSave.reject(new Error("late save failure"));
      await firstSave.promise.catch(() => undefined);
    });

    expect(
      screen.queryByText(
        "自动保存暂时失败。当前页面中的编辑不会丢失。",
      ),
    ).not.toBeInTheDocument();
    expect(harness.payloads("status.error")).not.toContainEqual(
      expect.objectContaining({ code: "project-save-failed" }),
    );

    client.close();
    harness.close();
  });

  it("queues the latest edit before a rapid page exit", async () => {
    const project = projectWithSource();
    const raster = sourceRaster(30, 20);
    const harness = createSdkHarness({
      latestProject: storedProjectRecord(project),
    });
    const client = await harness.connect();
    const save = vi.spyOn(client.projects, "save");
    render(
      <BeadWorkshopModule
        client={client}
        locale="zh-CN"
        createEngine={() => new FakeEngine()}
        imageCodec={imageCodecFor(raster)}
        autosaveDelayMs={10_000}
      />,
    );

    await screen.findByRole("heading", {
      name: "编辑豆子",
    });
    switchWorkbenchMode("调整熨烫");
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "豆子间距" }),
      { target: { value: "3.2" } },
    );
    expect(save).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pagehide"));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        project: expect.objectContaining({ beadPitchMm: 3.2 }),
      }),
    );

    client.close();
    harness.close();
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a pending image pick that %s after unmount",
    async (settlement) => {
      const pendingPick = deferred<
        Awaited<ReturnType<WorkshopClient["image"]["pick"]>>
      >();
      const harness = createSdkHarness();
      const client = await harness.connect();
      vi.spyOn(client.image, "pick").mockReturnValue(
        pendingPick.promise,
      );
      const progress = vi.spyOn(client.status, "progress");
      const error = vi.spyOn(client.status, "error");
      const engine = new FakeEngine();
      const classify = vi.spyOn(engine, "classify");
      const createEngine = vi.fn(() => engine);
      const view = render(
        <BeadWorkshopModule
          client={client}
          locale="zh-CN"
          createEngine={createEngine}
          imageCodec={codec}
          autosaveDelayMs={0}
        />,
      );

      fireEvent.click(
        await screen.findByRole("button", {
          name: "选择拼豆图纸",
        }),
      );
      view.unmount();
      const progressCallsAfterCleanup = progress.mock.calls.length;
      const errorCallsAfterCleanup = error.mock.calls.length;

      await act(async () => {
        if (settlement === "resolve") {
          pendingPick.resolve({
            name: "late.png",
            mimeType: "image/png",
            bytes: new Uint8Array([1, 2, 3]).buffer,
            raster: sourceRaster(),
          });
        } else {
          pendingPick.reject(new Error("late picker failure"));
        }
        await pendingPick.promise.catch(() => undefined);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });

      expect(createEngine).not.toHaveBeenCalled();
      expect(classify).not.toHaveBeenCalled();
      expect(progress).toHaveBeenCalledTimes(
        progressCallsAfterCleanup,
      );
      expect(error).toHaveBeenCalledTimes(errorCallsAfterCleanup);

      client.close();
      harness.close();
    },
  );

  it("keeps a pending image pick current across a locale rerender", async () => {
    const pendingPick = deferred<
      Awaited<ReturnType<WorkshopClient["image"]["pick"]>>
    >();
    const harness = createSdkHarness();
    const client = await harness.connect();
    vi.spyOn(client.image, "pick").mockReturnValue(
      pendingPick.promise,
    );
    const engine = new FakeEngine();
    const classify = vi.spyOn(engine, "classify");
    const createEngine = vi.fn(() => engine);
    const module = (locale: "zh-CN" | "en-US") => (
      <BeadWorkshopModule
        client={client}
        locale={locale}
        createEngine={createEngine}
        imageCodec={codec}
        autosaveDelayMs={0}
      />
    );
    const view = render(module("zh-CN"));

    fireEvent.click(
      await screen.findByRole("button", {
        name: "选择拼豆图纸",
      }),
    );
    view.rerender(module("en-US"));
    await act(async () => {
      pendingPick.resolve({
        name: "locale-safe.png",
        mimeType: "image/png",
        bytes: new Uint8Array([1, 2, 3]).buffer,
        raster: sourceRaster(),
      });
      await pendingPick.promise;
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(
      await screen.findByRole("heading", {
        name: "Calibrate pattern",
      }),
    ).toBeInTheDocument();
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledTimes(1);

    view.unmount();
    client.close();
    harness.close();
  });

  it("keeps an active classification alive across locale rerenders and disposes only on unmount", async () => {
    const raster = sourceRaster();
    const classification = deferred<PatternClassification>();
    const harness = createSdkHarness({
      pickedImage: {
        name: "active.png",
        mimeType: "image/png",
        bytes: new Uint8Array([1, 2, 3]).buffer,
        raster,
      },
    });
    const client = await harness.connect();
    const progress = vi.spyOn(client.status, "progress");
    const engine = new FakeEngine({
      classifications: [classification.promise],
    });
    const module = (locale: "zh-CN" | "en-US") => (
      <BeadWorkshopModule
        client={client}
        locale={locale}
        createEngine={() => engine}
        imageCodec={codec}
        autosaveDelayMs={0}
      />
    );
    const view = render(module("zh-CN"));

    fireEvent.click(
      await screen.findByRole("button", {
        name: "选择拼豆图纸",
      }),
    );
    expect(
      await screen.findByText("正在分析图纸类型…"),
    ).toBeInTheDocument();
    view.rerender(module("en-US"));

    expect(engine.dispose).not.toHaveBeenCalled();
    expect(engine.cancel).not.toHaveBeenCalled();
    expect(progress.mock.calls.at(-1)?.[0]).toEqual({
      phase: "classify-pattern",
      completed: 0,
      total: 1,
    });
    await act(async () => {
      classification.resolve(DEFAULT_CLASSIFICATION);
      await classification.promise;
    });
    expect(
      await screen.findByText(
        "Suggested: Hard-edged pixel chart · 94% confidence",
      ),
    ).toBeInTheDocument();

    view.unmount();
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    client.close();
    harness.close();
  });

  it("resumes a valid latest project and renders it before ready", async () => {
    const project = createBeadProject({
      projectId: "restored",
      moduleVersion: "1.0.0",
      now: "2026-07-30T00:00:00.000Z",
      rows: 2,
      columns: 2,
      palette: [[230, 40, 50]],
      cells: [
        { kind: "color", paletteIndex: 0 },
        { kind: "empty" },
        { kind: "empty" },
        { kind: "color", paletteIndex: 0 },
      ],
    });
    const harness = createSdkHarness({
      latestProject: {
        projectId: project.projectId,
        schemaVersion: project.schemaVersion,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        project,
      },
    });
    const client = await harness.connect();
    const engine = new FakeEngine();
    const view = render(
      <BeadWorkshopModule
        client={client}
        locale="zh-CN"
        createEngine={() => engine}
        imageCodec={codec}
        autosaveDelayMs={0}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "编辑豆子" }),
    ).toBeInTheDocument();
    expect(screen.getByText("已恢复本机项目")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "返回校准" }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(harness.methods()).toContain("lifecycle.ready");
    });
    expect(harness.indexOf("lifecycle.ready")).toBeGreaterThan(
      harness.indexOf("project.latest"),
    );

    view.unmount();
    expect(engine.dispose).not.toHaveBeenCalled();
    harness.close();
  });

  it("lets the user reload the print library after a persistent miss", async () => {
    const project = createBeadProject({
      projectId: "library-manual-reload",
      moduleVersion: "1.0.0",
      now: "2026-07-30T00:00:00.000Z",
      rows: 1,
      columns: 1,
      palette: [[230, 40, 50]],
      cells: [{ kind: "color", paletteIndex: 0 }],
    });
    const harness = createSdkHarness({
      latestProject: {
        projectId: project.projectId,
        schemaVersion: project.schemaVersion,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        project,
      },
      colorLibraries: [null, RETRIED_LIBRARY],
    });
    const client = await harness.connect();
    render(
      <BeadWorkshopModule
        client={client}
        locale="zh-CN"
        createEngine={() => new FakeEngine()}
        imageCodec={codec}
        autosaveDelayMs={0}
      />,
    );

    await screen.findByRole("heading", { name: "编辑豆子" });
    switchWorkbenchMode("打印准备");
    await screen.findByText(
      "尚未读取到耗材颜色，仍可使用原图颜色编辑。",
    );
    expect(
      harness.methods().filter(
        (method) => method === "colorLibrary.read",
      ),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "重新读取耗材颜色" }),
    );
    expect(
      await screen.findByText("当前耗材：Aliz RYBW"),
    ).toBeInTheDocument();
    expect(
      harness.methods().filter(
        (method) => method === "colorLibrary.read",
      ),
    ).toHaveLength(2);

    client.close();
    harness.close();
  });

  it("keeps repeated manual reload clicks in one RPC flight", async () => {
    const project = createBeadProject({
      projectId: "library-single-flight",
      moduleVersion: "1.0.0",
      now: "2026-07-30T00:00:00.000Z",
      rows: 1,
      columns: 1,
      palette: [[230, 40, 50]],
      cells: [{ kind: "color", paletteIndex: 0 }],
    });
    const harness = createSdkHarness({
      latestProject: {
        projectId: project.projectId,
        schemaVersion: project.schemaVersion,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        project,
      },
    });
    const client = await harness.connect();
    const manualRead = deferred<WorkshopColorLibrary | null>();
    const read = vi
      .spyOn(client.colorLibrary, "read")
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(() => manualRead.promise);
    render(
      <BeadWorkshopModule
        client={client}
        locale="zh-CN"
        createEngine={() => new FakeEngine()}
        imageCodec={codec}
        autosaveDelayMs={0}
      />,
    );

    await screen.findByRole("heading", { name: "编辑豆子" });
    switchWorkbenchMode("打印准备");
    const reload = await screen.findByRole("button", {
      name: "重新读取耗材颜色",
    });
    await waitFor(() => expect(reload).toBeEnabled());
    fireEvent.click(reload);
    fireEvent.click(reload);
    expect(read).toHaveBeenCalledTimes(2);
    manualRead.resolve(RETRIED_LIBRARY);
    expect(
      await screen.findByText("当前耗材：Aliz RYBW"),
    ).toBeInTheDocument();

    client.close();
    harness.close();
  });

  it.each([false, true])(
    "finishes a pending color-library read with snapshot restore=%s",
    async (restore) => {
      const harness = createSdkHarness();
      const client = await harness.connect();
      const initialRead = deferred<WorkshopColorLibrary | null>();
      vi.spyOn(client.colorLibrary, "read").mockReturnValueOnce(initialRead.promise);
      const view = mountWorkshop(client, new FakeEngine());
      try {
        fireEvent.click(await screen.findByRole("button", { name: "新建空白底板" }));
        await screen.findByRole("heading", { name: "编辑豆子" });
        switchWorkbenchMode("打印准备");
        const reload = screen.getByRole("button", { name: "重新读取耗材颜色" });
        expect(reload).toBeDisabled();
        expect(reload).toHaveAttribute("aria-busy", "true");

        if (restore) {
          const snapshot = await harness.projectRequest("capture");
          const prepared = await harness.projectRequest("prepare", snapshot);
          let finished = false;
          const committed = harness.projectRequest("commit", prepared).then(() => { finished = true; });
          await waitFor(() => expect(finished).toBe(true));
          await committed;
          expect(reload).toBeEnabled();
        }

        await act(async () => { initialRead.resolve(null); });
        await waitFor(() => expect(reload).toBeEnabled());
        expect(reload).not.toHaveAttribute("aria-busy", "true");
      } finally {
        view.unmount();
        client.close();
        harness.close();
      }
    },
  );

  it.each(["resolve", "reject"] as const)(
    "allows a fresh read after snapshot restore while the superseded read later %ss",
    async (outcome) => {
      const harness = createSdkHarness();
      const client = await harness.connect();
      const oldRead = deferred<WorkshopColorLibrary | null>();
      const newRead = deferred<WorkshopColorLibrary | null>();
      const read = vi.spyOn(client.colorLibrary, "read")
        .mockResolvedValueOnce(null)
        .mockReturnValueOnce(oldRead.promise)
        .mockReturnValueOnce(newRead.promise)
        .mockResolvedValueOnce(RETRIED_LIBRARY);
      const view = mountWorkshop(client, new FakeEngine());
      try {
        fireEvent.click(await screen.findByRole("button", { name: "新建空白底板" }));
        await screen.findByRole("heading", { name: "编辑豆子" });
        switchWorkbenchMode("打印准备");
        const snapshot = await harness.projectRequest("capture");
        const reload = screen.getByRole("button", { name: "重新读取耗材颜色" });
        await waitFor(() => expect(reload).toBeEnabled());
        fireEvent.click(reload);
        expect(read).toHaveBeenCalledTimes(2);
        expect(reload).toBeDisabled();

        const prepared = await harness.projectRequest("prepare", snapshot);
        let finished = false;
        const committed = harness.projectRequest("commit", prepared).then(() => { finished = true; });
        await waitFor(() => expect(finished).toBe(true));
        await committed;
        expect(reload).toBeEnabled();
        fireEvent.click(reload);
        expect(read).toHaveBeenCalledTimes(3);
        expect(reload).toHaveAttribute("aria-busy", "true");

        await act(async () => {
          if (outcome === "resolve") oldRead.resolve({ ...RETRIED_LIBRARY, id: "stale", label: "Stale library" });
          else oldRead.reject(new Error("Superseded request failed"));
        });
        expect(screen.getByText("尚未读取到耗材颜色，仍可使用原图颜色编辑。")).toBeInTheDocument();
        expect(screen.queryByText("当前耗材：Stale library")).not.toBeInTheDocument();
        expect(reload).toBeDisabled();
        expect(reload).toHaveAttribute("aria-busy", "true");

        await act(async () => {
          newRead.resolve(null);
        });
        expect(reload).toBeEnabled();
        expect(reload).not.toHaveAttribute("aria-busy", "true");
        fireEvent.click(reload);
        expect(await screen.findByText("当前耗材：Aliz RYBW")).toBeInTheDocument();
        expect(read).toHaveBeenCalledTimes(4);
      } finally {
        view.unmount();
        client.close();
        harness.close();
      }
    },
  );

  it("keeps source colors authoritative while explicitly mapping every library entry", async () => {
    const project = createBeadProject({
      projectId: "print-mapping",
      moduleVersion: "1.0.0",
      now: "2026-07-30T00:00:00.000Z",
      rows: 1,
      columns: 2,
      palette: [
        [250, 20, 30],
        [10, 220, 80],
      ],
      cells: [
        { kind: "color", paletteIndex: 0 },
        { kind: "color", paletteIndex: 1 },
      ],
    });
    const harness = createSdkHarness({
      latestProject: {
        projectId: project.projectId,
        schemaVersion: project.schemaVersion,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        project,
      },
      colorLibrary: {
        id: "material-archive:official",
        label: "官方 PLA",
        sourceKind: "material-archive",
        colors: [
          {
            id: "official-red",
            label: "官方红",
            hex: "#E3212A",
            materialId: "red-material",
          },
          {
            id: "community-red",
            label: "社区红",
            hex: "#E3212A",
            materialId: "community-red-material",
          },
          {
            id: "official-green",
            label: "官方绿",
            hex: "#25A55F",
            materialId: "green-material",
          },
        ],
      },
    });
    const client = await harness.connect();
    render(
      <BeadWorkshopModule
        client={client}
        locale="zh-CN"
        createEngine={() => new FakeEngine()}
        imageCodec={codec}
        autosaveDelayMs={0}
      />,
    );

    await screen.findByRole("heading", { name: "编辑豆子" });
    switchWorkbenchMode("打印准备");
    const printPreview = screen.getByRole("button", {
      name: "耗材颜色",
    });
    expect(printPreview).toBeDisabled();
    expect(
      screen.getByText("当前耗材：官方 PLA"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "匹配耗材颜色" }),
    );
    await waitFor(() => expect(printPreview).toBeEnabled());
    expect(printPreview).toHaveAttribute("aria-pressed", "true");

    const firstColor = screen.getByRole("combobox", {
      name: "图案颜色 1",
    });
    expect(firstColor.querySelectorAll("option")).toHaveLength(3);
    fireEvent.change(firstColor, {
      target: { value: "community-red" },
    });
    await waitFor(() => {
      const saved = harness.savedProjects().at(-1)?.project as
        | BeadProject
        | undefined;
      expect(saved?.printMapping?.entries[0]).toEqual({
        sourcePaletteIndex: 0,
        colorEntryId: "community-red",
      });
    });
    const saved = harness.savedProjects().at(-1)
      ?.project as BeadProject;
    expect(saved.palette).toEqual(project.palette);

    client.close();
    harness.close();
  });

  it("sends native SVG with a PNG fallback and retries only after confirmation", async () => {
    const harness = createSdkHarness({
      pickedImage: {
        name: "pattern.png",
        mimeType: "image/png",
        bytes: new Uint8Array([1, 2, 3]).buffer,
        raster: sourceRaster(),
      },
      handoffStatuses: ["needs-confirmation", "completed"],
    });
    const client = await harness.connect();
    render(
      <BeadWorkshopModule
        client={client}
        locale="zh-CN"
        createEngine={() => new FakeEngine()}
        imageCodec={codec}
        autosaveDelayMs={0}
      />,
    );

    await screen.findByRole("button", { name: "选择拼豆图纸" });
    fireEvent.click(
      screen.getByRole("button", { name: "选择拼豆图纸" }),
    );
    await screen.findByRole("heading", { name: "校准图纸" });
    fireEvent.click(
      screen.getByRole("button", { name: "图中没有空位" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "识别拼豆矩阵" }),
    );
    await screen.findByRole("heading", { name: "编辑豆子" });

    fireEvent.click(
      screen.getByRole("button", { name: "生成打印文件" }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "确认生成打印文件？",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "2 × 2 格 · 5.2 × 5.2 × 2.35 mm · 熨烫 50% · 自然形变 0%",
      ),
    ).toBeInTheDocument();
    expect(harness.payloads("handoff.image")).toHaveLength(0);

    fireEvent.click(
      screen.getByRole("button", { name: "继续生成" }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "替换当前转换内容？",
      }),
    ).toBeInTheDocument();

    const first = harness.payloads("handoff.image")[0] as {
      pixelWidth: number;
      pixelHeight: number;
      recommendedWidthMm: number;
      recommendedHeightMm: number;
      layout: { rows: number; columns: number; pitchMm: number };
      preserveCanvasBounds: boolean;
      svgBytes: ArrayBuffer;
    };
    expect(first).toMatchObject({
      pixelWidth: 64,
      pixelHeight: 64,
      recommendedWidthMm: 5.2,
      recommendedHeightMm: 5.2,
      layout: {
        kind: "square-grid",
        rows: 2,
        columns: 2,
        pitchMm: 2.6,
      },
      preserveCanvasBounds: true,
    });
    expect(
      new TextDecoder().decode(new Uint8Array(first.svgBytes)),
    ).toContain('data-lumina-origin="workshop-handoff"');

    fireEvent.click(
      screen.getByRole("button", { name: "替换并继续" }),
    );
    await waitFor(() => {
      expect(harness.payloads("handoff.image")).toHaveLength(2);
    });
    client.close();
    harness.close();
  });

  it("keeps both handoff dialogs modal and restores the original handoff trigger", async () => {
    const project = projectWithSource();
    const harness = createSdkHarness({
      latestProject: storedProjectRecord(project),
      handoffStatuses: ["needs-confirmation"],
    });
    const client = await harness.connect();
    mountWorkshop(client, new FakeEngine(), imageCodecFor(sourceRaster(30, 20)));

    await screen.findByRole("heading", { name: "编辑豆子" });
    const handoffTrigger = screen.getByRole("button", {
      name: "生成打印文件",
    });
    handoffTrigger.focus();
    expect(handoffTrigger).toHaveFocus();

    fireEvent.click(handoffTrigger);
    const summaryDialog = await screen.findByRole("dialog", {
      name: "确认生成打印文件？",
    });
    await waitFor(() =>
      expect(summaryDialog).toContainElement(document.activeElement as HTMLElement),
    );

    const summaryCancel = screen.getByRole("button", { name: "返回编辑" });
    const summaryConfirm = screen.getByRole("button", {
      name: "继续生成",
    });
    summaryCancel.focus();
    fireEvent.keyDown(summaryCancel, { key: "Tab", shiftKey: true });
    expect(summaryConfirm).toHaveFocus();
    fireEvent.keyDown(summaryConfirm, { key: "Tab" });
    expect(summaryCancel).toHaveFocus();

    fireEvent.keyDown(summaryCancel, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "确认生成打印文件？",
        }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(handoffTrigger).toHaveFocus());

    fireEvent.click(handoffTrigger);
    await screen.findByRole("dialog", {
      name: "确认生成打印文件？",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "继续生成" }),
    );

    const replacementDialog = await screen.findByRole("dialog", {
      name: "替换当前转换内容？",
    });
    await waitFor(() =>
      expect(replacementDialog).toContainElement(
        document.activeElement as HTMLElement,
      ),
    );

    const replacementCancel = screen.getByRole("button", {
      name: "暂不替换",
    });
    const replacementConfirm = screen.getByRole("button", {
      name: "替换并继续",
    });
    replacementCancel.focus();
    fireEvent.keyDown(replacementCancel, { key: "Tab", shiftKey: true });
    expect(replacementConfirm).toHaveFocus();
    fireEvent.keyDown(replacementConfirm, { key: "Tab" });
    expect(replacementCancel).toHaveFocus();

    fireEvent.keyDown(replacementCancel, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "替换当前转换内容？",
        }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(handoffTrigger).toHaveFocus());

    client.close();
    harness.close();
  });

  it("does not rasterize an editor preview that is rendered from native SVG", async () => {
    const project = projectWithSource();
    const engine = new FakeEngine();
    const renderSpy = vi.spyOn(engine, "render");
    const { client, harness } = await startRestoredEditor(project, engine);

    expect(renderSpy).not.toHaveBeenCalled();

    client.close();
    harness.close();
  });
});
