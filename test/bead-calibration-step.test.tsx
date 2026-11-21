import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BeadCalibrationStep,
  type BeadCalibrationDraft,
} from "../src/app/BeadCalibrationStep";
import type {
  PatternClassification,
  Raster,
} from "../src/domain/types";
import { translate } from "../src/i18n/translations";

const t = (key: string) => translate("zh-CN", key);

function raster(width = 40, height = 40): Raster {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}

function initialDraft(
  overrides: Partial<BeadCalibrationDraft> = {},
): BeadCalibrationDraft {
  return {
    inputMode: "hard-pixel",
    rows: 4,
    columns: 4,
    geometry: {
      originX: 0,
      originY: 0,
      cellWidth: 10,
      cellHeight: 10,
    },
    orientation: {
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
    },
    emptySelection: null,
    ...overrides,
  };
}

function Harness({
  draft = initialDraft(),
  onRecognize = vi.fn(),
  onFitSquareGrid = vi.fn(),
  onReturnToEditor,
  busy = false,
  classificationBusy = false,
  classification,
}: {
  draft?: BeadCalibrationDraft;
  onRecognize?: () => void;
  onFitSquareGrid?: () => void;
  onReturnToEditor?: () => void;
  busy?: boolean;
  classificationBusy?: boolean;
  classification?: PatternClassification | null;
}) {
  const [value, setValue] = useState(draft);
  return (
    <BeadCalibrationStep
      source={raster()}
      fileName="pattern.png"
      classification={
        classification === undefined
          ? {
              mode: "hard-pixel",
              confidence: 0.91,
              scores: {
                "numbered-grid": 0.1,
                "hard-pixel": 0.91,
                "ring-preview": 0.2,
              },
            }
          : classification
      }
      draft={value}
      busy={busy}
      classificationBusy={classificationBusy}
      translate={t}
      onChange={setValue}
      onRecognize={onRecognize}
      onOpenCrop={vi.fn()}
      onFitSquareGrid={onFitSquareGrid}
      onReturnToEditor={onReturnToEditor}
      canCrop
    />
  );
}

describe("BeadCalibrationStep", () => {
  beforeEach(() => {
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getContext",
    ).mockReturnValue(null);
  });

  it("requires an explicit empty-cell decision before recognition", () => {
    const onRecognize = vi.fn();
    render(<Harness onRecognize={onRecognize} />);

    const recognize = screen.getByRole("button", {
      name: "提取拼豆图案",
    });
    expect(recognize).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "全图无空格" }),
    );
    expect(recognize).toBeEnabled();
    fireEvent.click(recognize);
    expect(onRecognize).toHaveBeenCalledTimes(1);
  });

  it("blocks recognition until an embedded or multi-pattern image is cropped", () => {
    render(
      <Harness
        draft={initialDraft({ emptySelection: { kind: "none" } })}
        classification={{
          mode: "numbered-grid",
          confidence: 0.94,
          scores: {
            "numbered-grid": 0.94,
            "hard-pixel": 0.15,
            "ring-preview": 0.73,
          },
          requiresCrop: true,
        }}
      />,
    );

    expect(
      screen.getByText(
        "画面里带有截图边框或不止一张图，请先点右上角“裁剪画面”，只框出单张完整图纸。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "裁剪画面" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "提取拼豆图案" }),
    ).toBeDisabled();
  });

  it("maps source-canvas picks to an explicit empty sample only", () => {
    render(<Harness />);
    const canvas = screen.getByRole("img", {
      name: "图纸网格预览",
    });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 400,
      width: 400,
      height: 400,
      toJSON: () => ({}),
    });

    fireEvent.click(
      screen.getByRole("button", { name: "点选空格" }),
    );
    fireEvent.pointerDown(canvas, {
      clientX: 250,
      clientY: 150,
    });
    expect(screen.getByText("已选背景空格")).toBeInTheDocument();
    expect(screen.getByText("第 2 行 · 第 3 列")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "选择透明支撑" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/透明支撑样本/),
    ).not.toBeInTheDocument();
  });

  it("updates orientation and rejects a visibly non-square grid", () => {
    const onFitSquareGrid = vi.fn();
    render(
      <Harness
        onFitSquareGrid={onFitSquareGrid}
        draft={initialDraft({
          geometry: {
            originX: 0,
            originY: 0,
            cellWidth: 10,
            cellHeight: 7,
          },
        })}
      />,
    );

    expect(
      screen.getByText(
        "现在的格子偏扁，拼豆格需要接近正方形。点下方按钮一键对齐，或微调行列数。",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "一键对齐方格",
      }),
    );
    expect(onFitSquareGrid).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "提取拼豆图案" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "旋转 90°" }));
    expect(
      screen.getByRole("button", { name: "旋转 90°" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "左右翻转" }));
    expect(
      screen.getByRole("button", { name: "左右翻转" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("returns to the editor unless calibration is busy", () => {
    const onReturnToEditor = vi.fn();
    const { rerender } = render(
      <Harness onReturnToEditor={onReturnToEditor} />,
    );

    expect(
      screen.getByRole("button", { name: "裁剪画面" }),
    ).toBeInTheDocument();
    const returnButton = screen.getByRole("button", {
      name: "返回摆豆",
    });
    expect(returnButton).toBeEnabled();
    fireEvent.click(returnButton);
    expect(onReturnToEditor).toHaveBeenCalledTimes(1);

    rerender(
      <Harness busy onReturnToEditor={onReturnToEditor} />,
    );
    const busyReturnButton = screen.getByRole("button", {
      name: "返回摆豆",
    });
    expect(busyReturnButton).toBeDisabled();
    fireEvent.click(busyReturnButton);
    expect(onReturnToEditor).toHaveBeenCalledTimes(1);
  });

  it("allows classification cancellation but blocks crop and recognition until it settles", () => {
    const onReturnToEditor = vi.fn();
    render(
      <Harness
        classification={null}
        classificationBusy
        onReturnToEditor={onReturnToEditor}
      />,
    );

    expect(
      screen.getByText("正在看图识别…"),
    ).toBeInTheDocument();
    const returnButton = screen.getByRole("button", {
      name: "返回摆豆",
    });
    expect(returnButton).toBeEnabled();
    fireEvent.click(returnButton);
    expect(onReturnToEditor).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "裁剪画面" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "提取拼豆图案" }),
    ).toBeDisabled();
  });

  it("distinguishes unavailable classification from recognition progress", () => {
    const { rerender } = render(
      <Harness classification={null} />,
    );

    expect(
      screen.getByText(
        "没自动认出是哪种图纸，请在下方手动选一下。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("正在看图识别…"),
    ).not.toBeInTheDocument();

    rerender(<Harness busy classification={null} />);
    expect(
      screen.getByText(
        "没自动认出是哪种图纸，请在下方手动选一下。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("正在看图识别…"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "正在提取图案…",
      }),
    ).toBeDisabled();
  });

  it("rounds floating-point origin noise, shows sample row/column coordinates, and supports changing the pattern", () => {
    const onReselectPattern = vi.fn();
    render(
      <BeadCalibrationStep
        source={raster(1640, 1470)}
        fileName="B0F80921A1F22C05A6A3D2F2E.png"
        classification={{
          mode: "numbered-grid",
          confidence: 0.95,
          scores: {
            "numbered-grid": 0.95,
            "hard-pixel": 0.12,
            "ring-preview": 0.1,
          },
        }}
        draft={initialDraft({
          inputMode: "numbered-grid",
          rows: 63,
          columns: 72,
          geometry: {
            originX: 17.250000000004,
            originY: 25.719999999998,
            cellWidth: 22.2,
            cellHeight: 22.2,
          },
          emptySelection: { kind: "sample", cellIndex: 1083 },
        })}
        busy={false}
        translate={t}
        onChange={vi.fn()}
        onRecognize={vi.fn()}
        onOpenCrop={vi.fn()}
        onReselectPattern={onReselectPattern}
        canCrop
      />,
    );

    expect(
      screen.getByRole("spinbutton", { name: "左上起点 X" }),
    ).toHaveValue(17.25);
    expect(
      screen.getByRole("spinbutton", { name: "左上起点 Y" }),
    ).toHaveValue(25.72);
    expect(screen.getByText("已选背景空格")).toBeInTheDocument();
    expect(screen.getByText("第 16 行 · 第 4 列")).toBeInTheDocument();
    expect(
      screen.getByRole("toolbar", { name: "画布缩放" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "换一张图" }));
    expect(onReselectPattern).toHaveBeenCalledTimes(1);
  });
});
