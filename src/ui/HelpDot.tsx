import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cx } from "./panelPrimitives";

interface HelpDotProps {
  title: string;
  description: string;
  ariaLabel?: string;
  className?: string;
  bubbleClassName?: string;
  keepInDom?: boolean;
}

interface FloatingCoords {
  top: number;
  left: number;
  placement: "top" | "bottom";
}

const VIEWPORT_MARGIN = 12;
const BUBBLE_GAP = 8;
const DEFAULT_WIDTH = 264;

export default function HelpDot({
  title,
  description,
  ariaLabel,
  className,
  bubbleClassName,
  keepInDom = false,
}: HelpDotProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [coords, setCoords] = useState<FloatingCoords>({
    top: 0,
    left: 0,
    placement: "bottom",
  });

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleHoverClose = useCallback(() => {
    if (pinned) return;
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 120);
  }, [clearCloseTimer, pinned]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const bubbleRect = bubbleRef.current?.getBoundingClientRect();
    const bubbleWidth = bubbleRect && bubbleRect.width > 0
      ? bubbleRect.width
      : DEFAULT_WIDTH;
    const bubbleHeight = bubbleRect && bubbleRect.height > 0
      ? bubbleRect.height
      : 84;
    const viewportWidth = window.innerWidth || 1024;
    const viewportHeight = window.innerHeight || 768;

    const fitsBelow =
      rect.bottom + BUBBLE_GAP + bubbleHeight <=
      viewportHeight - VIEWPORT_MARGIN;
    const placement: "top" | "bottom" =
      fitsBelow || rect.top < bubbleHeight + BUBBLE_GAP
        ? "bottom"
        : "top";
    const top =
      placement === "bottom"
        ? rect.bottom + BUBBLE_GAP
        : Math.max(VIEWPORT_MARGIN, rect.top - bubbleHeight - BUBBLE_GAP);
    const centeredLeft = rect.left + rect.width / 2 - bubbleWidth / 2;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(
        centeredLeft,
        viewportWidth - bubbleWidth - VIEWPORT_MARGIN,
      ),
    );
    setCoords({ top, left, placement });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const handleViewportChange = () => updatePosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setPinned(false);
        setOpen(false);
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        !triggerRef.current?.contains(target) &&
        !bubbleRef.current?.contains(target)
      ) {
        setPinned(false);
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [open]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  const bubbleNode =
    open || keepInDom ? (
      <div
        ref={bubbleRef}
        id={tooltipId}
        role="tooltip"
        hidden={!open}
        data-placement={coords.placement}
        className={cx("help-popover", bubbleClassName)}
        style={
          open
            ? { top: `${coords.top}px`, left: `${coords.left}px` }
            : undefined
        }
        onPointerEnter={clearCloseTimer}
        onPointerLeave={scheduleHoverClose}
      >
        {description}
      </div>
    ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cx("help-dot", className)}
        aria-label={ariaLabel ?? `${title} (?)`}
        aria-expanded={open}
        aria-controls={open || keepInDom ? tooltipId : undefined}
        data-help={description}
        onPointerEnter={() => {
          clearCloseTimer();
          setOpen(true);
        }}
        onPointerLeave={scheduleHoverClose}
        onFocus={() => {
          clearCloseTimer();
          setOpen(true);
        }}
        onBlur={() => {
          if (!pinned) setOpen(false);
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          clearCloseTimer();
          if (open && pinned) {
            setPinned(false);
            setOpen(false);
          } else {
            setPinned(true);
            setOpen(true);
          }
        }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.25v3.75" />
          <circle cx="8" cy="4.9" r="0.65" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {bubbleNode !== null
        ? typeof document !== "undefined"
          ? createPortal(bubbleNode, document.body)
          : bubbleNode
        : null}
    </>
  );
}
