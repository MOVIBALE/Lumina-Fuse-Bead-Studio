import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BeadMatrixCanvas } from "../src/app/BeadMatrixCanvas";
import { createBeadProject } from "../src/domain/project";

describe("BeadMatrixCanvas", () => {
  it("marks empty cells with a calm pegboard cross while white beads stay solid", () => {
    const fills: Array<{ style: string; args: number[] }> = [];
    const strokes: Array<{
      style: string;
      path: Array<[number, number]>;
    }> = [];
    let currentPath: Array<[number, number]> = [];
    const context = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      imageSmoothingEnabled: true,
      clearRect: vi.fn(),
      fillRect: vi.fn((...args: number[]) => {
        fills.push({ style: context.fillStyle, args });
      }),
      strokeRect: vi.fn(),
      beginPath: vi.fn(() => {
        currentPath = [];
      }),
      moveTo: vi.fn((x: number, y: number) => {
        currentPath.push([x, y]);
      }),
      lineTo: vi.fn((x: number, y: number) => {
        currentPath.push([x, y]);
      }),
      stroke: vi.fn(() => {
        strokes.push({
          style: context.strokeStyle,
          path: [...currentPath],
        });
      }),
    };
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getContext",
    ).mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    const project = createBeadProject({
      projectId: "empty-visual-marker",
      moduleVersion: "1.0.0",
      now: "2026-08-02T00:00:00.000Z",
      rows: 1,
      columns: 2,
      palette: [[255, 255, 255]],
      cells: [
        { kind: "empty" },
        { kind: "color", paletteIndex: 0 },
      ],
    });

    render(
      <BeadMatrixCanvas
        project={project}
        ariaLabel="matrix"
        showGrid={false}
      />,
    );

    expect(fills).toEqual([
      {
        style: "rgba(148, 163, 184, 0.14)",
        args: [0, 0, 12, 12],
      },
      {
        style: "rgb(255 255 255)",
        args: [12, 0, 12, 12],
      },
    ]);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]?.style).toBe("rgba(100, 116, 139, 0.45)");
    const expectedPath = [
      [4.56, 6],
      [7.44, 6],
      [6, 4.56],
      [6, 7.44],
    ];
    for (const [index, point] of expectedPath.entries()) {
      expect(strokes[0]?.path[index]?.[0]).toBeCloseTo(point[0]);
      expect(strokes[0]?.path[index]?.[1]).toBeCloseTo(point[1]);
    }
  });

  it("keeps a full square inspection window when the selected cell is on an edge", () => {
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getContext",
    ).mockReturnValue(null);
    const project = createBeadProject({
      projectId: "edge-inspection-window",
      moduleVersion: "1.0.0",
      now: "2026-08-12T00:00:00.000Z",
      rows: 10,
      columns: 10,
      palette: [[255, 255, 255]],
      cells: Array.from({ length: 100 }, () => ({ kind: "empty" as const })),
    });

    const { getByRole, rerender } = render(
      <BeadMatrixCanvas
        project={project}
        ariaLabel="inspection"
        selectedCellIndex={0}
        viewport={{ centerCellIndex: 0, radius: 2 }}
      />,
    );

    expect(getByRole("img", { name: "inspection" })).toHaveAttribute(
      "width",
      "160",
    );
    expect(getByRole("img", { name: "inspection" })).toHaveAttribute(
      "height",
      "160",
    );

    rerender(
      <BeadMatrixCanvas
        project={project}
        ariaLabel="inspection"
        selectedCellIndex={99}
        viewport={{ centerCellIndex: 99, radius: 2 }}
      />,
    );
    expect(getByRole("img", { name: "inspection" })).toHaveAttribute(
      "width",
      "160",
    );
    expect(getByRole("img", { name: "inspection" })).toHaveAttribute(
      "height",
      "160",
    );
  });
});
