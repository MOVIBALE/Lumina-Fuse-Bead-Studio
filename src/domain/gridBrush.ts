import { AUTO_EXPAND_CANVAS_GROWTH } from "./project";
import { MAX_BEAD_GRID_SIZE } from "./types";

export type BeadBrushSize = 1 | 2 | 3;

const EDGE_MARGIN = 2;
let nextStrokeCounter = 0;

export function createBeadStrokeId(prefix = "s"): string {
  nextStrokeCounter += 1;
  const nonce =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${nextStrokeCounter}-${nonce}`;
}

export function remapCellIndexWithOffsets(
  oldRows: number,
  oldColumns: number,
  newRows: number,
  newColumns: number,
  addTop: number,
  addLeft: number,
  cellIndex: number,
): number | null {
  if (
    !Number.isInteger(cellIndex) ||
    cellIndex < 0 ||
    cellIndex >= oldRows * oldColumns
  ) {
    return null;
  }
  const row = Math.floor(cellIndex / oldColumns) + addTop;
  const col = (cellIndex % oldColumns) + addLeft;
  return row >= 0 && row < newRows && col >= 0 && col < newColumns
    ? row * newColumns + col
    : null;
}

export interface StrokeGridSnapshot {
  id: string;
  rows: number;
  cols: number;
  batch: readonly number[];
}

export function resolveStrokeGridTransition(
  prev: StrokeGridSnapshot,
  next: { projectId: string; rows: number; columns: number },
): "same" | "reset" | readonly [addTop: number, addLeft: number] {
  if (prev.id !== next.projectId) return "reset";
  if (prev.rows === next.rows && prev.cols === next.columns) return "same";
  if (next.rows >= prev.rows && next.columns >= prev.cols) {
    let curRows = prev.rows;
    let curCols = prev.cols;
    let addTop = 0;
    let addLeft = 0;
    const total = prev.rows * prev.cols;
    for (const orig of prev.batch) {
      if (!Number.isInteger(orig) || orig < 0 || orig >= total) continue;
      const r = Math.floor(orig / prev.cols) + addTop;
      const c = (orig % prev.cols) + addLeft;
      let remR = MAX_BEAD_GRID_SIZE - curRows;
      let remC = MAX_BEAD_GRID_SIZE - curCols;
      const top =
        r < EDGE_MARGIN ? Math.min(AUTO_EXPAND_CANVAS_GROWTH, remR) : 0;
      remR -= top;
      const bot =
        curRows - 1 - r < EDGE_MARGIN
          ? Math.min(AUTO_EXPAND_CANVAS_GROWTH, remR)
          : 0;
      const left =
        c < EDGE_MARGIN ? Math.min(AUTO_EXPAND_CANVAS_GROWTH, remC) : 0;
      remC -= left;
      const right =
        curCols - 1 - c < EDGE_MARGIN
          ? Math.min(AUTO_EXPAND_CANVAS_GROWTH, remC)
          : 0;
      addTop += top;
      addLeft += left;
      curRows += top + bot;
      curCols += left + right;
    }
    if (curRows === next.rows && curCols === next.columns) {
      return [addTop, addLeft];
    }
  }
  return "reset";
}

/**
 * Walks an integer Bresenham line from `fromCellIndex` to `toCellIndex`
 * so fast pointer drags never skip intermediate grid cells.
 */
export function interpolateGridCells(
  rows: number,
  columns: number,
  fromCellIndex: number,
  toCellIndex: number,
): number[] {
  const total = rows * columns;
  if (
    rows <= 0 ||
    columns <= 0 ||
    !Number.isInteger(fromCellIndex) ||
    !Number.isInteger(toCellIndex) ||
    toCellIndex < 0 ||
    toCellIndex >= total
  ) {
    return [];
  }
  if (
    fromCellIndex < 0 ||
    fromCellIndex >= total ||
    fromCellIndex === toCellIndex
  ) {
    return [toCellIndex];
  }

  let r0 = Math.floor(fromCellIndex / columns);
  let c0 = fromCellIndex % columns;
  const r1 = Math.floor(toCellIndex / columns);
  const c1 = toCellIndex % columns;

  const dc = Math.abs(c1 - c0);
  const dr = Math.abs(r1 - r0);
  const stepC = c0 < c1 ? 1 : -1;
  const stepR = r0 < r1 ? 1 : -1;
  let error = dc - dr;

  const cells: number[] = [r0 * columns + c0];
  while (c0 !== c1 || r0 !== r1) {
    const doubled = error * 2;
    if (doubled > -dr) {
      error -= dr;
      c0 += stepC;
    }
    if (doubled < dc) {
      error += dc;
      r0 += stepR;
    }
    cells.push(r0 * columns + c0);
  }
  return cells;
}

/**
 * Computes the clamped grid cell indices covered by a square brush centered on
 * `centerCellIndex` (1x1, 2x2 anchored top-left at cursor, or 3x3 centered).
 */
export function expandBrushFootprint(
  rows: number,
  columns: number,
  centerCellIndex: number,
  brushSize: BeadBrushSize,
): number[] {
  const total = rows * columns;
  if (
    rows <= 0 ||
    columns <= 0 ||
    !Number.isInteger(centerCellIndex) ||
    centerCellIndex < 0 ||
    centerCellIndex >= total
  ) {
    return [];
  }
  if (brushSize === 1) {
    return [centerCellIndex];
  }

  const row = Math.floor(centerCellIndex / columns);
  const column = centerCellIndex % columns;
  const minRow = brushSize === 3 ? Math.max(0, row - 1) : row;
  const maxRow = Math.min(rows - 1, row + 1);
  const minCol = brushSize === 3 ? Math.max(0, column - 1) : column;
  const maxCol = Math.min(columns - 1, column + 1);

  const cells: number[] = [];
  for (let r = minRow; r <= maxRow; r += 1) {
    for (let c = minCol; c <= maxCol; c += 1) {
      cells.push(r * columns + c);
    }
  }
  return cells;
}

/**
 * Expands a sequence of stroke-center cells with `brushSize` while preserving
 * visit order and removing duplicates.
 */
export function expandStrokeCells(
  rows: number,
  columns: number,
  centerCells: readonly number[],
  brushSize: BeadBrushSize,
): number[] {
  if (brushSize === 1 && centerCells.length <= 1) {
    return centerCells.length === 1 ? [centerCells[0]!] : [];
  }
  const seen = new Set<number>();
  const result: number[] = [];
  for (const center of centerCells) {
    for (const cell of expandBrushFootprint(rows, columns, center, brushSize)) {
      if (!seen.has(cell)) {
        seen.add(cell);
        result.push(cell);
      }
    }
  }
  return result;
}
