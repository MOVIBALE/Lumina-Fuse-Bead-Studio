import {
  memo,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent,
  type PointerEvent,
} from "react";

import {
  createBeadStrokeId,
  expandBrushFootprint,
  expandStrokeCells,
  interpolateGridCells,
  remapCellIndexWithOffsets,
  resolveStrokeGridTransition,
  type BeadBrushSize,
  type StrokeGridSnapshot,
} from "../domain/gridBrush";
import type { BeadRenderResult } from "../domain/renderer";
import type { BeadProject } from "../domain/types";
import { cx } from "../ui/panelPrimitives";

interface BeadMatrixViewport {
  centerCellIndex: number;
  radius: number;
}

interface BeadMatrixCanvasProps {
  project: BeadProject;
  ariaLabel: string;
  renderResult?: BeadRenderResult | null;
  showGrid?: boolean;
  selectedCellIndex?: number | null;
  onPickCell?(cellIndex: number): void;
  onPickCells?(cellIndices: readonly number[], strokeId?: string): void;
  brushSize?: BeadBrushSize;
  allowDrag?: boolean;
  viewport?: BeadMatrixViewport;
  className?: string;
}

interface MatrixBounds {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

function resolveBounds(
  project: BeadProject,
  viewport: BeadMatrixViewport | undefined,
): MatrixBounds {
  if (!viewport) {
    return {
      startRow: 0,
      endRow: project.rows,
      startColumn: 0,
      endColumn: project.columns,
    };
  }
  const row = Math.floor(viewport.centerCellIndex / project.columns);
  const column = viewport.centerCellIndex % project.columns;
  const visibleRowCount = Math.min(
    project.rows,
    viewport.radius * 2 + 1,
  );
  const visibleColumnCount = Math.min(
    project.columns,
    viewport.radius * 2 + 1,
  );
  const startRow = Math.min(
    Math.max(0, row - viewport.radius),
    project.rows - visibleRowCount,
  );
  const startColumn = Math.min(
    Math.max(0, column - viewport.radius),
    project.columns - visibleColumnCount,
  );
  return {
    startRow,
    endRow: startRow + visibleRowCount,
    startColumn,
    endColumn: startColumn + visibleColumnCount,
  };
}

function drawMatrix(
  context: CanvasRenderingContext2D,
  project: BeadProject,
  bounds: MatrixBounds,
  scale: number,
  showGrid: boolean,
  selectedCellIndex: number | null,
): void {
  const paletteCss = project.palette.map(
    (color) => `rgb(${color[0]} ${color[1]} ${color[2]})`,
  );
  const emptyCrossCoords: number[] = [];
  let selectedX = -1;
  let selectedY = -1;

  for (let row = bounds.startRow; row < bounds.endRow; row += 1) {
    const y = (row - bounds.startRow) * scale;
    const rowOffset = row * project.columns;
    for (
      let column = bounds.startColumn;
      column < bounds.endColumn;
      column += 1
    ) {
      const cellIndex = rowOffset + column;
      const cell = project.cells[cellIndex];
      const x = (column - bounds.startColumn) * scale;
      if (cell.kind === "color") {
        context.fillStyle = paletteCss[cell.paletteIndex] ?? "rgb(0 0 0)";
        context.fillRect(x, y, scale, scale);
      } else {
        context.fillStyle = "rgba(148, 163, 184, 0.14)";
        context.fillRect(x, y, scale, scale);
        emptyCrossCoords.push(x, y);
      }
      if (cellIndex === selectedCellIndex) {
        selectedX = x;
        selectedY = y;
      }
    }
  }

  if (emptyCrossCoords.length > 0) {
    context.strokeStyle = "rgba(100, 116, 139, 0.45)";
    context.lineWidth = Math.max(1, scale / 14);
    context.beginPath();
    const minOff = scale * 0.38;
    const maxOff = scale * 0.62;
    const midOff = scale * 0.5;
    for (let i = 0; i < emptyCrossCoords.length; i += 2) {
      const x = emptyCrossCoords[i]!;
      const y = emptyCrossCoords[i + 1]!;
      context.moveTo(x + minOff, y + midOff);
      context.lineTo(x + maxOff, y + midOff);
      context.moveTo(x + midOff, y + minOff);
      context.lineTo(x + midOff, y + maxOff);
    }
    context.stroke();
  }

  if (showGrid) {
    const totalWidth = (bounds.endColumn - bounds.startColumn) * scale;
    const totalHeight = (bounds.endRow - bounds.startRow) * scale;
    context.strokeStyle = "rgba(100, 116, 139, 0.42)";
    context.lineWidth = 1;
    context.beginPath();
    for (let c = 0; c <= bounds.endColumn - bounds.startColumn; c += 1) {
      const gx = c * scale === totalWidth ? totalWidth - 0.5 : c * scale + 0.5;
      context.moveTo(gx, 0);
      context.lineTo(gx, totalHeight);
    }
    for (let r = 0; r <= bounds.endRow - bounds.startRow; r += 1) {
      const gy = r * scale === totalHeight ? totalHeight - 0.5 : r * scale + 0.5;
      context.moveTo(0, gy);
      context.lineTo(totalWidth, gy);
    }
    context.stroke();
  }

  if (selectedX >= 0 && selectedY >= 0) {
    context.strokeStyle = "rgb(37 99 235)";
    context.lineWidth = Math.max(2, scale / 8);
    context.strokeRect(
      selectedX + context.lineWidth / 2,
      selectedY + context.lineWidth / 2,
      scale - context.lineWidth,
      scale - context.lineWidth,
    );
  }
}

function drawPressure(
  context: CanvasRenderingContext2D,
  result: BeadRenderResult,
  bounds: MatrixBounds,
): void {
  const imageData = context.createImageData(result.width, result.height);
  imageData.data.set(result.data);
  context.putImageData(
    imageData,
    -bounds.startColumn * result.pixelsPerCell,
    -bounds.startRow * result.pixelsPerCell,
  );
}

export const BeadMatrixCanvas = memo(function BeadMatrixCanvas({
  project,
  ariaLabel,
  renderResult = null,
  showGrid = true,
  selectedCellIndex = null,
  onPickCell,
  onPickCells,
  brushSize = 1,
  allowDrag = true,
  viewport,
  className,
}: BeadMatrixCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);
  const activeStrokeIdRef = useRef<string | undefined>(undefined);
  const strokeStateRef = useRef<
    (StrokeGridSnapshot & { last: number }) | null
  >(null);
  const bounds = useMemo(
    () => resolveBounds(project, viewport),
    [project, viewport],
  );
  const matrixScale = viewport ? 32 : 12;
  const scale = renderResult?.pixelsPerCell ?? matrixScale;
  const visibleRows = bounds.endRow - bounds.startRow;
  const visibleColumns = bounds.endColumn - bounds.startColumn;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const nextWidth = visibleColumns * scale;
    const nextHeight = visibleRows * scale;
    if (canvas.width !== nextWidth) canvas.width = nextWidth;
    if (canvas.height !== nextHeight) canvas.height = nextHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (renderResult) {
      drawPressure(context, renderResult, bounds);
    } else {
      drawMatrix(
        context,
        project,
        bounds,
        matrixScale,
        showGrid,
        selectedCellIndex,
      );
    }
  }, [
    bounds,
    matrixScale,
    project,
    renderResult,
    scale,
    selectedCellIndex,
    showGrid,
    visibleColumns,
    visibleRows,
  ]);

  const isInteractive = Boolean(onPickCell || onPickCells);

  const cellIndexAtPointer = (
    event:
      | PointerEvent<HTMLCanvasElement>
      | MouseEvent<HTMLCanvasElement>,
  ): number | null => {
    if (!isInteractive) return null;
    const rectangle = event.currentTarget.getBoundingClientRect();
    if (
      rectangle.width <= 0 ||
      rectangle.height <= 0 ||
      event.clientX < rectangle.left ||
      event.clientY < rectangle.top ||
      event.clientX >= rectangle.right ||
      event.clientY >= rectangle.bottom
    ) {
      return null;
    }
    const localColumn = Math.floor(
      ((event.clientX - rectangle.left) / rectangle.width) *
        visibleColumns,
    );
    const localRow = Math.floor(
      ((event.clientY - rectangle.top) / rectangle.height) *
        visibleRows,
    );
    const row = bounds.startRow + localRow;
    const column = bounds.startColumn + localColumn;
    if (
      row < 0 ||
      column < 0 ||
      row >= project.rows ||
      column >= project.columns
    ) {
      return null;
    }
    return row * project.columns + column;
  };

  const pickAtPointer = (
    event:
      | PointerEvent<HTMLCanvasElement>
      | MouseEvent<HTMLCanvasElement>,
  ) => {
    const cellIndex = cellIndexAtPointer(event);
    if (cellIndex === null) return;

    let previous: number | null = null;
    const prevStroke = strokeStateRef.current;
    if (prevStroke !== null) {
      const transition = resolveStrokeGridTransition(prevStroke, project);
      if (transition === "same") {
        previous = prevStroke.last;
      } else if (transition !== "reset") {
        previous = remapCellIndexWithOffsets(
          prevStroke.rows,
          prevStroke.cols,
          project.rows,
          project.columns,
          transition[0],
          transition[1],
          prevStroke.last,
        );
        strokeStateRef.current =
          previous !== null
            ? {
                id: project.projectId,
                rows: project.rows,
                cols: project.columns,
                last: previous,
                batch: [],
              }
            : null;
      } else {
        strokeStateRef.current = null;
      }
    }
    if (cellIndex === previous) {
      return;
    }

    const segment =
      previous !== null && allowDrag
        ? interpolateGridCells(
            project.rows,
            project.columns,
            previous,
            cellIndex,
          ).slice(1)
        : [cellIndex];
    if (segment.length === 0) return;

    const cells = onPickCells
      ? allowDrag
        ? expandStrokeCells(project.rows, project.columns, segment, brushSize)
        : expandBrushFootprint(
            project.rows,
            project.columns,
            cellIndex,
            brushSize,
          )
      : segment;
    strokeStateRef.current = {
      id: project.projectId,
      rows: project.rows,
      cols: project.columns,
      last: cellIndex,
      batch: cells,
    };

    if (onPickCells) {
      onPickCells(cells, activeStrokeIdRef.current);
      return;
    }
    for (const crossed of segment) {
      onPickCell?.(crossed);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={ariaLabel}
      onPointerDown={(event) => {
        if (!isInteractive) return;
        draggingRef.current = false;
        strokeStateRef.current = null;
        activeStrokeIdRef.current = undefined;
        if (!allowDrag) return;
        activeStrokeIdRef.current = createBeadStrokeId("matrix");
        draggingRef.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        pickAtPointer(event);
      }}
      onPointerMove={(event) => {
        if (draggingRef.current) pickAtPointer(event);
      }}
      onPointerUp={(event) => {
        draggingRef.current = false;
        strokeStateRef.current = null;
        activeStrokeIdRef.current = undefined;
        if (allowDrag) {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
        strokeStateRef.current = null;
        activeStrokeIdRef.current = undefined;
      }}
      onClick={(event) => {
        if (!isInteractive || allowDrag) return;
        strokeStateRef.current = null;
        activeStrokeIdRef.current = undefined;
        pickAtPointer(event);
        strokeStateRef.current = null;
      }}
      className={cx(
        "bead-canvas",
        "bead-canvas--matrix",
        isInteractive && "bead-canvas--interactive",
        className,
      )}
    />
  );
});
