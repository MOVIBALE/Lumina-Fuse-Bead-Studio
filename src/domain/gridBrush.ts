export type BeadBrushSize = 1 | 2 | 3;

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
