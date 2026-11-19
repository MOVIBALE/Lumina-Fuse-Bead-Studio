import { memo, useEffect, useLayoutEffect, useRef } from "react";

import type { RgbColor } from "../domain/types";
import { BeadPaletteThreePreview } from "./BeadPaletteThreePreview";

/**
 * 豆子色板横向导航所需的受控属性。
 * Controlled properties for horizontal bead-palette navigation.
 */
export interface BeadPaletteStripProps {
  colors: RgbColor[];
  activeIndex: number;
  label: string;
  colorLabel(index: number): string;
  previousLabel: string;
  nextLabel: string;
  addLabel: string;
  onSelect(index: number): void;
  onAdd(color: RgbColor): void;
}

function fromHex(value: string): RgbColor | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return null;
  const number = Number.parseInt(match[1], 16);
  return [
    (number >> 16) & 255,
    (number >> 8) & 255,
    number & 255,
  ];
}

function toHex(color: RgbColor): string {
  return `#${color
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function setClampedScrollLeft(scroller: HTMLDivElement, next: number): void {
  const maximum = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  scroller.scrollLeft = Math.min(maximum, Math.max(0, next));
}

/**
 * 横向浏览豆子色样，并将普通滚轮转换成水平导航。
 * Browses bead swatches horizontally and maps a regular wheel to that axis.
 */
export const BeadPaletteStrip = memo(function BeadPaletteStrip({
  colors,
  activeIndex,
  label,
  colorLabel,
  previousLabel,
  nextLabel,
  addLabel,
  onSelect,
  onAdd,
}: BeadPaletteStripProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;
  const activeColor = colors[activeIndex] ?? colors[0] ?? [0, 0, 0];
  const activeColorHex = toHex(activeColor);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (scroller.scrollWidth <= scroller.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
      if (delta === 0) return;
      event.preventDefault();
      setClampedScrollLeft(scroller, scroller.scrollLeft + delta);
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const input = colorInputRef.current;
    if (input === null) return undefined;
    const commitColor = () => {
      const color = fromHex(input.value);
      if (color !== null) onAddRef.current(color);
    };
    input.addEventListener("change", commitColor);
    return () => input.removeEventListener("change", commitColor);
  }, []);

  useEffect(() => {
    const input = colorInputRef.current;
    if (input !== null) input.value = activeColorHex;
  }, [activeColorHex]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const active = scroller?.querySelector<HTMLElement>(
      `[data-palette-index="${activeIndex}"]`,
    );
    if (scroller === null || active === null || active === undefined) return;
    const scrollerBounds = scroller.getBoundingClientRect();
    const activeBounds = active.getBoundingClientRect();
    const centered = scroller.scrollLeft + activeBounds.left -
      scrollerBounds.left + activeBounds.width / 2 -
      scrollerBounds.width / 2;
    setClampedScrollLeft(scroller, centered);
  }, [activeIndex, colors.length]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return undefined;
    const ownerWindow = scroller.ownerDocument.defaultView;
    const clampCurrentPosition = () => {
      setClampedScrollLeft(scroller, scroller.scrollLeft);
    };
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(clampCurrentPosition);
      observer.observe(scroller);
      return () => observer.disconnect();
    }
    ownerWindow?.addEventListener("resize", clampCurrentPosition);
    return () => ownerWindow?.removeEventListener("resize", clampCurrentPosition);
  }, []);

  const scrollByPage = (direction: -1 | 1) => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    setClampedScrollLeft(
      scroller,
      scroller.scrollLeft +
        direction * Math.max(160, scroller.clientWidth * 0.8),
    );
  };

  return (
    <div className="bead-editor-palette-strip" aria-label={label}>
      <span className="field-label">{label}</span>
      <div className="bead-editor-palette-strip__body">
        <button
          type="button"
          className="bead-editor-palette-nav"
          aria-label={previousLabel}
          onClick={() => scrollByPage(-1)}
        >
          ‹
        </button>
        <div
          ref={scrollerRef}
          className="palette-row"
          data-testid="bead-palette-scroll"
        >
          <BeadPaletteThreePreview
            colors={colors}
            activeIndex={activeIndex}
            colorLabel={colorLabel}
            onSelect={onSelect}
            viewportRef={scrollerRef}
          />
        </div>
        <button
          type="button"
          className="bead-editor-palette-nav"
          aria-label={nextLabel}
          onClick={() => scrollByPage(1)}
        >
          ›
        </button>
        <label className="bead-editor-palette-add" title={addLabel}>
          <span aria-hidden>+</span>
          <input
            ref={colorInputRef}
            type="color"
            aria-label={addLabel}
            defaultValue={activeColorHex}
          />
        </label>
      </div>
    </div>
  );
});
