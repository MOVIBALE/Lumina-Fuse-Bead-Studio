import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

import { useModalFocus } from "../app/useModalFocus";
import type { CropRect } from "../domain/types";
import Button from "./Button";

interface ActiveCropDrag {
  pointerId: number;
  start: { x: number; y: number };
}

interface CropModalProps {
  open: boolean;
  imageSrc: string;
  imageWidth: number;
  imageHeight: number;
  initialCrop?: CropRect | null;
  busy?: boolean;
  translate(key: string): string;
  onClose(): void;
  onUseOriginal(): void;
  onConfirm(crop: CropRect): void;
}

export default function CropModal({
  open,
  imageSrc,
  imageWidth,
  imageHeight,
  initialCrop = null,
  busy = false,
  translate: t,
  onClose,
  onUseOriginal,
  onConfirm,
}: CropModalProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = `crop-title-${useId()}`;
  const [crop, setCrop] = useState<CropRect>({
    x: 0,
    y: 0,
    width: imageWidth,
    height: imageHeight,
  });
  const activeDragRef = useRef<ActiveCropDrag | null>(null);

  useModalFocus({ open, busy, dialogRef, onCancel: onClose });

  useEffect(() => {
    const candidate = initialCrop ?? {
      x: 0,
      y: 0,
      width: imageWidth,
      height: imageHeight,
    };
    const valid =
      candidate.x >= 0 &&
      candidate.y >= 0 &&
      candidate.width > 0 &&
      candidate.height > 0 &&
      candidate.x + candidate.width <= imageWidth &&
      candidate.y + candidate.height <= imageHeight;
    setCrop(
      valid
        ? { ...candidate }
        : { x: 0, y: 0, width: imageWidth, height: imageHeight },
    );
    activeDragRef.current = null;
  }, [
    imageHeight,
    imageWidth,
    initialCrop?.height,
    initialCrop?.width,
    initialCrop?.x,
    initialCrop?.y,
    open,
  ]);

  if (!open) return null;

  const set = (field: keyof CropRect, value: number) => {
    setCrop((current) => ({ ...current, [field]: Math.max(0, value) }));
  };
  const valid =
    crop.width > 0 &&
    crop.height > 0 &&
    crop.x + crop.width <= imageWidth &&
    crop.y + crop.height <= imageHeight;
  const pointFromPointer = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      x: Math.round(
        Math.min(
          Math.max(
            ((event.clientX - bounds.left) / bounds.width) * imageWidth,
            0,
          ),
          imageWidth,
        ),
      ),
      y: Math.round(
        Math.min(
          Math.max(
            ((event.clientY - bounds.top) / bounds.height) * imageHeight,
            0,
          ),
          imageHeight,
        ),
      ),
    };
  };
  const pointerIdFor = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => (
    Number.isFinite(event.pointerId) ? event.pointerId : 0
  );
  const updateDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const activeDrag = activeDragRef.current;
    if (
      !activeDrag ||
      pointerIdFor(event) !== activeDrag.pointerId
    ) {
      return false;
    }
    const point = pointFromPointer(event);
    if (!point) return false;
    const { start } = activeDrag;
    const x = Math.min(start.x, point.x);
    const y = Math.min(start.y, point.y);
    setCrop({
      x: Math.min(x, Math.max(0, imageWidth - 1)),
      y: Math.min(y, Math.max(0, imageHeight - 1)),
      width: Math.max(1, Math.abs(point.x - start.x)),
      height: Math.max(1, Math.abs(point.y - start.y)),
    });
    return true;
  };
  const selectionStyle = {
    left: `${(crop.x / imageWidth) * 100}%`,
    top: `${(crop.y / imageHeight) * 100}%`,
    width: `${(crop.width / imageWidth) * 100}%`,
    height: `${(crop.height / imageHeight) * 100}%`,
  };
  const previewWidthVh = Math.max(
    1,
    (imageWidth / imageHeight) * 46,
  );

  return createPortal(
    <div
      className="dialog-scrim"
      onPointerDown={busy ? undefined : onClose}
    >
      <section
        ref={dialogRef}
        className="dialog dialog--crop"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__body">
          <div className="dialog__header-row">
            <h2 id={titleId}>{t("crop.title")}</h2>
            <span className="meta-pill">
              {crop.width} × {crop.height} px
            </span>
          </div>
          <p>{t("crop.description")}</p>
          <div className="crop-stage">
            <div
              className="crop-canvas"
              role="img"
              aria-label={t("crop.previewAria")}
              style={{
                aspectRatio: `${imageWidth} / ${imageHeight}`,
                width: `min(100%, ${previewWidthVh}vh)`,
              }}
              onPointerDown={(event) => {
                if (
                  busy ||
                  activeDragRef.current ||
                  event.button !== 0 ||
                  event.isPrimary === false
                ) {
                  return;
                }
                const point = pointFromPointer(event);
                if (!point) return;
                activeDragRef.current = {
                  pointerId: pointerIdFor(event),
                  start: point,
                };
                event.currentTarget.setPointerCapture?.(event.pointerId);
                setCrop({
                  x: Math.min(point.x, Math.max(0, imageWidth - 1)),
                  y: Math.min(point.y, Math.max(0, imageHeight - 1)),
                  width: 1,
                  height: 1,
                });
              }}
              onPointerMove={updateDrag}
              onPointerUp={(event) => {
                if (!updateDrag(event)) return;
                activeDragRef.current = null;
                event.currentTarget.releasePointerCapture?.(event.pointerId);
              }}
              onPointerCancel={(event) => {
                if (
                  activeDragRef.current?.pointerId === pointerIdFor(event)
                ) {
                  activeDragRef.current = null;
                }
              }}
            >
              <img
                className="crop-preview"
                src={imageSrc}
                alt=""
                draggable={false}
              />
              <span
                className="crop-selection"
                style={selectionStyle}
                aria-hidden="true"
              >
                <span className="crop-selection__handle crop-selection__handle--nw" />
                <span className="crop-selection__handle crop-selection__handle--ne" />
                <span className="crop-selection__handle crop-selection__handle--sw" />
                <span className="crop-selection__handle crop-selection__handle--se" />
              </span>
            </div>
          </div>
          <div className="settings-well">
            <div className="field-grid field-grid--four">
              {(["x", "y", "width", "height"] as const).map((field) => (
                <label className="field" key={field}>
                  <span className="field-label">{t(`crop.${field}`)}</span>
                  <input
                    className="field-input field-input--card"
                    type="number"
                    min={0}
                    value={crop[field]}
                    onChange={(event) => set(field, Number(event.target.value))}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
        <footer className="dialog__footer">
          <Button
            label={t("crop.cancel")}
            variant="ghost"
            disabled={busy}
            onClick={onClose}
          />
          <Button
            label={t("crop.original")}
            variant="secondary"
            disabled={busy}
            onClick={onUseOriginal}
          />
          <Button
            label={t("crop.confirm")}
            loading={busy}
            disabled={!valid}
            onClick={() => onConfirm(crop)}
          />
        </footer>
      </section>
    </div>,
    document.body,
  );
}
