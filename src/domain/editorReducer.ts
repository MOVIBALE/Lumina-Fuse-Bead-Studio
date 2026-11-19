import {
  expandAutoCanvasAroundCell,
  validateBeadProject,
} from "./project";
import type {
  BeadCell,
  BeadPrintMapping,
  BeadProject,
  RgbColor,
} from "./types";

export type BeadEditorTool =
  | "paint"
  | "erase"
  | "eraseFill"
  | "eyedropper"
  | "fill";

export interface BeadCellPatch {
  index: number;
  before: BeadCell;
  after: BeadCell;
}

interface BeadIssuePatch {
  index: number;
  before: boolean;
  after: boolean;
}

export interface BeadPatchHistoryEntry {
  kind: "patch";
  cellPatches: BeadCellPatch[];
  issuePatches: BeadIssuePatch[];
  beforeUpdatedAt: string;
  afterUpdatedAt: string;
  strokeId?: string;
}

export interface BeadProjectHistoryEntry {
  kind: "project";
  beforeProject: BeadProject;
  afterProject: BeadProject;
  /** Keeps the chosen paint color across structural canvas undo/redo. / 结构画布撤销重做时保留当前画笔颜色。 */
  preserveActivePalette?: boolean;
  strokeId?: string;
}

export type BeadEditHistoryEntry =
  | BeadPatchHistoryEntry
  | BeadProjectHistoryEntry;

export interface BeadEditorState {
  present: BeadProject;
  past: BeadEditHistoryEntry[];
  future: BeadEditHistoryEntry[];
  activeTool: BeadEditorTool;
  activePaletteIndex: number;
  selectedCellIndex: number | null;
  selectedIssueIndex: number | null;
}

export type BeadEditorAction =
  | {
      type: "apply-tool";
      tool?: BeadEditorTool;
      cellIndex: number;
      cellIndices?: readonly number[];
      paletteIndex?: number;
      strokeId?: string;
      updatedAt?: string;
    }
  | { type: "set-tool"; tool: BeadEditorTool }
  | { type: "set-palette"; paletteIndex: number }
  | { type: "select-cell"; cellIndex: number | null }
  | { type: "select-issue"; issueIndex: number | null }
  | {
      type: "set-issue-resolved";
      issueIndex: number;
      resolved: boolean;
      updatedAt?: string;
    }
  | {
      type: "set-compression";
      compression: number;
      updatedAt?: string;
    }
  | {
      type: "set-irregularity";
      irregularity: number;
      updatedAt?: string;
    }
  | {
      type: "set-bead-pitch";
      beadPitchMm: number;
      updatedAt?: string;
    }
  | {
      type: "add-palette-color";
      color: RgbColor;
      updatedAt?: string;
    }
  | {
      type: "set-print-mapping";
      printMapping: BeadPrintMapping | null;
      updatedAt?: string;
    }
  | { type: "replace-project"; project: BeadProject }
  | { type: "undo" }
  | { type: "redo" };

function cellsEqual(left: BeadCell, right: BeadCell): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  return (
    left.kind !== "color" ||
    (right.kind === "color" &&
      left.paletteIndex === right.paletteIndex)
  );
}

function isValidCellIndex(
  project: BeadProject,
  cellIndex: number,
): boolean {
  return (
    Number.isInteger(cellIndex) &&
    cellIndex >= 0 &&
    cellIndex < project.cells.length
  );
}

function isValidPaletteIndex(
  project: BeadProject,
  paletteIndex: number,
): boolean {
  return (
    Number.isInteger(paletteIndex) &&
    paletteIndex >= 0 &&
    paletteIndex < project.palette.length
  );
}

function cellForTool(
  project: BeadProject,
  tool: Exclude<BeadEditorTool, "eyedropper" | "fill">,
  paletteIndex: number,
): BeadCell | null {
  if (tool === "erase") {
    return { kind: "empty" };
  }
  return isValidPaletteIndex(project, paletteIndex)
    ? { kind: "color", paletteIndex }
    : null;
}

export function connectedRegion(
  project: BeadProject,
  startIndex: number,
): number[] {
  const target = project.cells[startIndex];
  const visited = new Uint8Array(project.cells.length);
  const queue = [startIndex];
  const region: number[] = [];
  visited[startIndex] = 1;

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    region.push(index);
    const row = Math.floor(index / project.columns);
    const column = index % project.columns;
    const neighbours = [
      row > 0 ? index - project.columns : -1,
      row + 1 < project.rows ? index + project.columns : -1,
      column > 0 ? index - 1 : -1,
      column + 1 < project.columns ? index + 1 : -1,
    ];
    for (const neighbour of neighbours) {
      if (
        neighbour >= 0 &&
        !visited[neighbour] &&
        cellsEqual(project.cells[neighbour], target)
      ) {
        visited[neighbour] = 1;
        queue.push(neighbour);
      }
    }
  }

  return region;
}

function patchesForTool(
  project: BeadProject,
  tool: Exclude<BeadEditorTool, "eyedropper">,
  cellIndices: readonly number[],
  paletteIndex: number,
): BeadCellPatch[] {
  const replacement = cellForTool(
    project,
    tool === "fill"
      ? "paint"
      : tool === "eraseFill"
        ? "erase"
        : tool,
    paletteIndex,
  );
  if (!replacement || cellIndices.length === 0) {
    return [];
  }
  const indices =
    tool === "fill" || tool === "eraseFill"
      ? connectedRegion(project, cellIndices[0]!)
      : cellIndices;
  const seen = new Set<number>();
  const patches: BeadCellPatch[] = [];
  for (const index of indices) {
    if (seen.has(index)) continue;
    seen.add(index);
    const before = project.cells[index];
    if (before && !cellsEqual(before, replacement)) {
      patches.push({ index, before, after: replacement });
    }
  }
  return patches;
}

function issuePatchesForCells(
  project: BeadProject,
  changedCellIndices: ReadonlySet<number>,
): BeadIssuePatch[] {
  return project.confidenceIssues.flatMap((issue, index) =>
    changedCellIndices.has(issue.cellIndex) && !issue.resolved
      ? [{ index, before: false, after: true }]
      : [],
  );
}

function cloneBeadProject(project: BeadProject): BeadProject {
  return validateBeadProject({
    ...project,
    source: project.source
      ? {
          ...project.source,
          blob: project.source.blob,
        }
      : null,
    calibration: {
      ...project.calibration,
      crop: project.calibration.crop
        ? { ...project.calibration.crop }
        : null,
      origin: { ...project.calibration.origin },
      orientation: { ...project.calibration.orientation },
      emptySelection: {
        ...project.calibration.emptySelection,
      },
    },
    palette: project.palette.map(
      (color) => [...color] as RgbColor,
    ),
    cells: project.cells.map((cell) => ({ ...cell })),
    confidenceIssues: project.confidenceIssues.map((issue) => ({
      ...issue,
      reasons: [...issue.reasons],
    })),
    ...(project.printMapping
      ? {
          printMapping: {
            ...project.printMapping,
            entries: project.printMapping.entries.map((entry) => ({
              ...entry,
            })),
          },
        }
      : {}),
  });
}

function latestProjectUpdatedAt(
  currentUpdatedAt: string,
  targetUpdatedAt: string,
): string {
  const currentTime = Date.parse(currentUpdatedAt);
  const targetTime = Date.parse(targetUpdatedAt);
  if (!Number.isFinite(currentTime)) {
    return targetUpdatedAt;
  }
  if (!Number.isFinite(targetTime)) {
    return currentUpdatedAt;
  }
  return targetTime > currentTime
    ? targetUpdatedAt
    : currentUpdatedAt;
}

function applyProjectSnapshot(
  current: BeadProject,
  target: BeadProject,
): BeadProject {
  return validateBeadProject({
    ...cloneBeadProject(target),
    updatedAt: latestProjectUpdatedAt(
      current.updatedAt,
      target.updatedAt,
    ),
  });
}

function applyHistoryEntry(
  project: BeadProject,
  entry: BeadEditHistoryEntry,
  direction: "forward" | "backward",
): BeadProject {
  if (entry.kind === "project") {
    const target =
      direction === "forward"
        ? entry.afterProject
        : entry.beforeProject;
    return applyProjectSnapshot(project, target);
  }

  const cells = project.cells.slice();
  for (const patch of entry.cellPatches) {
    cells[patch.index] =
      direction === "forward" ? patch.after : patch.before;
  }
  const confidenceIssues = project.confidenceIssues.map((issue) => ({
    ...issue,
  }));
  for (const patch of entry.issuePatches) {
    const issue = confidenceIssues[patch.index];
    if (issue) {
      issue.resolved =
        direction === "forward" ? patch.after : patch.before;
    }
  }
  const targetUpdatedAt =
    direction === "forward"
      ? entry.afterUpdatedAt
      : entry.beforeUpdatedAt;
  return validateBeadProject({
    ...project,
    cells,
    confidenceIssues,
    updatedAt: latestProjectUpdatedAt(
      project.updatedAt,
      targetUpdatedAt,
    ),
  });
}

function projectSelection(
  project: BeadProject,
): Pick<
  BeadEditorState,
  | "activePaletteIndex"
  | "selectedCellIndex"
  | "selectedIssueIndex"
> {
  const selectedIssueIndex = project.confidenceIssues.findIndex(
    (issue) => !issue.resolved,
  );
  return {
    activePaletteIndex: 0,
    selectedCellIndex:
      selectedIssueIndex >= 0
        ? project.confidenceIssues[selectedIssueIndex].cellIndex
        : null,
    selectedIssueIndex:
      selectedIssueIndex >= 0 ? selectedIssueIndex : null,
  };
}

function normalizeProjectState(
  state: BeadEditorState,
  present: BeadProject,
): BeadEditorState {
  return {
    ...state,
    present,
    ...projectSelection(present),
  };
}

function normalizeProjectHistoryState(
  state: BeadEditorState,
  present: BeadProject,
  entry: BeadProjectHistoryEntry,
): BeadEditorState {
  const normalized = normalizeProjectState(state, present);
  if (!entry.preserveActivePalette) return normalized;
  return {
    ...normalized,
    activePaletteIndex: Math.max(
      0,
      Math.min(state.activePaletteIndex, present.palette.length - 1),
    ),
  };
}

function mergePatchHistoryEntries(
  previous: BeadPatchHistoryEntry,
  incoming: BeadPatchHistoryEntry,
): BeadPatchHistoryEntry {
  const cellMap = new Map<number, BeadCellPatch>();
  for (const patch of previous.cellPatches) {
    cellMap.set(patch.index, patch);
  }
  for (const patch of incoming.cellPatches) {
    const existing = cellMap.get(patch.index);
    if (existing) {
      if (cellsEqual(existing.before, patch.after)) {
        cellMap.delete(patch.index);
      } else {
        cellMap.set(patch.index, {
          index: patch.index,
          before: existing.before,
          after: patch.after,
        });
      }
    } else {
      cellMap.set(patch.index, patch);
    }
  }

  const issueMap = new Map<number, BeadIssuePatch>();
  for (const patch of previous.issuePatches) {
    issueMap.set(patch.index, patch);
  }
  for (const patch of incoming.issuePatches) {
    const existing = issueMap.get(patch.index);
    if (existing) {
      if (existing.before === patch.after) {
        issueMap.delete(patch.index);
      } else {
        issueMap.set(patch.index, {
          index: patch.index,
          before: existing.before,
          after: patch.after,
        });
      }
    } else {
      issueMap.set(patch.index, patch);
    }
  }

  return {
    kind: "patch",
    cellPatches: [...cellMap.values()],
    issuePatches: [...issueMap.values()],
    beforeUpdatedAt: previous.beforeUpdatedAt,
    afterUpdatedAt: latestProjectUpdatedAt(
      previous.afterUpdatedAt,
      incoming.afterUpdatedAt,
    ),
    ...(previous.strokeId ? { strokeId: previous.strokeId } : {}),
  };
}

function commitHistoryEntry(
  state: BeadEditorState,
  entry: BeadEditHistoryEntry,
): BeadEditorState {
  const present = applyHistoryEntry(
    state.present,
    entry,
    "forward",
  );
  const previousEntry = state.past[state.past.length - 1];
  if (
    entry.strokeId !== undefined &&
    previousEntry?.strokeId === entry.strokeId
  ) {
    if (entry.kind === "patch" && previousEntry.kind === "patch") {
      const merged = mergePatchHistoryEntries(previousEntry, entry);
      return {
        ...state,
        present,
        past: [...state.past.slice(0, -1), merged],
        future: [],
      };
    }
    const beforeProject =
      previousEntry.kind === "project"
        ? previousEntry.beforeProject
        : cloneBeadProject(
            applyHistoryEntry(state.present, previousEntry, "backward"),
          );
    const mergedProjectEntry: BeadProjectHistoryEntry = {
      kind: "project",
      beforeProject,
      afterProject: cloneBeadProject(present),
      ...((previousEntry.kind === "project" &&
        previousEntry.preserveActivePalette) ||
      (entry.kind === "project" && entry.preserveActivePalette)
        ? { preserveActivePalette: true }
        : {}),
      strokeId: entry.strokeId,
    };
    const mergedState = {
      ...state,
      present,
      past: [...state.past.slice(0, -1), mergedProjectEntry],
      future: [],
    };
    return entry.kind === "project"
      ? normalizeProjectHistoryState(mergedState, present, mergedProjectEntry)
      : mergedState;
  }
  const nextState = {
    ...state,
    present,
    past: [...state.past, entry],
    future: [],
  };
  return entry.kind === "project"
    ? normalizeProjectHistoryState(nextState, present, entry)
    : nextState;
}

function applyEyedropper(
  state: BeadEditorState,
  cellIndex: number,
): BeadEditorState {
  const cell = state.present.cells[cellIndex];
  if (cell.kind === "color") {
    return {
      ...state,
      activeTool: "paint",
      activePaletteIndex: cell.paletteIndex,
      selectedCellIndex: cellIndex,
    };
  }
  return {
    ...state,
    activeTool: "erase",
    selectedCellIndex: cellIndex,
  };
}

export function createBeadEditorState(
  project: BeadProject,
): BeadEditorState {
  const present = validateBeadProject(project);
  return {
    present,
    past: [],
    future: [],
    activeTool: "paint",
    ...projectSelection(present),
  };
}

export function beadEditorReducer(
  state: BeadEditorState,
  action: BeadEditorAction,
): BeadEditorState {
  if (action.type === "set-tool") {
    return action.tool === state.activeTool
      ? state
      : { ...state, activeTool: action.tool };
  }
  if (action.type === "set-palette") {
    return isValidPaletteIndex(state.present, action.paletteIndex) &&
      action.paletteIndex !== state.activePaletteIndex
      ? {
          ...state,
          activePaletteIndex: action.paletteIndex,
          activeTool: "paint",
        }
      : state;
  }
  if (action.type === "set-compression") {
    if (
      !Number.isInteger(action.compression) ||
      action.compression < 0 ||
      action.compression > 100 ||
      action.compression === state.present.compression
    ) {
      return state;
    }
    return {
      ...state,
      present: validateBeadProject({
        ...state.present,
        compression: action.compression,
        updatedAt: action.updatedAt ?? state.present.updatedAt,
      }),
    };
  }
  if (action.type === "set-irregularity") {
    if (
      !Number.isInteger(action.irregularity) ||
      action.irregularity < 0 ||
      action.irregularity > 100 ||
      action.irregularity === (state.present.irregularity ?? 0)
    ) {
      return state;
    }
    return {
      ...state,
      present: validateBeadProject({
        ...state.present,
        irregularity: action.irregularity,
        updatedAt: action.updatedAt ?? state.present.updatedAt,
      }),
    };
  }
  if (action.type === "set-bead-pitch") {
    if (
      !Number.isFinite(action.beadPitchMm) ||
      action.beadPitchMm < 0.5 ||
      action.beadPitchMm > 10 ||
      action.beadPitchMm === state.present.beadPitchMm
    ) {
      return state;
    }
    return {
      ...state,
      present: validateBeadProject({
        ...state.present,
        beadPitchMm: action.beadPitchMm,
        updatedAt: action.updatedAt ?? state.present.updatedAt,
      }),
    };
  }
  if (action.type === "add-palette-color") {
    if (
      action.color.length !== 3 ||
      action.color.some(
        (channel) =>
          !Number.isInteger(channel) ||
          channel < 0 ||
          channel > 255,
      )
    ) {
      return state;
    }
    const existingIndex = state.present.palette.findIndex(
      (color) =>
        color[0] === action.color[0] &&
        color[1] === action.color[1] &&
        color[2] === action.color[2],
    );
    if (existingIndex >= 0) {
      return {
        ...state,
        activeTool: "paint",
        activePaletteIndex: existingIndex,
      };
    }
    if (state.present.palette.length >= 256) {
      return state;
    }
    const activePaletteIndex = state.present.palette.length;
    return {
      ...state,
      activeTool: "paint",
      activePaletteIndex,
      present: validateBeadProject({
        ...state.present,
        palette: [
          ...state.present.palette,
          [...action.color] as RgbColor,
        ],
        updatedAt: action.updatedAt ?? state.present.updatedAt,
      }),
    };
  }
  if (action.type === "set-print-mapping") {
    return {
      ...state,
      present: validateBeadProject({
        ...state.present,
        printMapping: action.printMapping
          ? {
              ...action.printMapping,
              entries: action.printMapping.entries.map((entry) => ({
                ...entry,
              })),
            }
          : null,
        updatedAt: action.updatedAt ?? state.present.updatedAt,
      }),
    };
  }
  if (action.type === "replace-project") {
    const replacement = validateBeadProject(action.project);
    return commitHistoryEntry(state, {
      kind: "project",
      beforeProject: cloneBeadProject(state.present),
      afterProject: cloneBeadProject(replacement),
    });
  }
  if (action.type === "select-cell") {
    if (
      action.cellIndex !== null &&
      !isValidCellIndex(state.present, action.cellIndex)
    ) {
      return state;
    }
    return action.cellIndex === state.selectedCellIndex
      ? state
      : { ...state, selectedCellIndex: action.cellIndex };
  }
  if (action.type === "select-issue") {
    if (action.issueIndex === null) {
      return state.selectedIssueIndex === null
        ? state
        : { ...state, selectedIssueIndex: null };
    }
    const issue = state.present.confidenceIssues[action.issueIndex];
    return issue
      ? {
          ...state,
          selectedIssueIndex: action.issueIndex,
          selectedCellIndex: issue.cellIndex,
        }
      : state;
  }
  if (action.type === "undo") {
    const entry = state.past[state.past.length - 1];
    if (!entry) {
      return state;
    }
    if (entry.kind === "project") {
      const movingEntry: BeadProjectHistoryEntry = {
        ...entry,
        afterProject: cloneBeadProject(state.present),
      };
      const present = applyHistoryEntry(
        state.present,
        movingEntry,
        "backward",
      );
      return normalizeProjectHistoryState(
        {
          ...state,
          present,
          past: state.past.slice(0, -1),
          future: [movingEntry, ...state.future],
        },
        present,
        movingEntry,
      );
    }
    return {
      ...state,
      present: applyHistoryEntry(
        state.present,
        entry,
        "backward",
      ),
      past: state.past.slice(0, -1),
      future: [entry, ...state.future],
    };
  }
  if (action.type === "redo") {
    const entry = state.future[0];
    if (!entry) {
      return state;
    }
    if (entry.kind === "project") {
      const movingEntry: BeadProjectHistoryEntry = {
        ...entry,
        beforeProject: cloneBeadProject(state.present),
      };
      const present = applyHistoryEntry(
        state.present,
        movingEntry,
        "forward",
      );
      return normalizeProjectHistoryState(
        {
          ...state,
          present,
          past: [...state.past, movingEntry],
          future: state.future.slice(1),
        },
        present,
        movingEntry,
      );
    }
    return {
      ...state,
      present: applyHistoryEntry(
        state.present,
        entry,
        "forward",
      ),
      past: [...state.past, entry],
      future: state.future.slice(1),
    };
  }
  if (action.type === "set-issue-resolved") {
    const issue = state.present.confidenceIssues[action.issueIndex];
    if (!issue || issue.resolved === action.resolved) {
      return state;
    }
    return commitHistoryEntry(state, {
      kind: "patch",
      cellPatches: [],
      issuePatches: [
        {
          index: action.issueIndex,
          before: issue.resolved,
          after: action.resolved,
        },
      ],
      beforeUpdatedAt: state.present.updatedAt,
      afterUpdatedAt: action.updatedAt ?? state.present.updatedAt,
    });
  }

  const rawTargetIndices =
    action.cellIndices && action.cellIndices.length > 0
      ? action.cellIndices
      : [action.cellIndex];
  const validIndices = rawTargetIndices.filter((index) =>
    isValidCellIndex(state.present, index),
  );
  if (validIndices.length === 0) {
    return state;
  }
  const primaryCellIndex = validIndices[validIndices.length - 1]!;
  const tool = action.tool ?? state.activeTool;
  if (tool === "eyedropper") {
    return applyEyedropper(state, validIndices[0]!);
  }
  const paletteIndex =
    action.paletteIndex ?? state.activePaletteIndex;
  const cellPatches = patchesForTool(
    state.present,
    tool,
    validIndices,
    paletteIndex,
  );
  if (cellPatches.length === 0) {
    return state;
  }
  const issuePatches = issuePatchesForCells(
    state.present,
    new Set(cellPatches.map((patch) => patch.index)),
  );
  const patchEntry: BeadPatchHistoryEntry = {
    kind: "patch",
    cellPatches,
    issuePatches,
    beforeUpdatedAt: state.present.updatedAt,
    afterUpdatedAt: action.updatedAt ?? state.present.updatedAt,
    ...(action.strokeId ? { strokeId: action.strokeId } : {}),
  };
  if (tool === "paint" && state.present.canvasMode === "auto-expand") {
    const paintedProject = applyHistoryEntry(
      state.present,
      patchEntry,
      "forward",
    );
    let expandedProject = paintedProject;
    let addTop = 0;
    let addLeft = 0;
    for (const index of validIndices) {
      const origRow = Math.floor(index / paintedProject.columns);
      const origCol = index % paintedProject.columns;
      const current =
        (origRow + addTop) * expandedProject.columns + origCol + addLeft;
      const expanded = expandAutoCanvasAroundCell(expandedProject, current);
      if (expanded.project !== expandedProject) {
        addTop =
          Math.floor(expanded.cellIndex / expanded.project.columns) - origRow;
        addLeft = (expanded.cellIndex % expanded.project.columns) - origCol;
        expandedProject = expanded.project;
      }
    }
    if (expandedProject !== paintedProject) {
      const expandedFocusIndex =
        (Math.floor(primaryCellIndex / paintedProject.columns) + addTop) *
          expandedProject.columns +
        (primaryCellIndex % paintedProject.columns) +
        addLeft;
      const expandedState = commitHistoryEntry(state, {
        kind: "project",
        beforeProject: cloneBeadProject(state.present),
        afterProject: cloneBeadProject(expandedProject),
        preserveActivePalette: true,
        ...(action.strokeId ? { strokeId: action.strokeId } : {}),
      });
      return {
        ...expandedState,
        activeTool: state.activeTool,
        activePaletteIndex: state.activePaletteIndex,
        selectedCellIndex: expandedFocusIndex,
        selectedIssueIndex: state.selectedIssueIndex,
      };
    }
  }
  return {
    ...commitHistoryEntry(state, patchEntry),
    selectedCellIndex: primaryCellIndex,
  };
}
