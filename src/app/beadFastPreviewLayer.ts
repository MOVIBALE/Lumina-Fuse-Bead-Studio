import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  ExtrudeGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  Path,
  Quaternion,
  Scene,
  Shape,
  Vector3,
} from "three";

import type {
  FastBeadPreviewModel,
  FastBeadPreviewSlot,
} from "../domain/fastPreviewModel";
import type { RgbColor } from "../domain/types";

/**
 * Duration of one fast bead placement motion in milliseconds.
 * 单颗拼豆快速放置动画的时长（毫秒）。
 */
export const BEAD_PLACEMENT_ANIMATION_MS = 370;

/**
 * Duration of one outgoing replacement or erase motion in milliseconds.
 * 单颗拼豆换色或擦除退场动画的时长（毫秒）。
 */
export const BEAD_EXIT_ANIMATION_MS = 350;

/**
 * Persistent browser-side instance layer for immediate bead feedback.
 * 用于即时拼豆反馈的浏览器端常驻实例层。
 */
export interface BeadFastPreviewLayer {
  /** Latest project revision accepted by this layer. / 此层已接收的最新项目修订号。 */
  readonly revision: number;

  /**
   * Hints the cell index where the next user edit originates so batch domino
   * waves radiate directly from the clicked peg.
   * 标记下一次用户编辑的起始格索引，使整片操作的多米诺波浪直接从点击位置扩散。
   */
  setActionOriginCell?(cellIndex: number | null): void;

  /**
   * Applies one lightweight model and starts only new placement animations.
   * When a cell mask is supplied, only non-zero slots are drawn so an exact
   * fused surface can remain visible beneath local edits.
   *
   * 应用一份轻量模型，并且只为新增拼豆启动放置动画。
   * 传入单格遮罩时，仅绘制非零格，允许局部编辑时保留其余精确融合表面。
   */
  update(
    model: FastBeadPreviewModel,
    revision: number,
    now: number,
    visibleCellMask?: Uint8Array,
  ): void;

  /**
   * Advances active placements and reports whether another frame is needed.
   * 推进活动中的放置动画，并返回是否还需要下一帧。
   */
  advance(now: number): boolean;

  /**
   * Reports whether any bead placement is still moving.
   * 返回当前是否仍有拼豆处于放置动画中。
   */
  hasActiveAnimations(): boolean;

  /**
   * Shows or hides the persistent fast mesh without rebuilding it.
   * 显示或隐藏常驻快速网格，且不会重建网格。
   */
  setVisible(visible: boolean): void;

  /**
   * Releases the mesh and its GPU resources exactly once.
   * 仅一次释放网格及其 GPU 资源。
   */
  dispose(): void;
}

interface PlacementAnimation {
  startedAt: number;
  delayMs: number;
  durationMs: number;
  slot: FastBeadPreviewSlot;
  heightMm: number;
  dropHeightMm: number;
  keepSeatedFootprint: boolean;
  sympatheticBounce: boolean;
  colorFrom: Color | null;
  colorTo: Color | null;
}

interface ExitAnimation {
  startedAt: number;
  delayMs: number;
  durationMs: number;
  startPosition: Vector3;
  startScale: Vector3;
  hopX: number;
  hopZ: number;
  liftMm: number;
  spinAxis: Vector3;
  maxSpinRad: number;
  sparkRadiusMm: number;
  sparkBaseSizeMm: number;
  ringMaxRadiusMm: number;
  ringY: number;
  burstSparks: boolean;
  sparkBrightColor: Color;
  sparkGleamColor: Color;
  ringColor: Color;
}

const SPARKS_PER_EXIT = 8;
const SPARKS_PER_BATCH_EXIT = 4;
const MAX_SPARK_INSTANCES = 320;
const MAX_RING_INSTANCES = 128;
const RING_DURATION_MS = 270;
const SYMPATHETIC_BOUNCE_MS = 260;
const SWIPE_MEMORY_MS = 200;
const GOLDEN_ANGLE_RAD = 2.399963229728653;

interface PlacementPose {
  radialScale: number;
  verticalScale: number;
  liftMm: number;
}

const OUTER_SEGMENTS = 24;
const LARGE_BOARD_SEGMENTS = 16;
const LARGE_BOARD_CELL_THRESHOLD = 600;
const INITIAL_SCALE = 0.18;
const APPEARANCE_END_MS = 80;
const FALL_END_MS = 270;
const MAX_SUPERELLIPSE_EXPONENT_DELTA = 4;
const HIGH_PRESSURE_SQUARE_START = 0.85;
const IDENTITY_ROTATION = new Quaternion();

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

function easeOutCubic(value: number): number {
  const remaining = 1 - clamp01(value);
  return 1 - remaining * remaining * remaining;
}

function superellipsePoint(
  angle: number,
  radiusMm: number,
  exponent: number,
): readonly [number, number] {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    radiusMm * Math.sign(cosine) * Math.pow(Math.abs(cosine), 2 / exponent),
    radiusMm * Math.sign(sine) * Math.pow(Math.abs(sine), 2 / exponent),
  ];
}

/**
 * Resolves the fast-preview superellipse exponent from canonical pressure.
 * 根据规范化压合压力解析快速预览的超椭圆指数。
 */
export function resolveFastBeadSuperellipseExponent(pressure: number): number {
  if (!Number.isFinite(pressure) || pressure < 0 || pressure > 1) {
    throw new RangeError("Fast preview pressure must be between 0 and 1.");
  }
  const highPressure = smoothstep(
    (pressure - HIGH_PRESSURE_SQUARE_START) /
      (1 - HIGH_PRESSURE_SQUARE_START),
  );
  return 2 + highPressure * MAX_SUPERELLIPSE_EXPONENT_DELTA;
}

function appendSuperellipse(
  path: Shape | Path,
  radiusMm: number,
  exponent: number,
  clockwise: boolean,
  segments: number,
): void {
  for (let index = 0; index < segments; index += 1) {
    const unit = index / segments;
    const angle = (clockwise ? -1 : 1) * unit * Math.PI * 2;
    const [x, y] = superellipsePoint(angle, radiusMm, exponent);
    if (index === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
}

function createFastBeadGeometry(
  model: FastBeadPreviewModel,
): ExtrudeGeometry {
  const segments =
    model.rows * model.columns > LARGE_BOARD_CELL_THRESHOLD
      ? LARGE_BOARD_SEGMENTS
      : OUTER_SEGMENTS;
  const outerExponent = resolveFastBeadSuperellipseExponent(model.pressure);
  const shape = new Shape();
  appendSuperellipse(shape, model.outerRadiusMm, outerExponent, false, segments);

  if (model.holeRadiusMm > Number.EPSILON) {
    const hole = new Path();
    appendSuperellipse(hole, model.holeRadiusMm, 2, true, segments);
    shape.holes.push(hole);
  }

  const geometry = new ExtrudeGeometry(shape, {
    depth: model.heightMm,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, model.heightMm / 2, 0);
  geometry.computeVertexNormals();
  return geometry;
}

function physicalProfileKey(model: FastBeadPreviewModel): string {
  return [
    model.rows * model.columns,
    model.pressure,
    model.outerRadiusMm,
    model.holeRadiusMm,
    model.contactReachMm,
    model.heightMm,
  ].join(":");
}

function placementPose(
  elapsedMs: number,
  animation: PlacementAnimation,
): PlacementPose {
  if (animation.sympatheticBounce) {
    const progress = clamp01(elapsedMs / animation.durationMs);
    const wave = Math.sin(progress * Math.PI * 2.5) * (1 - progress);
    return {
      radialScale: 1 + 0.065 * wave,
      verticalScale: 1 - 0.075 * wave,
      liftMm: animation.heightMm * 0.14 * Math.max(0, wave),
    } satisfies PlacementPose;
  }

  if (animation.keepSeatedFootprint) {
    const progress = clamp01(elapsedMs / animation.durationMs);
    const pulse = Math.sin(Math.PI * progress);
    return {
      radialScale: 1 + 0.025 * pulse,
      verticalScale: 1 + 0.035 * pulse,
      liftMm: 0,
    } satisfies PlacementPose;
  }

  if (elapsedMs < APPEARANCE_END_MS) {
    const progress = easeOutCubic(elapsedMs / APPEARANCE_END_MS);
    const scale = INITIAL_SCALE + (1 - INITIAL_SCALE) * progress;
    return {
      radialScale: scale,
      verticalScale: scale,
      liftMm: animation.dropHeightMm,
    } satisfies PlacementPose;
  }

  if (elapsedMs < FALL_END_MS) {
    const progress = smoothstep(
      (elapsedMs - APPEARANCE_END_MS) /
        (FALL_END_MS - APPEARANCE_END_MS),
    );
    const impact = smoothstep((progress - 0.76) / 0.24);
    return {
      radialScale: 1 + 0.03 * impact,
      verticalScale: 1 - 0.06 * impact,
      liftMm: animation.dropHeightMm * (1 - progress),
    } satisfies PlacementPose;
  }

  const progress = clamp01(
    (elapsedMs - FALL_END_MS) /
      (BEAD_PLACEMENT_ANIMATION_MS - FALL_END_MS),
  );
  const rebound = Math.sin(Math.PI * progress);
  return {
    radialScale: 1 + 0.03 * (1 - progress) - 0.01 * rebound,
    verticalScale: 0.94 + 0.06 * progress + 0.03 * rebound,
    liftMm: animation.heightMm * 0.07 * rebound,
  } satisfies PlacementPose;
}

function createSparkOctahedronGeometry(radius: number): BufferGeometry {
  const r = radius;
  const positions = new Float32Array([
    0, r, 0,  r, 0, 0,  0, 0, r,
    0, r, 0,  0, 0, r, -r, 0, 0,
    0, r, 0, -r, 0, 0,  0, 0, -r,
    0, r, 0,  0, 0, -r, r, 0, 0,
    0, -r, 0, 0, 0, r,  r, 0, 0,
    0, -r, 0, -r, 0, 0, 0, 0, r,
    0, -r, 0, 0, 0, -r, -r, 0, 0,
    0, -r, 0, r, 0, 0,  0, 0, -r,
  ]);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createShockwaveRingGeometry(
  innerRadius: number,
  outerRadius: number,
  segments: number,
): BufferGeometry {
  const positions = new Float32Array(segments * 6 * 3);
  let offset = 0;
  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    positions[offset++] = c0 * innerRadius;
    positions[offset++] = 0;
    positions[offset++] = s0 * innerRadius;
    positions[offset++] = c0 * outerRadius;
    positions[offset++] = 0;
    positions[offset++] = s0 * outerRadius;
    positions[offset++] = c1 * outerRadius;
    positions[offset++] = 0;
    positions[offset++] = s1 * outerRadius;
    positions[offset++] = c0 * innerRadius;
    positions[offset++] = 0;
    positions[offset++] = s0 * innerRadius;
    positions[offset++] = c1 * outerRadius;
    positions[offset++] = 0;
    positions[offset++] = s1 * outerRadius;
    positions[offset++] = c1 * innerRadius;
    positions[offset++] = 0;
    positions[offset++] = s1 * innerRadius;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  return geometry;
}

function previewTopologyKey(model: FastBeadPreviewModel): string {
  return `${model.projectId}:${model.rows}:${model.columns}`;
}

class ThreeBeadFastPreviewLayer implements BeadFastPreviewLayer {
  private readonly scene: Scene;
  private readonly reduceMotion: boolean;
  private readonly instanceMatrix = new Matrix4();
  private readonly instancePosition = new Vector3();
  private readonly instanceRotation = new Quaternion();
  private readonly instanceScale = new Vector3();
  private readonly instanceColor = new Color();
  private readonly sparkAxis = new Vector3();
  private readonly animations = new Map<number, PlacementAnimation>();
  private readonly exits = new Map<number, ExitAnimation>();
  private mesh: InstancedMesh<ExtrudeGeometry, MeshPhysicalMaterial> | null =
    null;
  private outgoingMesh:
    | InstancedMesh<ExtrudeGeometry, MeshPhysicalMaterial>
    | null = null;
  private sparkMesh:
    | InstancedMesh<BufferGeometry, MeshBasicMaterial>
    | null = null;
  private ringMesh:
    | InstancedMesh<BufferGeometry, MeshBasicMaterial>
    | null = null;
  private sparkColorDynamic = false;
  private ringColorDynamic = false;
  private ringAlphaAttr: InstancedBufferAttribute | null = null;
  private ringAlphas = new Float32Array(MAX_RING_INSTANCES);
  private pendingActionOriginCell: number | null = null;
  private lastEraseCenterX = 0;
  private lastEraseCenterZ = 0;
  private lastEraseTimeMs = -10_000;
  private profileKey: string | null = null;
  private topologyKey: string | null = null;
  private snapshotVisible = new Uint8Array(0);
  private snapshotColor = new Float64Array(0);
  private snapshotGeometry = new Float64Array(0);
  private initialized = false;
  private requestedVisible = true;
  private currentRevision = -1;
  private disposed = false;

  constructor(scene: Scene, reduceMotion: boolean) {
    this.scene = scene;
    this.reduceMotion = reduceMotion;
  }

  get revision(): number {
    return this.currentRevision;
  }

  setActionOriginCell(cellIndex: number | null): void {
    this.pendingActionOriginCell = cellIndex;
  }

  update(
    model: FastBeadPreviewModel,
    revision: number,
    now: number,
    visibleCellMask?: Uint8Array,
  ): void {
    if (this.disposed) return;
    if (revision < this.currentRevision) return;
    const capacity = model.rows * model.columns;
    if (model.slots.length !== capacity) {
      throw new Error(
        `Fast preview slot count ${model.slots.length} does not match ${capacity}.`,
      );
    }
    if (
      visibleCellMask !== undefined &&
      visibleCellMask.length !== capacity
    ) {
      throw new Error(
        `Fast preview mask count ${visibleCellMask.length} does not match ${capacity}.`,
      );
    }

    const nextTopologyKey = previewTopologyKey(model);
    const topologyChanged =
      this.topologyKey !== null && this.topologyKey !== nextTopologyKey;
    const rebuilt = this.ensureMesh(model);
    const mesh = this.mesh;
    const outgoingMesh = this.outgoingMesh;
    if (mesh === null || outgoingMesh === null) return;
    this.ensureSnapshotCapacity(capacity);
    let matrixDirty = false;
    let colorDirty = false;
    let outgoingMatrixDirty = false;
    let outgoingColorDirty = false;

    const actionOriginCell = this.pendingActionOriginCell;
    this.pendingActionOriginCell = null;

    if (rebuilt || topologyChanged || !this.initialized) {
      this.animations.clear();
      this.exits.clear();
      this.clearSparks();
      this.clearRings();
      for (const slot of model.slots) {
        if (slot.visible) {
          this.writeFinalMatrix(mesh, slot.cellIndex, slot, model.heightMm);
          this.writeColor(mesh, slot.cellIndex, slot.color);
          colorDirty = true;
        } else {
          this.writeHiddenMatrix(mesh, slot.cellIndex, slot);
        }
        this.writeHiddenMatrix(outgoingMesh, slot.cellIndex, slot);
        matrixDirty = true;
        outgoingMatrixDirty = true;
      }
      this.initialized = true;
    } else {
      const newlyErasedIndices: number[] = [];
      let eraseSumX = 0;
      let eraseSumZ = 0;
      const newlyPlacedIndices: number[] = [];
      let placeSumX = 0;
      let placeSumZ = 0;
      if (!this.reduceMotion) {
        for (const slot of model.slots) {
          const previousVisible = this.snapshotVisible[slot.cellIndex] === 1;
          if (
            !slot.visible &&
            (previousVisible || this.animations.has(slot.cellIndex))
          ) {
            newlyErasedIndices.push(slot.cellIndex);
            eraseSumX += slot.xMm;
            eraseSumZ += slot.zMm;
          } else if (slot.visible && !previousVisible) {
            newlyPlacedIndices.push(slot.cellIndex);
            placeSumX += slot.xMm;
            placeSumZ += slot.zMm;
          }
        }
      }
      const eraseBatchCount = newlyErasedIndices.length;
      const eraseBatchCenterX =
        eraseBatchCount > 0 ? eraseSumX / eraseBatchCount : 0;
      const eraseBatchCenterZ =
        eraseBatchCount > 0 ? eraseSumZ / eraseBatchCount : 0;
      const newlyErasedSet =
        eraseBatchCount > 0 ? new Set(newlyErasedIndices) : null;

      let eraseOriginX = eraseBatchCenterX;
      let eraseOriginZ = eraseBatchCenterZ;
      if (
        actionOriginCell !== null &&
        newlyErasedSet?.has(actionOriginCell)
      ) {
        const originSlot = model.slots[actionOriginCell];
        if (originSlot !== undefined) {
          eraseOriginX = originSlot.xMm;
          eraseOriginZ = originSlot.zMm;
        }
      }

      let hasSwipeDir = false;
      let swipeDirX = 0;
      let swipeDirZ = 0;
      if (eraseBatchCount > 0) {
        const dt = now - this.lastEraseTimeMs;
        if (dt > 0 && dt <= SWIPE_MEMORY_MS) {
          const sdx = eraseBatchCenterX - this.lastEraseCenterX;
          const sdz = eraseBatchCenterZ - this.lastEraseCenterZ;
          const swipeLen = Math.hypot(sdx, sdz);
          if (swipeLen > 0.05) {
            swipeDirX = sdx / swipeLen;
            swipeDirZ = sdz / swipeLen;
            hasSwipeDir = true;
          }
        }
        this.lastEraseCenterX = eraseBatchCenterX;
        this.lastEraseCenterZ = eraseBatchCenterZ;
        this.lastEraseTimeMs = now;
      }

      const placeBatchCount = newlyPlacedIndices.length;
      let placeOriginX =
        placeBatchCount > 0 ? placeSumX / placeBatchCount : 0;
      let placeOriginZ =
        placeBatchCount > 0 ? placeSumZ / placeBatchCount : 0;
      if (
        actionOriginCell !== null &&
        placeBatchCount > 1 &&
        newlyPlacedIndices.includes(actionOriginCell)
      ) {
        const originSlot = model.slots[actionOriginCell];
        if (originSlot !== undefined) {
          placeOriginX = originSlot.xMm;
          placeOriginZ = originSlot.zMm;
        }
      }

      for (const slot of model.slots) {
        const previousVisible = this.snapshotVisible[slot.cellIndex] === 1;
        const colorChanged = !this.sameSnapshotColor(slot.cellIndex, slot.color);
        const geometryChanged = !this.sameSnapshotGeometry(slot.cellIndex, slot);

        if (!slot.visible) {
          if (previousVisible || this.animations.has(slot.cellIndex)) {
            if (this.reduceMotion) {
              this.exits.delete(slot.cellIndex);
              this.writeHiddenMatrix(
                outgoingMesh,
                slot.cellIndex,
                slot,
              );
            } else {
              let delayMs = 0;
              let dirX = Math.cos(slot.cellIndex * GOLDEN_ANGLE_RAD);
              let dirZ = Math.sin(slot.cellIndex * GOLDEN_ANGLE_RAD);
              if (eraseBatchCount > 1 && model.beadPitchMm > 0) {
                const dx = slot.xMm - eraseOriginX;
                const dz = slot.zMm - eraseOriginZ;
                const distMm = Math.hypot(dx, dz);
                const distCells = distMm / model.beadPitchMm;
                delayMs = Math.min(240, distCells * 24);
                if (distMm > 1e-3) {
                  dirX = (dx / distMm) * 0.78 + dirX * 0.22;
                  dirZ = (dz / distMm) * 0.78 + dirZ * 0.22;
                }
              }
              if (hasSwipeDir) {
                dirX = swipeDirX * 0.72 + dirX * 0.28;
                dirZ = swipeDirZ * 0.72 + dirZ * 0.28;
              }
              const dirLen = Math.hypot(dirX, dirZ) || 1;
              dirX /= dirLen;
              dirZ /= dirLen;

              this.startExit(
                slot.cellIndex,
                now,
                model,
                true,
                delayMs,
                dirX,
                dirZ,
              );
              outgoingColorDirty = true;
            }
            outgoingMatrixDirty = true;
            this.animations.delete(slot.cellIndex);
            this.writeHiddenMatrix(mesh, slot.cellIndex, slot);
            matrixDirty = true;
          }
          continue;
        }

        if (!previousVisible) {
          if (this.exits.delete(slot.cellIndex)) {
            this.writeHiddenMatrix(
              outgoingMesh,
              slot.cellIndex,
              slot,
            );
            outgoingMatrixDirty = true;
          }
          this.writeColor(mesh, slot.cellIndex, slot.color);
          colorDirty = true;
          if (this.reduceMotion) {
            this.writeFinalMatrix(mesh, slot.cellIndex, slot, model.heightMm);
          } else {
            let placeDelayMs = 0;
            if (placeBatchCount > 1 && model.beadPitchMm > 0) {
              const distCells =
                Math.hypot(slot.xMm - placeOriginX, slot.zMm - placeOriginZ) /
                model.beadPitchMm;
              placeDelayMs = Math.min(200, distCells * 16);
            }
            this.startPlacement(
              mesh,
              slot,
              model,
              now,
              false,
              null,
              placeDelayMs,
            );
          }
          matrixDirty = true;
          continue;
        }

        if (colorChanged) {
          if (this.reduceMotion) {
            this.animations.delete(slot.cellIndex);
            this.exits.delete(slot.cellIndex);
            this.writeHiddenMatrix(
              outgoingMesh,
              slot.cellIndex,
              slot,
            );
            outgoingMatrixDirty = true;
            this.writeColor(mesh, slot.cellIndex, slot.color);
            this.writeFinalMatrix(
              mesh,
              slot.cellIndex,
              slot,
              model.heightMm,
            );
          } else {
            const keepSeatedFootprint = model.holeRadiusMm === 0;
            if (keepSeatedFootprint) {
              mesh.getColorAt(slot.cellIndex, this.instanceColor);
              const previousColor = this.instanceColor.clone();
              this.exits.delete(slot.cellIndex);
              this.writeHiddenMatrix(
                outgoingMesh,
                slot.cellIndex,
                slot,
              );
              outgoingMatrixDirty = true;
              this.startPlacement(
                mesh,
                slot,
                model,
                now,
                true,
                previousColor,
              );
            } else {
              const angle = slot.cellIndex * GOLDEN_ANGLE_RAD;
              this.startExit(
                slot.cellIndex,
                now,
                model,
                false,
                0,
                Math.cos(angle) * 0.25,
                Math.sin(angle) * 0.25,
              );
              outgoingMatrixDirty = true;
              outgoingColorDirty = true;
              this.writeColor(mesh, slot.cellIndex, slot.color);
              this.startPlacement(mesh, slot, model, now, true);
            }
          }
          colorDirty = true;
          matrixDirty = true;
          continue;
        }

        const shouldSympatheticBounce =
          !this.reduceMotion &&
          newlyErasedSet !== null &&
          !this.animations.has(slot.cellIndex) &&
          this.hasAdjacentErased(
            slot.cellIndex,
            model.rows,
            model.columns,
            newlyErasedSet,
          );

        if (geometryChanged) {
          const active = this.animations.get(slot.cellIndex);
          if (active) {
            active.slot = {
              ...slot,
              color: slot.color === null ? null : [...slot.color],
            };
            active.heightMm = model.heightMm;
            this.writeAnimatedMatrix(
              mesh,
              slot.cellIndex,
              active,
              Math.max(0, now - active.startedAt),
            );
          } else if (shouldSympatheticBounce) {
            this.startSympatheticBounce(mesh, slot, model, now);
          } else {
            this.writeFinalMatrix(mesh, slot.cellIndex, slot, model.heightMm);
          }
          matrixDirty = true;
        } else if (shouldSympatheticBounce) {
          this.startSympatheticBounce(mesh, slot, model, now);
          matrixDirty = true;
        }
      }
    }

    if (visibleCellMask !== undefined) {
      for (const slot of model.slots) {
        if (visibleCellMask[slot.cellIndex] !== 0) continue;
        this.animations.delete(slot.cellIndex);
        this.exits.delete(slot.cellIndex);
        this.writeHiddenMatrix(mesh, slot.cellIndex, slot);
        this.writeHiddenMatrix(outgoingMesh, slot.cellIndex, slot);
        matrixDirty = true;
        outgoingMatrixDirty = true;
      }
    }

    this.captureSnapshots(model);
    this.topologyKey = nextTopologyKey;
    this.currentRevision = revision;
    this.flushChanges(mesh, matrixDirty, colorDirty);
    this.flushChanges(
      outgoingMesh,
      outgoingMatrixDirty,
      outgoingColorDirty,
    );
    this.syncSparks(now);
    this.syncRings(now);
  }

  advance(now: number): boolean {
    if (
      this.disposed ||
      this.mesh === null ||
      this.outgoingMesh === null ||
      (this.animations.size === 0 && this.exits.size === 0)
    ) {
      return false;
    }

    let matrixDirty = false;
    let colorDirty = false;
    for (const [cellIndex, animation] of this.animations) {
      const elapsedMs = Math.max(0, now - animation.startedAt);
      if (elapsedMs >= animation.delayMs + animation.durationMs) {
        this.writeFinalMatrix(
          this.mesh,
          cellIndex,
          animation.slot,
          animation.heightMm,
        );
        this.animations.delete(cellIndex);
      } else {
        this.writeAnimatedMatrix(
          this.mesh,
          cellIndex,
          animation,
          elapsedMs,
        );
      }
      if (animation.colorFrom !== null && animation.colorTo !== null) {
        const localElapsed = Math.max(0, elapsedMs - animation.delayMs);
        const colorProgress = easeOutCubic(
          localElapsed / BEAD_EXIT_ANIMATION_MS,
        );
        this.instanceColor.lerpColors(
          animation.colorFrom,
          animation.colorTo,
          colorProgress,
        );
        this.mesh.setColorAt(cellIndex, this.instanceColor);
        colorDirty = true;
      }
      matrixDirty = true;
    }
    this.flushChanges(this.mesh, matrixDirty, colorDirty);
    let outgoingMatrixDirty = false;
    for (const [cellIndex, exit] of this.exits) {
      const elapsedMs = Math.max(0, now - exit.startedAt);
      if (elapsedMs >= exit.delayMs + exit.durationMs) {
        this.writeHiddenExitMatrix(this.outgoingMesh, cellIndex, exit);
        this.exits.delete(cellIndex);
      } else {
        this.writeExitMatrix(
          this.outgoingMesh,
          cellIndex,
          exit,
          elapsedMs,
        );
      }
      outgoingMatrixDirty = true;
    }
    this.flushChanges(this.outgoingMesh, outgoingMatrixDirty, false);
    this.syncSparks(now);
    this.syncRings(now);
    return this.animations.size > 0 || this.exits.size > 0;
  }

  hasActiveAnimations(): boolean {
    return this.animations.size > 0 || this.exits.size > 0;
  }

  setVisible(visible: boolean): void {
    this.requestedVisible = visible;
    if (this.mesh !== null) this.mesh.visible = visible;
    if (this.outgoingMesh !== null) this.outgoingMesh.visible = visible;
    if (this.sparkMesh !== null) {
      this.sparkMesh.visible = visible && this.sparkMesh.count > 0;
    }
    if (this.ringMesh !== null) {
      this.ringMesh.visible = visible && this.ringMesh.count > 0;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.animations.clear();
    this.exits.clear();
    this.disposeMesh();
    this.snapshotVisible = new Uint8Array(0);
    this.snapshotColor = new Float64Array(0);
    this.snapshotGeometry = new Float64Array(0);
    this.topologyKey = null;
  }

  private ensureMesh(model: FastBeadPreviewModel): boolean {
    const nextProfileKey = physicalProfileKey(model);
    if (
      this.mesh !== null &&
      this.outgoingMesh !== null &&
      this.profileKey === nextProfileKey
    ) {
      return false;
    }

    this.disposeMesh();
    const geometry = createFastBeadGeometry(model);
    const material = new MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.43,
      metalness: 0,
      clearcoat: 0.2,
      clearcoatRoughness: 0.5,
    });
    const mesh = new InstancedMesh(
      geometry,
      material,
      model.rows * model.columns,
    );
    mesh.name = "bead-preview-fast-beads";
    mesh.visible = this.requestedVisible;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    const outgoingMesh = new InstancedMesh(
      geometry,
      material,
      model.rows * model.columns,
    );
    outgoingMesh.name = "bead-preview-fast-outgoing";
    outgoingMesh.visible = this.requestedVisible;
    outgoingMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    outgoingMesh.frustumCulled = false;
    outgoingMesh.renderOrder = mesh.renderOrder + 1;

    const sparkGeometry = createSparkOctahedronGeometry(0.58);
    const sparkMaterial = new MeshBasicMaterial({
      color: 0xffffff,
    });
    const sparkMesh = new InstancedMesh(
      sparkGeometry,
      sparkMaterial,
      MAX_SPARK_INSTANCES,
    );
    sparkMesh.name = "bead-preview-fast-sparks";
    sparkMesh.visible = false;
    sparkMesh.count = 0;
    sparkMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    sparkMesh.frustumCulled = false;
    sparkMesh.renderOrder = outgoingMesh.renderOrder + 2;

    const ringGeometry = createShockwaveRingGeometry(0.68, 1.0, 16);
    this.ringAlphas = new Float32Array(MAX_RING_INSTANCES);
    const ringAlphaAttr = new InstancedBufferAttribute(this.ringAlphas, 1);
    ringAlphaAttr.setUsage(DynamicDrawUsage);
    ringGeometry.setAttribute("aRingAlpha", ringAlphaAttr);
    const ringMaterial = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: DoubleSide,
    });
    ringMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = `attribute float aRingAlpha;\nvarying float vRingAlpha;\n${shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvRingAlpha = aRingAlpha;",
      )}`;
      shader.fragmentShader = `varying float vRingAlpha;\n${shader.fragmentShader.replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.a *= vRingAlpha;",
      )}`;
    };
    ringMaterial.customProgramCacheKey = () => "bead-fast-ring-alpha-v1";
    const ringMesh = new InstancedMesh(
      ringGeometry,
      ringMaterial,
      MAX_RING_INSTANCES,
    );
    ringMesh.name = "bead-preview-fast-rings";
    ringMesh.visible = false;
    ringMesh.count = 0;
    ringMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    ringMesh.frustumCulled = false;
    ringMesh.renderOrder = outgoingMesh.renderOrder + 1;

    this.scene.add(mesh);
    this.scene.add(outgoingMesh);
    this.scene.add(sparkMesh);
    this.scene.add(ringMesh);
    this.mesh = mesh;
    this.outgoingMesh = outgoingMesh;
    this.sparkMesh = sparkMesh;
    this.ringMesh = ringMesh;
    this.ringAlphaAttr = ringAlphaAttr;
    this.sparkColorDynamic = false;
    this.ringColorDynamic = false;
    this.profileKey = nextProfileKey;
    this.animations.clear();
    this.exits.clear();
    this.initialized = false;
    return true;
  }

  private ensureSnapshotCapacity(capacity: number): void {
    if (this.snapshotVisible.length === capacity) return;
    this.snapshotVisible = new Uint8Array(capacity);
    this.snapshotColor = new Float64Array(capacity * 3);
    this.snapshotGeometry = new Float64Array(capacity * 4);
  }

  private sameSnapshotColor(
    cellIndex: number,
    color: RgbColor | null,
  ): boolean {
    const previousVisible = this.snapshotVisible[cellIndex] === 1;
    if (!previousVisible || color === null) {
      return !previousVisible && color === null;
    }
    const offset = cellIndex * 3;
    return (
      this.snapshotColor[offset] === color[0] &&
      this.snapshotColor[offset + 1] === color[1] &&
      this.snapshotColor[offset + 2] === color[2]
    );
  }

  private sameSnapshotGeometry(
    cellIndex: number,
    slot: FastBeadPreviewSlot,
  ): boolean {
    const offset = cellIndex * 4;
    return (
      this.snapshotGeometry[offset] === slot.xMm &&
      this.snapshotGeometry[offset + 1] === slot.zMm &&
      this.snapshotGeometry[offset + 2] === slot.scaleX &&
      this.snapshotGeometry[offset + 3] === slot.scaleZ
    );
  }

  private captureSnapshots(model: FastBeadPreviewModel): void {
    for (const slot of model.slots) {
      const cellIndex = slot.cellIndex;
      this.snapshotVisible[cellIndex] = slot.visible ? 1 : 0;
      const colorOffset = cellIndex * 3;
      this.snapshotColor[colorOffset] = slot.color?.[0] ?? 0;
      this.snapshotColor[colorOffset + 1] = slot.color?.[1] ?? 0;
      this.snapshotColor[colorOffset + 2] = slot.color?.[2] ?? 0;
      const geometryOffset = cellIndex * 4;
      this.snapshotGeometry[geometryOffset] = slot.xMm;
      this.snapshotGeometry[geometryOffset + 1] = slot.zMm;
      this.snapshotGeometry[geometryOffset + 2] = slot.scaleX;
      this.snapshotGeometry[geometryOffset + 3] = slot.scaleZ;
    }
  }

  private startPlacement(
    mesh: InstancedMesh,
    slot: FastBeadPreviewSlot,
    model: FastBeadPreviewModel,
    now: number,
    replacing = false,
    replacementColorFrom: Color | null = null,
    delayMs = 0,
  ): void {
    const keepSeatedFootprint = replacing && model.holeRadiusMm === 0;
    let colorFrom: Color | null = null;
    let colorTo: Color | null = null;
    if (keepSeatedFootprint && mesh.instanceColor !== null) {
      colorFrom = replacementColorFrom?.clone() ?? null;
      if (colorFrom === null) {
        mesh.getColorAt(slot.cellIndex, this.instanceColor);
        colorFrom = this.instanceColor.clone();
      }
      const [red, green, blue] = slot.color ?? [0, 0, 0];
      colorTo = new Color().setStyle(`rgb(${red}, ${green}, ${blue})`);
      mesh.setColorAt(slot.cellIndex, colorFrom);
    }
    const animation = {
      startedAt: now,
      delayMs,
      durationMs: BEAD_PLACEMENT_ANIMATION_MS,
      slot: {
        ...slot,
        color: slot.color === null ? null : [...slot.color],
      },
      heightMm: model.heightMm,
      dropHeightMm: Math.max(
        model.heightMm * 1.8,
        model.outerRadiusMm * 0.7,
      ),
      keepSeatedFootprint,
      sympatheticBounce: false,
      colorFrom,
      colorTo,
    } satisfies PlacementAnimation;
    this.animations.set(slot.cellIndex, animation);
    this.writeAnimatedMatrix(mesh, slot.cellIndex, animation, 0);
  }

  private hasAdjacentErased(
    cellIndex: number,
    rows: number,
    columns: number,
    erasedSet: ReadonlySet<number>,
  ): boolean {
    const row = Math.floor(cellIndex / columns);
    const col = cellIndex % columns;
    return (
      (row > 0 && erasedSet.has(cellIndex - columns)) ||
      (row + 1 < rows && erasedSet.has(cellIndex + columns)) ||
      (col > 0 && erasedSet.has(cellIndex - 1)) ||
      (col + 1 < columns && erasedSet.has(cellIndex + 1))
    );
  }

  private startSympatheticBounce(
    mesh: InstancedMesh,
    slot: FastBeadPreviewSlot,
    model: FastBeadPreviewModel,
    now: number,
  ): void {
    const animation: PlacementAnimation = {
      startedAt: now,
      delayMs: 0,
      durationMs: SYMPATHETIC_BOUNCE_MS,
      slot: {
        ...slot,
        color: slot.color === null ? null : [...slot.color],
      },
      heightMm: model.heightMm,
      dropHeightMm: 0,
      keepSeatedFootprint: false,
      sympatheticBounce: true,
      colorFrom: null,
      colorTo: null,
    };
    this.animations.set(slot.cellIndex, animation);
    this.writeAnimatedMatrix(mesh, slot.cellIndex, animation, 0);
  }

  private startExit(
    cellIndex: number,
    now: number,
    model: FastBeadPreviewModel,
    burstSparks = true,
    delayMs = 0,
    dirX = 1,
    dirZ = 0,
  ): void {
    if (this.mesh === null || this.outgoingMesh === null) return;
    this.mesh.getMatrixAt(cellIndex, this.instanceMatrix);
    this.instanceMatrix.decompose(
      this.instancePosition,
      this.instanceRotation,
      this.instanceScale,
    );
    if (
      this.instanceScale.lengthSq() <= Number.EPSILON &&
      this.snapshotVisible[cellIndex] === 1
    ) {
      const geometryOffset = cellIndex * 4;
      this.instancePosition.set(
        this.snapshotGeometry[geometryOffset] ?? 0,
        model.heightMm / 2,
        this.snapshotGeometry[geometryOffset + 1] ?? 0,
      );
      this.instanceScale.set(
        this.snapshotGeometry[geometryOffset + 2] ?? 1,
        1,
        this.snapshotGeometry[geometryOffset + 3] ?? 1,
      );
      this.instanceMatrix.compose(
        this.instancePosition,
        IDENTITY_ROTATION,
        this.instanceScale,
      );
    }
    this.outgoingMesh.setMatrixAt(cellIndex, this.instanceMatrix);
    let colorR = 244;
    let colorG = 63;
    let colorB = 94;
    if (!this.animations.has(cellIndex) && this.snapshotVisible[cellIndex] === 1) {
      const colorOffset = cellIndex * 3;
      colorR = this.snapshotColor[colorOffset] ?? 244;
      colorG = this.snapshotColor[colorOffset + 1] ?? 63;
      colorB = this.snapshotColor[colorOffset + 2] ?? 94;
      this.instanceColor.setStyle(`rgb(${colorR}, ${colorG}, ${colorB})`);
      this.outgoingMesh.setColorAt(cellIndex, this.instanceColor);
      this.outgoingMesh.instanceColor?.setUsage(DynamicDrawUsage);
    } else if (this.mesh.instanceColor !== null) {
      this.mesh.getColorAt(cellIndex, this.instanceColor);
      colorR = Math.round(clamp01(this.instanceColor.r) * 255);
      colorG = Math.round(clamp01(this.instanceColor.g) * 255);
      colorB = Math.round(clamp01(this.instanceColor.b) * 255);
      this.outgoingMesh.setColorAt(cellIndex, this.instanceColor);
      this.outgoingMesh.instanceColor?.setUsage(DynamicDrawUsage);
    }

    const spinAxis = new Vector3(-dirZ, 0.24, dirX).normalize();
    if (spinAxis.lengthSq() < Number.EPSILON) {
      spinAxis.set(1, 0, 0);
    }
    const hopReach = burstSparks
      ? model.outerRadiusMm * 1.95
      : model.outerRadiusMm * 0.2;

    const brightR = Math.min(255, Math.round(colorR * 0.78 + 255 * 0.22));
    const brightG = Math.min(255, Math.round(colorG * 0.78 + 255 * 0.22));
    const brightB = Math.min(255, Math.round(colorB * 0.78 + 255 * 0.22));
    const gleamR = Math.min(255, Math.round(colorR * 0.35 + 255 * 0.65));
    const gleamG = Math.min(255, Math.round(colorG * 0.35 + 255 * 0.65));
    const gleamB = Math.min(255, Math.round(colorB * 0.35 + 255 * 0.65));
    const haloR = Math.min(255, Math.round(colorR * 0.62 + 255 * 0.38));
    const haloG = Math.min(255, Math.round(colorG * 0.62 + 255 * 0.38));
    const haloB = Math.min(255, Math.round(colorB * 0.62 + 255 * 0.38));

    this.exits.set(cellIndex, {
      startedAt: now,
      delayMs,
      durationMs: BEAD_EXIT_ANIMATION_MS,
      startPosition: this.instancePosition.clone(),
      startScale: this.instanceScale.clone(),
      hopX: dirX * hopReach,
      hopZ: dirZ * hopReach,
      liftMm: burstSparks
        ? Math.max(
            this.instanceScale.y * model.heightMm * 2.8,
            model.outerRadiusMm * 2.1,
          )
        : Math.max(
            this.instanceScale.y * model.heightMm * 1.1,
            model.outerRadiusMm * 0.55,
          ),
      spinAxis,
      maxSpinRad: burstSparks ? 2.55 : 0.35,
      sparkRadiusMm: model.outerRadiusMm * 2.65,
      sparkBaseSizeMm: Math.max(0.32, model.outerRadiusMm * 0.46),
      ringMaxRadiusMm: model.outerRadiusMm * 2.25,
      ringY: Math.max(0.08, model.heightMm * 0.25),
      burstSparks,
      sparkBrightColor: new Color().setStyle(`rgb(${brightR}, ${brightG}, ${brightB})`),
      sparkGleamColor: new Color().setStyle(`rgb(${gleamR}, ${gleamG}, ${gleamB})`),
      ringColor: new Color().setStyle(`rgb(${haloR}, ${haloG}, ${haloB})`),
    });
  }

  private writeColor(
    mesh: InstancedMesh,
    cellIndex: number,
    color: RgbColor | null,
  ): void {
    const [red, green, blue] = color ?? [0, 0, 0];
    this.instanceColor.setStyle(`rgb(${red}, ${green}, ${blue})`);
    mesh.setColorAt(cellIndex, this.instanceColor);
    mesh.instanceColor?.setUsage(DynamicDrawUsage);
  }

  private writeHiddenMatrix(
    mesh: InstancedMesh,
    cellIndex: number,
    slot: FastBeadPreviewSlot,
  ): void {
    this.instancePosition.set(slot.xMm, 0, slot.zMm);
    this.instanceScale.set(0, 0, 0);
    this.instanceMatrix.compose(
      this.instancePosition,
      IDENTITY_ROTATION,
      this.instanceScale,
    );
    mesh.setMatrixAt(cellIndex, this.instanceMatrix);
  }

  private writeFinalMatrix(
    mesh: InstancedMesh,
    cellIndex: number,
    slot: FastBeadPreviewSlot,
    heightMm: number,
  ): void {
    this.instancePosition.set(slot.xMm, heightMm / 2, slot.zMm);
    this.instanceScale.set(slot.scaleX, 1, slot.scaleZ);
    this.instanceMatrix.compose(
      this.instancePosition,
      IDENTITY_ROTATION,
      this.instanceScale,
    );
    mesh.setMatrixAt(cellIndex, this.instanceMatrix);
  }

  private writeAnimatedMatrix(
    mesh: InstancedMesh,
    cellIndex: number,
    animation: PlacementAnimation,
    elapsedMs: number,
  ): void {
    if (elapsedMs < animation.delayMs) {
      this.writeHiddenMatrix(mesh, cellIndex, animation.slot);
      return;
    }
    const pose = placementPose(elapsedMs - animation.delayMs, animation);
    this.instancePosition.set(
      animation.slot.xMm,
      pose.liftMm + animation.heightMm * pose.verticalScale / 2,
      animation.slot.zMm,
    );
    this.instanceScale.set(
      animation.slot.scaleX * pose.radialScale,
      pose.verticalScale,
      animation.slot.scaleZ * pose.radialScale,
    );
    this.instanceMatrix.compose(
      this.instancePosition,
      IDENTITY_ROTATION,
      this.instanceScale,
    );
    mesh.setMatrixAt(cellIndex, this.instanceMatrix);
  }

  private writeExitMatrix(
    mesh: InstancedMesh,
    cellIndex: number,
    exit: ExitAnimation,
    elapsedMs: number,
  ): void {
    if (elapsedMs <= exit.delayMs) {
      const preTremor =
        exit.delayMs > 0 && elapsedMs > exit.delayMs - 50
          ? 1 +
            0.075 *
              Math.sin(((elapsedMs - (exit.delayMs - 50)) / 50) * Math.PI)
          : 1;
      this.instancePosition.copy(exit.startPosition);
      this.instanceScale.set(
        exit.startScale.x * preTremor,
        exit.startScale.y,
        exit.startScale.z * preTremor,
      );
      this.instanceMatrix.compose(
        this.instancePosition,
        IDENTITY_ROTATION,
        this.instanceScale,
      );
      mesh.setMatrixAt(cellIndex, this.instanceMatrix);
      return;
    }

    const unit = clamp01((elapsedMs - exit.delayMs) / exit.durationMs);
    const oneMinusSq = 1 - unit * unit;
    const popFactor = oneMinusSq * oneMinusSq * (1 + 1.85 * unit);
    const hopProgress = unit * (1.85 - 0.85 * unit);
    const liftArc = 4 * unit * (1 - unit);
    const spinAngle = unit * (1.4 - 0.4 * unit) * exit.maxSpinRad;

    this.instancePosition.set(
      exit.startPosition.x + exit.hopX * hopProgress,
      exit.startPosition.y + exit.liftMm * liftArc,
      exit.startPosition.z + exit.hopZ * hopProgress,
    );
    this.instanceRotation.setFromAxisAngle(exit.spinAxis, spinAngle);
    this.instanceScale.set(
      exit.startScale.x * popFactor,
      exit.startScale.y * popFactor,
      exit.startScale.z * popFactor,
    );
    this.instanceMatrix.compose(
      this.instancePosition,
      this.instanceRotation,
      this.instanceScale,
    );
    mesh.setMatrixAt(cellIndex, this.instanceMatrix);
  }

  private clearSparks(): void {
    if (this.sparkMesh === null) return;
    this.sparkMesh.count = 0;
    this.sparkMesh.visible = false;
  }

  private clearRings(): void {
    if (this.ringMesh === null) return;
    this.ringMesh.count = 0;
    this.ringMesh.visible = false;
  }

  private syncSparks(now: number): void {
    const sparkMesh = this.sparkMesh;
    if (sparkMesh === null || this.reduceMotion || this.exits.size === 0) {
      this.clearSparks();
      return;
    }

    const sparksPerExit =
      this.exits.size > 12 ? SPARKS_PER_BATCH_EXIT : SPARKS_PER_EXIT;
    const angleStep = (Math.PI * 2) / sparksPerExit;
    let written = 0;
    for (const [cellIndex, exit] of this.exits) {
      if (!exit.burstSparks) continue;
      const localElapsed = now - exit.startedAt - exit.delayMs;
      const sparkDuration = exit.durationMs * 0.92;
      if (localElapsed <= 0 || localElapsed >= sparkDuration) {
        continue;
      }
      if (written + sparksPerExit > MAX_SPARK_INSTANCES) break;

      const sparkUnit = clamp01(localElapsed / sparkDuration);
      const radialEase = sparkUnit * (2 - sparkUnit);
      const radialOut = radialEase * exit.sparkRadiusMm;
      const arcLift = 4 * sparkUnit * (1 - sparkUnit) * exit.liftMm * 0.86;
      const sparkSize =
        exit.sparkBaseSizeMm *
        Math.sin(Math.PI * sparkUnit) *
        (1.15 - sparkUnit * 0.45);
      if (sparkSize <= 1e-4) continue;

      const baseAngle = cellIndex * GOLDEN_ANGLE_RAD;
      const driftX = exit.hopX * 0.24 * radialEase;
      const driftZ = exit.hopZ * 0.24 * radialEase;

      for (let i = 0; i < sparksPerExit; i += 1) {
        const angle = baseAngle + i * angleStep + (i % 2 === 0 ? 0.14 : -0.14);
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const radiusScale = i % 2 === 0 ? 1.05 : 0.74;
        this.instancePosition.set(
          exit.startPosition.x + driftX + cosA * radialOut * radiusScale,
          exit.startPosition.y + arcLift * (i % 2 === 0 ? 1.08 : 0.76),
          exit.startPosition.z + driftZ + sinA * radialOut * radiusScale,
        );
        this.sparkAxis.set(-sinA, 0.65, cosA).normalize();
        this.instanceRotation.setFromAxisAngle(
          this.sparkAxis,
          sparkUnit * 4.2 + i * 0.9,
        );
        const sizeScale = i % 4 === 0 ? 1.18 : i % 2 === 0 ? 1.0 : 0.78;
        this.instanceScale.set(
          sparkSize * sizeScale * (1.25 - sparkUnit * 0.3),
          sparkSize * sizeScale * 0.78,
          sparkSize * sizeScale,
        );
        this.instanceMatrix.compose(
          this.instancePosition,
          this.instanceRotation,
          this.instanceScale,
        );
        sparkMesh.setMatrixAt(written, this.instanceMatrix);
        sparkMesh.setColorAt(
          written,
          i % 4 === 0 ? exit.sparkGleamColor : exit.sparkBrightColor,
        );
        written += 1;
      }
    }

    sparkMesh.count = written;
    sparkMesh.visible = this.requestedVisible && written > 0;
    if (written > 0) {
      sparkMesh.instanceMatrix.needsUpdate = true;
      if (sparkMesh.instanceColor !== null) {
        if (!this.sparkColorDynamic) {
          sparkMesh.instanceColor.setUsage(DynamicDrawUsage);
          this.sparkColorDynamic = true;
        }
        sparkMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private syncRings(now: number): void {
    const ringMesh = this.ringMesh;
    const ringAlphaAttr = this.ringAlphaAttr;
    if (
      ringMesh === null ||
      ringAlphaAttr === null ||
      this.reduceMotion ||
      this.exits.size === 0
    ) {
      this.clearRings();
      return;
    }

    let written = 0;
    for (const exit of this.exits.values()) {
      if (!exit.burstSparks) continue;
      const localElapsed = now - exit.startedAt - exit.delayMs;
      if (localElapsed <= 0 || localElapsed >= RING_DURATION_MS) continue;
      if (written >= MAX_RING_INSTANCES) break;

      const ringUnit = clamp01(localElapsed / RING_DURATION_MS);
      const eased = ringUnit * (2 - ringUnit);
      const radiusMm = exit.ringMaxRadiusMm * (0.28 + 0.72 * eased);
      const remaining = 1 - ringUnit;
      const alpha = remaining * remaining;
      if (alpha <= 0.015) continue;

      this.instancePosition.set(
        exit.startPosition.x,
        exit.ringY + eased * 0.14,
        exit.startPosition.z,
      );
      this.instanceScale.set(radiusMm, 1, radiusMm);
      this.instanceMatrix.compose(
        this.instancePosition,
        IDENTITY_ROTATION,
        this.instanceScale,
      );
      ringMesh.setMatrixAt(written, this.instanceMatrix);
      ringMesh.setColorAt(written, exit.ringColor);
      this.ringAlphas[written] = alpha;
      written += 1;
    }

    ringMesh.count = written;
    ringMesh.visible = this.requestedVisible && written > 0;
    if (written > 0) {
      ringMesh.instanceMatrix.needsUpdate = true;
      ringAlphaAttr.needsUpdate = true;
      if (ringMesh.instanceColor !== null) {
        if (!this.ringColorDynamic) {
          ringMesh.instanceColor.setUsage(DynamicDrawUsage);
          this.ringColorDynamic = true;
        }
        ringMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private writeHiddenExitMatrix(
    mesh: InstancedMesh,
    cellIndex: number,
    exit: ExitAnimation,
  ): void {
    this.instancePosition.copy(exit.startPosition);
    this.instanceScale.set(0, 0, 0);
    this.instanceMatrix.compose(
      this.instancePosition,
      IDENTITY_ROTATION,
      this.instanceScale,
    );
    mesh.setMatrixAt(cellIndex, this.instanceMatrix);
  }

  private flushChanges(
    mesh: InstancedMesh,
    matrixDirty: boolean,
    colorDirty: boolean,
  ): void {
    if (matrixDirty) {
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (colorDirty && mesh.instanceColor !== null) {
      mesh.instanceColor.needsUpdate = true;
    }
  }

  private disposeMesh(): void {
    const mesh = this.mesh;
    const outgoingMesh = this.outgoingMesh;
    const sparkMesh = this.sparkMesh;
    const ringMesh = this.ringMesh;
    if (
      mesh === null &&
      outgoingMesh === null &&
      sparkMesh === null &&
      ringMesh === null
    ) {
      return;
    }
    const geometry = mesh?.geometry ?? outgoingMesh?.geometry;
    const material = mesh?.material ?? outgoingMesh?.material;
    if (mesh !== null) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    if (outgoingMesh !== null) {
      this.scene.remove(outgoingMesh);
      outgoingMesh.dispose();
    }
    if (sparkMesh !== null) {
      this.scene.remove(sparkMesh);
      sparkMesh.dispose();
      sparkMesh.geometry.dispose();
      sparkMesh.material.dispose();
    }
    if (ringMesh !== null) {
      this.scene.remove(ringMesh);
      ringMesh.dispose();
      ringMesh.geometry.dispose();
      ringMesh.material.dispose();
    }
    geometry?.dispose();
    material?.dispose();
    this.mesh = null;
    this.outgoingMesh = null;
    this.sparkMesh = null;
    this.ringMesh = null;
    this.ringAlphaAttr = null;
    this.profileKey = null;
  }
}

/**
 * Creates a persistent fast bead layer owned by the supplied Three.js scene.
 * 为给定 Three.js 场景创建一个常驻快速拼豆层。
 */
export function createBeadFastPreviewLayer(
  scene: Scene,
  reduceMotion: boolean,
): BeadFastPreviewLayer {
  return new ThreeBeadFastPreviewLayer(scene, reduceMotion);
}
