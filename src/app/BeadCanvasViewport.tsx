import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  interpolate,
  normalizeLocale,
  translate as translateMessage,
} from "../i18n/translations";

export interface BeadCanvasViewportProps {
  contentWidth: number;
  contentHeight: number;
  contentOriginOffset?: readonly [x: number, y: number];
  deferFit?: boolean;
  viewKey?: string;
  ariaLabel: string;
  children: ReactNode;
  translate?(key: string): string;
}

interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

interface PanGesture {
  pointerId: number | null;
  clientX: number;
  clientY: number;
  x: number;
  y: number;
}

interface CachedViewState {
  transform: ViewTransform;
  isFit: boolean;
}

interface ViewLayoutIdentity {
  viewKey: string;
  contentWidth: number;
  contentHeight: number;
  originX: number;
  originY: number;
}

type ScaleMode = "fit" | "manual" | "preserve";

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const BUTTON_SCALE_STEP = 0.25;
const WHEEL_SCALE_FACTOR = 1.1;
const INITIAL_TRANSFORM: ViewTransform = { scale: 1, x: 0, y: 0 };
const DEFAULT_VIEW_KEY = "default";
const MIN_RENDERABLE_SCALE = 0.000001;

function normalizeNumber(value: number): number {
  const rounded = Number(value.toFixed(6));
  return Math.abs(rounded) < 0.000001 ? 0 : rounded;
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, normalizeNumber(scale)));
}

function normalizeScale(scale: number, mode: ScaleMode): number {
  if (mode === "manual") return clampScale(scale);
  return Math.min(
    MAX_SCALE,
    Math.max(MIN_RENDERABLE_SCALE, scale),
  );
}

function defaultTranslate(key: string): string {
  const documentLanguage =
    typeof document === "undefined" ? "" : document.documentElement.lang;
  const browserLanguage =
    typeof navigator === "undefined" ? "en-US" : navigator.language;
  return translateMessage(
    normalizeLocale(documentLanguage || browserLanguage),
    key,
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function BeadCanvasViewport({
  contentWidth,
  contentHeight,
  contentOriginOffset,
  deferFit = false,
  viewKey = DEFAULT_VIEW_KEY,
  ariaLabel,
  children,
  translate = defaultTranslate,
}: BeadCanvasViewportProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ViewTransform>(INITIAL_TRANSFORM);
  const isFitRef = useRef(false);
  const deferFitRef = useRef(deferFit);
  const pendingFitRef = useRef(false);
  const viewCacheRef = useRef(new Map<string, CachedViewState>());
  const currentViewKeyRef = useRef(viewKey);
  const contentSizeRef = useRef({ width: contentWidth, height: contentHeight });
  const previousLayoutRef = useRef<ViewLayoutIdentity | null>(null);
  const panGestureRef = useRef<PanGesture | null>(null);
  const spacePressedRef = useRef(false);
  const [viewTransform, setViewTransform] =
    useState<ViewTransform>(INITIAL_TRANSFORM);
  const [isPanning, setIsPanning] = useState(false);
  const [isFit, setIsFit] = useState(false);
  const [isPanToolActive, setIsPanToolActive] = useState(false);

  contentSizeRef.current = { width: contentWidth, height: contentHeight };
  deferFitRef.current = deferFit;
  const originX = contentOriginOffset?.[0] ?? 0;
  const originY = contentOriginOffset?.[1] ?? 0;

  const commitTransform = useCallback((
    next: ViewTransform,
    nextIsFit: boolean,
    scaleMode: ScaleMode,
  ) => {
    const normalized = {
      scale: normalizeScale(next.scale, scaleMode),
      x: normalizeNumber(next.x),
      y: normalizeNumber(next.y),
    };
    transformRef.current = normalized;
    isFitRef.current = nextIsFit;
    viewCacheRef.current.set(currentViewKeyRef.current, {
      transform: normalized,
      isFit: nextIsFit,
    });
    setViewTransform(normalized);
    setIsFit(nextIsFit);
  }, []);

  const fitContent = useCallback(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    const bounds = surface.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    pendingFitRef.current = false;
    const safeContentWidth = Math.max(contentSizeRef.current.width, 1);
    const safeContentHeight = Math.max(contentSizeRef.current.height, 1);
    const scale = normalizeScale(
      Math.min(
        bounds.width / safeContentWidth,
        bounds.height / safeContentHeight,
      ),
      "fit",
    );
    commitTransform({
      scale,
      x: (bounds.width - safeContentWidth * scale) / 2,
      y: (bounds.height - safeContentHeight * scale) / 2,
    }, true, "fit");
  }, [commitTransform]);

  const resetToOneHundredPercent = useCallback(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    const bounds = surface.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    pendingFitRef.current = false;
    const safeContentWidth = Math.max(contentSizeRef.current.width, 1);
    const safeContentHeight = Math.max(contentSizeRef.current.height, 1);
    commitTransform({
      scale: 1,
      x: (bounds.width - safeContentWidth) / 2,
      y: (bounds.height - safeContentHeight) / 2,
    }, false, "manual");
  }, [commitTransform]);

  const zoomAt = useCallback(
    (requestedScale: number, pointX: number, pointY: number) => {
      const current = transformRef.current;
      if (current.scale < MIN_SCALE && requestedScale < current.scale) {
        return;
      }
      const scale = clampScale(requestedScale);
      if (scale === current.scale) return;
      pendingFitRef.current = false;
      const contentX = (pointX - current.x) / current.scale;
      const contentY = (pointY - current.y) / current.scale;
      commitTransform({
        scale,
        x: pointX - contentX * scale,
        y: pointY - contentY * scale,
      }, false, "manual");
    },
    [commitTransform],
  );

  const zoomFromCenter = useCallback(
    (requestedScale: number) => {
      const surface = surfaceRef.current;
      if (surface === null) return;
      const bounds = surface.getBoundingClientRect();
      zoomAt(requestedScale, bounds.width / 2, bounds.height / 2);
    },
    [zoomAt],
  );

  useLayoutEffect(() => {
    const previousLayout = previousLayoutRef.current;
    const viewChanged =
      previousLayout !== null && previousLayout.viewKey !== viewKey;
    const contentSizeChanged =
      previousLayout !== null &&
      (previousLayout.contentWidth !== contentWidth ||
        previousLayout.contentHeight !== contentHeight);

    currentViewKeyRef.current = viewKey;

    if (previousLayout === null || viewChanged) {
      pendingFitRef.current = false;
      const cached = viewCacheRef.current.get(viewKey);
      if (cached !== undefined && !cached.isFit) {
        commitTransform(cached.transform, false, "preserve");
      } else {
        fitContent();
      }
    } else if (contentSizeChanged) {
      if (isFitRef.current && !deferFit) {
        fitContent();
      } else {
        if (isFitRef.current && deferFit) {
          pendingFitRef.current = true;
        }
        const deltaOriginX = originX - previousLayout.originX;
        const deltaOriginY = originY - previousLayout.originY;
        if (deltaOriginX !== 0 || deltaOriginY !== 0) {
          const current = transformRef.current;
          commitTransform(
            {
              scale: current.scale,
              x: current.x - deltaOriginX * current.scale,
              y: current.y - deltaOriginY * current.scale,
            },
            isFitRef.current,
            "preserve",
          );
        }
      }
    } else if (!deferFit && pendingFitRef.current) {
      pendingFitRef.current = false;
      if (isFitRef.current) {
        fitContent();
      }
    }

    previousLayoutRef.current = {
      viewKey,
      contentWidth,
      contentHeight,
      originX,
      originY,
    };
  }, [
    commitTransform,
    contentHeight,
    contentWidth,
    deferFit,
    fitContent,
    originX,
    originY,
    viewKey,
  ]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return undefined;
    const onResize = () => {
      if (!isFitRef.current) return;
      if (deferFitRef.current) {
        pendingFitRef.current = true;
      } else {
        fitContent();
      }
    };
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(onResize);
      observer.observe(surface);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitContent]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.deltaY === 0) return;
      const bounds = surface.getBoundingClientRect();
      const factor =
        event.deltaY < 0 ? WHEEL_SCALE_FACTOR : 1 / WHEEL_SCALE_FACTOR;
      zoomAt(
        transformRef.current.scale * factor,
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
    };
    surface.addEventListener("wheel", handleWheel, { passive: false });
    return () => surface.removeEventListener("wheel", handleWheel);
  }, [zoomAt]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.code === "Space" || event.key === " ") &&
        !isEditableTarget(event.target)
      ) {
        spacePressedRef.current = true;
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space" || event.key === " ") {
        spacePressedRef.current = false;
      }
    };
    const handleBlur = () => {
      spacePressedRef.current = false;
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const panToolGesture =
      isPanToolActive &&
      (event.button === 0 || event.pointerType === "touch");
    const shouldPan =
      event.button === 1 ||
      (event.button === 0 && spacePressedRef.current) ||
      panToolGesture;
    if (!shouldPan) return;
    event.preventDefault();
    event.stopPropagation();
    const current = transformRef.current;
    panGestureRef.current = {
      pointerId: Number.isFinite(event.pointerId) ? event.pointerId : null,
      clientX: event.clientX,
      clientY: event.clientY,
      x: current.x,
      y: current.y,
    };
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    isFitRef.current = false;
    pendingFitRef.current = false;
    viewCacheRef.current.set(currentViewKeyRef.current, {
      transform: current,
      isFit: false,
    });
    setIsFit(false);
    setIsPanning(true);
  };

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const gesture = panGestureRef.current;
    if (
      gesture === null ||
      (gesture.pointerId !== null && gesture.pointerId !== event.pointerId)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    commitTransform({
      scale: transformRef.current.scale,
      x: gesture.x + event.clientX - gesture.clientX,
      y: gesture.y + event.clientY - gesture.clientY,
    }, false, "preserve");
  };

  const endPointerGesture = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const gesture = panGestureRef.current;
    if (
      gesture === null ||
      (gesture.pointerId !== null && gesture.pointerId !== event.pointerId)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (
      typeof event.currentTarget.hasPointerCapture === "function" &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panGestureRef.current = null;
    setIsPanning(false);
  };

  const percent = Math.round(viewTransform.scale * 100);
  const currentZoomLabel = interpolate(
    translate("workshop.bead.viewport.currentZoom"),
    { percent },
  );
  const buttonClassName = "button button--secondary button--small";

  return (
    <section
      role="region"
      aria-label={ariaLabel}
      className="bead-canvas-viewport"
      data-testid="bead-canvas-viewport"
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        ref={surfaceRef}
        className="bead-canvas-viewport__surface"
        data-testid="bead-canvas-viewport-surface"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
          cursor: isPanning ? "grabbing" : "default",
          touchAction: "none",
        }}
        onPointerDownCapture={handlePointerDown}
        onPointerMoveCapture={handlePointerMove}
        onPointerUpCapture={endPointerGesture}
        onPointerCancelCapture={endPointerGesture}
      >
        <div
          className="bead-canvas-viewport__content"
          data-testid="bead-canvas-viewport-content"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: contentWidth,
            height: contentHeight,
            transformOrigin: "0 0",
            transform: `translate3d(${viewTransform.x}px, ${viewTransform.y}px, 0) scale(${viewTransform.scale})`,
            willChange: "transform",
          }}
        >
          {children}
        </div>
      </div>
      <div
        role="toolbar"
        aria-label={translate("workshop.bead.viewport.toolbar")}
        className="bead-canvas-viewport__toolbar"
        style={{
          position: "absolute",
          bottom: 12,
          left: "50%",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: 8,
          border: "1px solid var(--bead-border)",
          borderRadius: 999,
          padding: "8px 12px",
          color: "var(--bead-text)",
          background: "var(--bead-surface-strong)",
          boxShadow: "var(--bead-shadow)",
          transform: "translateX(-50%)",
          whiteSpace: "nowrap",
        }}
      >
        <button
          type="button"
          className={buttonClassName}
          aria-label={translate("workshop.bead.viewport.zoomOut")}
          disabled={viewTransform.scale <= MIN_SCALE}
          onClick={() =>
            zoomFromCenter(viewTransform.scale - BUTTON_SCALE_STEP)
          }
        >
          −
        </button>
        <output
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={currentZoomLabel}
          style={{ minWidth: "4ch", textAlign: "center" }}
        >
          {percent}%
        </output>
        <button
          type="button"
          className={buttonClassName}
          aria-label={translate("workshop.bead.viewport.resetZoom")}
          onClick={resetToOneHundredPercent}
        >
          100%
        </button>
        <button
          type="button"
          className={buttonClassName}
          aria-label={translate("workshop.bead.viewport.zoomIn")}
          disabled={viewTransform.scale >= MAX_SCALE}
          onClick={() =>
            zoomFromCenter(viewTransform.scale + BUTTON_SCALE_STEP)
          }
        >
          +
        </button>
        <button
          type="button"
          className={buttonClassName}
          aria-label={translate("workshop.bead.viewport.fit")}
          aria-pressed={isFit}
          onClick={fitContent}
        >
          {translate("workshop.bead.viewport.fit")}
        </button>
        <button
          type="button"
          className={buttonClassName}
          aria-label={translate("workshop.bead.viewport.pan")}
          aria-pressed={isPanToolActive}
          onClick={() => setIsPanToolActive((active) => !active)}
        >
          {translate("workshop.bead.viewport.pan")}
        </button>
      </div>
    </section>
  );
}
