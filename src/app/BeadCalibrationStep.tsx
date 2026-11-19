import { useEffect, useRef, useState } from "react";

import type {
  BeadEmptySelection,
  BeadGridGeometry,
  BeadInputMode,
  BeadOrientation,
  PatternClassification,
  Raster,
} from "../domain/types";
import { MAX_BEAD_GRID_SIZE } from "../domain/types";
import { interpolate } from "../i18n/translations";
import Button from "../ui/Button";
import Checkbox from "../ui/Checkbox";
import HelpDot from "../ui/HelpDot";
import {
  StatusBanner,
  cx,
  settingsWellClass,
  workstationFieldLabelClass,
  workstationInputClass,
} from "../ui/panelPrimitives";
import { BeadCanvasViewport } from "./BeadCanvasViewport";
import {
  BeadSourceCanvas,
  type CalibrationPickMode,
} from "./BeadSourceCanvas";

export interface BeadCalibrationDraft {
  inputMode: BeadInputMode;
  rows: number;
  columns: number;
  geometry: BeadGridGeometry;
  orientation: BeadOrientation;
  emptySelection: BeadEmptySelection | null;
}

interface BeadCalibrationStepProps {
  source: Raster;
  fileName: string;
  classification: PatternClassification | null;
  draft: BeadCalibrationDraft;
  busy: boolean;
  classificationBusy?: boolean;
  translate(key: string): string;
  onChange(next: BeadCalibrationDraft): void;
  onRecognize(): void;
  onOpenCrop(): void;
  onReselectPattern?(): void;
  onFitSquareGrid?(): void;
  onReturnToEditor?(): void;
  canCrop: boolean;
}

function clampDimension(value: number): number {
  return Math.min(
    MAX_BEAD_GRID_SIZE,
    Math.max(1, Math.round(Number.isFinite(value) ? value : 1)),
  );
}

function formatCellMetric(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return Number(value.toFixed(1)).toString();
}

function formatCoordinateValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}

function isValidGrid(draft: BeadCalibrationDraft): boolean {
  const { geometry } = draft;
  if (
    !Number.isFinite(geometry.originX) ||
    !Number.isFinite(geometry.originY) ||
    !Number.isFinite(geometry.cellWidth) ||
    !Number.isFinite(geometry.cellHeight) ||
    geometry.originX < 0 ||
    geometry.originY < 0 ||
    geometry.cellWidth <= 0 ||
    geometry.cellHeight <= 0
  ) {
    return false;
  }
  const squareError =
    Math.abs(geometry.cellWidth - geometry.cellHeight) /
    Math.max(geometry.cellWidth, geometry.cellHeight);
  return squareError <= 0.12;
}

function EmptySamplePreview({
  source,
  geometry,
  columns,
  cellIndex,
}: {
  source: Raster;
  geometry: BeadGridGeometry;
  columns: number;
  cellIndex: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const size = 44;
    canvas.width = size;
    canvas.height = size;
    context.clearRect(0, 0, size, size);

    const row = Math.floor(cellIndex / columns);
    const col = cellIndex % columns;
    const centerX = geometry.originX + (col + 0.5) * geometry.cellWidth;
    const centerY = geometry.originY + (row + 0.5) * geometry.cellHeight;
    const spanX = Math.max(3, geometry.cellWidth * 2.4);
    const spanY = Math.max(3, geometry.cellHeight * 2.4);
    const startX = centerX - spanX / 2;
    const startY = centerY - spanY / 2;

    const patch = context.createImageData(size, size);
    for (let py = 0; py < size; py += 1) {
      const sy = Math.min(
        source.height - 1,
        Math.max(0, Math.floor(startY + ((py + 0.5) / size) * spanY)),
      );
      for (let px = 0; px < size; px += 1) {
        const sx = Math.min(
          source.width - 1,
          Math.max(0, Math.floor(startX + ((px + 0.5) / size) * spanX)),
        );
        const srcOffset = (sy * source.width + sx) * 4;
        const dstOffset = (py * size + px) * 4;
        patch.data[dstOffset] = source.data[srcOffset] ?? 255;
        patch.data[dstOffset + 1] = source.data[srcOffset + 1] ?? 255;
        patch.data[dstOffset + 2] = source.data[srcOffset + 2] ?? 255;
        patch.data[dstOffset + 3] = source.data[srcOffset + 3] ?? 255;
      }
    }
    context.putImageData(patch, 0, 0);

    const boxW = (geometry.cellWidth / spanX) * size;
    const boxH = (geometry.cellHeight / spanY) * size;
    const boxX = (size - boxW) / 2;
    const boxY = (size - boxH) / 2;
    context.save();
    context.lineWidth = 2;
    context.strokeStyle = "rgba(255, 255, 255, 0.92)";
    context.strokeRect(boxX - 1, boxY - 1, boxW + 2, boxH + 2);
    context.lineWidth = 1.5;
    context.strokeStyle = "rgb(0, 113, 227)";
    context.strokeRect(boxX, boxY, boxW, boxH);
    context.restore();
  }, [cellIndex, columns, geometry, source]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="calibration-sample-card__thumb"
    />
  );
}

export function BeadCalibrationStep({
  source,
  fileName,
  classification,
  draft,
  busy,
  classificationBusy = false,
  translate: t,
  onChange,
  onRecognize,
  onOpenCrop,
  onReselectPattern,
  onFitSquareGrid,
  onReturnToEditor,
  canCrop,
}: BeadCalibrationStepProps) {
  const [pickMode, setPickMode] =
    useState<CalibrationPickMode>("none");
  const [showGrid, setShowGrid] = useState(true);
  const validGrid = isValidGrid(draft);
  const requiresCrop = classification?.requiresCrop === true;
  const canRecognize =
    validGrid &&
    draft.emptySelection !== null &&
    !busy &&
    !classificationBusy &&
    !requiresCrop;

  const updateDimensions = (rows: number, columns: number) => {
    const safeRows = clampDimension(rows);
    const safeColumns = clampDimension(columns);
    onChange({
      ...draft,
      rows: safeRows,
      columns: safeColumns,
      geometry: {
        ...draft.geometry,
        cellWidth:
          (source.width - draft.geometry.originX) / safeColumns,
        cellHeight:
          (source.height - draft.geometry.originY) / safeRows,
      },
      emptySelection: null,
    });
  };

  const updateOrigin = (axis: "x" | "y", value: number) => {
    const maximum =
      axis === "x" ? source.width - 1 : source.height - 1;
    const safeValue = Math.min(
      maximum,
      Math.max(0, Number.isFinite(value) ? value : 0),
    );
    const originX =
      axis === "x" ? safeValue : draft.geometry.originX;
    const originY =
      axis === "y" ? safeValue : draft.geometry.originY;
    onChange({
      ...draft,
      geometry: {
        originX,
        originY,
        cellWidth: (source.width - originX) / draft.columns,
        cellHeight: (source.height - originY) / draft.rows,
      },
      emptySelection: null,
    });
  };

  const handleCellPick = (cellIndex: number) => {
    if (pickMode === "empty") {
      onChange({
        ...draft,
        emptySelection: { kind: "sample", cellIndex },
      });
    }
    setPickMode("none");
  };

  const setRotation = (rotation: BeadOrientation["rotation"]) => {
    onChange({
      ...draft,
      orientation: { ...draft.orientation, rotation },
    });
  };

  const classificationBadge = classification
    ? interpolate(t("workshop.bead.classification"), {
        mode: t(`workshop.bead.mode.${classification.mode}`),
      })
    : classificationBusy
      ? t("workshop.bead.classifying")
      : null;

  const sampleIndex =
    draft.emptySelection?.kind === "sample"
      ? draft.emptySelection.cellIndex
      : null;
  const sampleRow =
    sampleIndex !== null ? Math.floor(sampleIndex / draft.columns) + 1 : 0;
  const sampleColumn =
    sampleIndex !== null ? (sampleIndex % draft.columns) + 1 : 0;

  return (
    <section className="calibration-workspace">
      <header className="calibration-workspace__topbar">
        <div className="calibration-workspace__identity">
          <h1>{t("workshop.bead.calibrationTitle")}</h1>
          <HelpDot
            title={t("workshop.bead.calibrationTitle")}
            description={t("workshop.bead.calibrationDescription")}
          />
          {fileName ? (
            <span
              className="calibration-workspace__filename"
              title={fileName}
            >
              {fileName}
            </span>
          ) : null}
          <span className="meta-pill">
            {source.width} × {source.height} px
          </span>
        </div>

        <div className="calibration-workspace__actions">
          {onReturnToEditor ? (
            <Button
              label={t("workshop.bead.returnToEditor")}
              variant="secondary"
              size="small"
              disabled={busy}
              onClick={onReturnToEditor}
            />
          ) : onReselectPattern ? (
            <Button
              label={t("workshop.bead.reselectPattern")}
              variant="secondary"
              size="small"
              disabled={busy || classificationBusy}
              onClick={onReselectPattern}
            />
          ) : null}
          {canCrop ? (
            <Button
              label={t("workshop.bead.cropPattern")}
              variant="secondary"
              size="small"
              disabled={busy || classificationBusy}
              onClick={onOpenCrop}
            />
          ) : null}
        </div>
      </header>

      <div className="calibration-workspace__body">
        <aside className="calibration-inspector">
          <div className="calibration-inspector__scroll">
            <div className={settingsWellClass}>
              <div className="settings-well__header-row">
                <h2 className="settings-well__heading">
                  {t("workshop.bead.calibrationSectionType")}
                </h2>
                {classificationBadge ? (
                  <span className="meta-pill">{classificationBadge}</span>
                ) : null}
              </div>
              {!classification && !classificationBusy ? (
                <StatusBanner>
                  {t("workshop.bead.classificationUnavailable")}
                </StatusBanner>
              ) : null}
              <select
                aria-label={t("workshop.bead.inputMode")}
                className={cx(
                  workstationInputClass,
                  "field-input--card",
                  "field-select",
                )}
                value={draft.inputMode}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    inputMode: event.target.value as BeadInputMode,
                    emptySelection: null,
                  })
                }
              >
                {(
                  [
                    "numbered-grid",
                    "hard-pixel",
                    "ring-preview",
                  ] as const
                ).map((mode) => (
                  <option key={mode} value={mode}>
                    {t(`workshop.bead.mode.${mode}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className={settingsWellClass}>
              <div className="settings-well__header-row">
                <h2 className="settings-well__heading">
                  {t("workshop.bead.calibrationSectionGrid")}
                </h2>
                <span className="meta-pill">
                  {interpolate(t("workshop.bead.calibrationCellSize"), {
                    width: formatCellMetric(draft.geometry.cellWidth),
                    height: formatCellMetric(draft.geometry.cellHeight),
                  })}
                </span>
              </div>

              <div className="field-grid">
                <label className="field">
                  <span className={workstationFieldLabelClass}>
                    {t("workshop.bead.rows")}
                  </span>
                  <input
                    aria-label={t("workshop.bead.rows")}
                    className={cx(workstationInputClass, "field-input--card")}
                    type="number"
                    min={1}
                    max={MAX_BEAD_GRID_SIZE}
                    value={draft.rows}
                    onChange={(event) =>
                      updateDimensions(
                        Number(event.target.value),
                        draft.columns,
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span className={workstationFieldLabelClass}>
                    {t("workshop.bead.columns")}
                  </span>
                  <input
                    aria-label={t("workshop.bead.columns")}
                    className={cx(workstationInputClass, "field-input--card")}
                    type="number"
                    min={1}
                    max={MAX_BEAD_GRID_SIZE}
                    value={draft.columns}
                    onChange={(event) =>
                      updateDimensions(
                        draft.rows,
                        Number(event.target.value),
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span className={workstationFieldLabelClass}>
                    {t("workshop.bead.originX")}
                  </span>
                  <input
                    aria-label={t("workshop.bead.originX")}
                    className={cx(workstationInputClass, "field-input--card")}
                    type="number"
                    min={0}
                    step="0.1"
                    value={formatCoordinateValue(draft.geometry.originX)}
                    onChange={(event) =>
                      updateOrigin("x", Number(event.target.value))
                    }
                  />
                </label>
                <label className="field">
                  <span className={workstationFieldLabelClass}>
                    {t("workshop.bead.originY")}
                  </span>
                  <input
                    aria-label={t("workshop.bead.originY")}
                    className={cx(workstationInputClass, "field-input--card")}
                    type="number"
                    min={0}
                    step="0.1"
                    value={formatCoordinateValue(draft.geometry.originY)}
                    onChange={(event) =>
                      updateOrigin("y", Number(event.target.value))
                    }
                  />
                </label>
              </div>

              <div className="calibration-rotation-track" role="group">
                {([0, 90, 180, 270] as const).map((rotation) => (
                  <button
                    key={rotation}
                    type="button"
                    aria-label={t(`workshop.bead.rotate${rotation}`)}
                    aria-pressed={draft.orientation.rotation === rotation}
                    className="segmented-control selection-control calibration-rotation-btn"
                    onClick={() => setRotation(rotation)}
                  >
                    {rotation}°
                  </button>
                ))}
              </div>

              <div className="control-grid">
                <button
                  type="button"
                  aria-pressed={draft.orientation.flipHorizontal}
                  className="segmented-control selection-control"
                  onClick={() =>
                    onChange({
                      ...draft,
                      orientation: {
                        ...draft.orientation,
                        flipHorizontal:
                          !draft.orientation.flipHorizontal,
                      },
                    })
                  }
                >
                  <svg
                    aria-hidden="true"
                    className="button-inline-icon"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M8 2.5v11M5.5 5 2.5 8l3 3M10.5 5l3 3-3 3" />
                  </svg>
                  <span>{t("workshop.bead.flipHorizontal")}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={draft.orientation.flipVertical}
                  className="segmented-control selection-control"
                  onClick={() =>
                    onChange({
                      ...draft,
                      orientation: {
                        ...draft.orientation,
                        flipVertical: !draft.orientation.flipVertical,
                      },
                    })
                  }
                >
                  <svg
                    aria-hidden="true"
                    className="button-inline-icon"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 8h11M5 5.5 8 2.5l3 3M5 10.5l3 3 3-3" />
                  </svg>
                  <span>{t("workshop.bead.flipVertical")}</span>
                </button>
              </div>
            </div>

            <div className={settingsWellClass}>
              <h2 className="settings-well__heading">
                {t("workshop.bead.calibrationSectionEmpty")}
              </h2>
              <div className="control-grid">
                <button
                  type="button"
                  aria-pressed={pickMode === "empty"}
                  className="segmented-control selection-control"
                  onClick={() =>
                    setPickMode((current) =>
                      current === "empty" ? "none" : "empty",
                    )
                  }
                >
                  <svg
                    aria-hidden="true"
                    className="button-inline-icon"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <circle cx="8" cy="8" r="4.5" />
                    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" />
                  </svg>
                  <span>{t("workshop.bead.pickEmpty")}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={draft.emptySelection?.kind === "none"}
                  className="segmented-control selection-control"
                  onClick={() => {
                    setPickMode("none");
                    onChange({
                      ...draft,
                      emptySelection: { kind: "none" },
                    });
                  }}
                >
                  <span>{t("workshop.bead.noEmpty")}</span>
                </button>
              </div>

              {pickMode === "empty" ? (
                <p className="sample-summary sample-summary--active">
                  {t("workshop.bead.calibrationPickPrompt")}
                </p>
              ) : null}

              {sampleIndex !== null ? (
                <div className="calibration-sample-card">
                  <EmptySamplePreview
                    source={source}
                    geometry={draft.geometry}
                    columns={draft.columns}
                    cellIndex={sampleIndex}
                  />
                  <div className="calibration-sample-card__meta">
                    <p className="calibration-sample-card__title">
                      {t("workshop.bead.emptySample")}
                    </p>
                    <span className="calibration-sample-card__coords">
                      {interpolate(t("workshop.bead.emptySampleCoords"), {
                        row: sampleRow,
                        column: sampleColumn,
                      })}
                    </span>
                  </div>
                </div>
              ) : null}

              {draft.emptySelection?.kind === "none" ? (
                <div className="calibration-sample-card calibration-sample-card--none">
                  <p className="calibration-sample-card__title">
                    {t("workshop.bead.noEmptySelected")}
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <footer className="calibration-inspector__footer">
            {requiresCrop ? (
              <StatusBanner tone="warning">
                {t("workshop.bead.cropRequired")}
              </StatusBanner>
            ) : null}
            {!validGrid ? (
              <>
                <StatusBanner tone="warning">
                  {t("workshop.bead.gridInvalid")}
                </StatusBanner>
                {onFitSquareGrid ? (
                  <Button
                    label={t("workshop.bead.fitSquareGrid")}
                    variant="secondary"
                    size="small"
                    disabled={busy || classificationBusy}
                    onClick={onFitSquareGrid}
                    className="button--full"
                  />
                ) : null}
              </>
            ) : null}
            {validGrid && draft.emptySelection === null ? (
              <StatusBanner tone="warning">
                {t("workshop.bead.emptyDecisionRequired")}
              </StatusBanner>
            ) : null}
            <Button
              label={t(
                busy
                  ? "workshop.bead.recognizing"
                  : "workshop.bead.recognize",
              )}
              loading={busy}
              disabled={!canRecognize}
              onClick={onRecognize}
              className="button--full"
            />
          </footer>
        </aside>

        <div className="calibration-stage canvas-stage--pegboard">
          <div className="calibration-stage__hud">
            <span className="calibration-hud-pill">
              {draft.columns} × {draft.rows}
            </span>
            {pickMode === "empty" ? (
              <span className="calibration-hud-pill calibration-hud-pill--active">
                {t("workshop.bead.calibrationPickPrompt")}
              </span>
            ) : null}
            <span className="calibration-hud-pill calibration-hud-pill--toggle">
              <Checkbox
                label={t("workshop.bead.showGrid")}
                checked={showGrid}
                onChange={setShowGrid}
              />
            </span>
          </div>

          <div className="calibration-stage__viewport">
            <BeadCanvasViewport
              viewKey={`calibration:${source.width}x${source.height}`}
              contentWidth={source.width}
              contentHeight={source.height}
              ariaLabel={t("workshop.bead.calibrationViewport")}
              translate={t}
            >
              <BeadSourceCanvas
                source={source}
                rows={draft.rows}
                columns={draft.columns}
                geometry={draft.geometry}
                ariaLabel={t("workshop.bead.calibrationCanvas")}
                pickMode={pickMode}
                showGrid={showGrid}
                emptyCellIndex={sampleIndex}
                onPickCell={handleCellPick}
              />
            </BeadCanvasViewport>
          </div>
        </div>
      </div>
    </section>
  );
}
