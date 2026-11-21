import { useId, useRef } from "react";
import { createPortal } from "react-dom";

import { interpolate } from "../i18n/translations";
import Button from "../ui/Button";
import { useModalFocus } from "./useModalFocus";

interface BeadHandoffSummaryDialogProps {
  open: boolean;
  busy: boolean;
  rows: number;
  columns: number;
  compression: number;
  irregularity: number;
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  libraryLabel: string | null;
  translate(key: string): string;
  onCancel(): void;
  onConfirm(): void;
}

export function BeadHandoffSummaryDialog({
  open,
  busy,
  rows,
  columns,
  compression,
  irregularity,
  widthMm,
  heightMm,
  thicknessMm,
  libraryLabel,
  translate: t,
  onCancel,
  onConfirm,
}: BeadHandoffSummaryDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = `bead-handoff-summary-title-${useId()}`;
  useModalFocus({ open, busy, dialogRef, onCancel });

  if (!open) return null;

  return createPortal(
    <div
      className="dialog-scrim"
      onClick={busy ? undefined : onCancel}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog__body">
          <div className="dialog__header-row">
            <h2 id={titleId}>
              {t("workshop.bead.handoffSummaryTitle")}
            </h2>
            <span className="meta-pill">
              {columns} × {rows}
            </span>
          </div>
          <p>{t("workshop.bead.handoffSummaryDescription")}</p>
          <div className="settings-well dialog__summary-well">
            <p className="dialog__summary-specs">
              {interpolate(t("workshop.bead.handoffSummary"), {
                rows,
                columns,
                width: widthMm,
                height: heightMm,
                thickness: thicknessMm,
                compression,
                irregularity,
              })}
            </p>
            <p className="dialog__summary-library">
              {libraryLabel
                ? interpolate(t("workshop.bead.handoffLibrary"), {
                    label: libraryLabel,
                  })
                : t("workshop.bead.handoffNoLibrary")}
            </p>
          </div>
        </div>
        <footer className="dialog__footer">
          <Button
            label={t("workshop.bead.handoffSummaryCancel")}
            variant="secondary"
            disabled={busy}
            onClick={onCancel}
          />
          <Button
            label={t("workshop.bead.handoffSummaryConfirm")}
            loading={busy}
            onClick={onConfirm}
          />
        </footer>
      </section>
    </div>,
    document.body,
  );
}
