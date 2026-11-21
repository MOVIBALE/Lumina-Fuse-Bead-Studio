import {
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { translate } from "../src/i18n/translations";
import CropModal from "../src/ui/CropModal";

const t = (key: string) => translate("zh-CN", key);

function renderCropModal(
  overrides: Partial<React.ComponentProps<typeof CropModal>> = {},
) {
  const onConfirm = vi.fn();
  render(
    <CropModal
      open
      imageSrc="blob:test-pattern"
      imageWidth={400}
      imageHeight={200}
      translate={t}
      onClose={vi.fn()}
      onUseOriginal={vi.fn()}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onConfirm };
}

function firePointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: MouseEventInit & {
    pointerId: number;
    isPrimary?: boolean;
  },
) {
  const event = (
    type === "pointerdown"
      ? createEvent.pointerDown
      : type === "pointermove"
        ? createEvent.pointerMove
        : createEvent.pointerUp
  )(target, init);
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    isPrimary: { value: init.isPrimary ?? true },
  });
  fireEvent(target, event);
}

describe("CropModal", () => {
  it("lets the user draw the retained region directly on the preview", () => {
    const { onConfirm } = renderCropModal();
    const preview = screen.getByRole("img", {
      name: "拖动框选要保留的图纸范围",
    });
    vi.spyOn(preview, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(preview, {
      pointerId: 1,
      clientX: 25,
      clientY: 20,
    });
    fireEvent.pointerMove(preview, {
      pointerId: 1,
      clientX: 175,
      clientY: 80,
    });
    fireEvent.pointerUp(preview, {
      pointerId: 1,
      clientX: 175,
      clientY: 80,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "完成裁剪" }),
    );

    expect(onConfirm).toHaveBeenCalledWith({
      x: 50,
      y: 40,
      width: 300,
      height: 120,
    });
  });

  it("restores the current crop when the dialog is reopened", () => {
    renderCropModal({
      initialCrop: {
        x: 12,
        y: 24,
        width: 320,
        height: 150,
      },
    });

    expect(screen.getByLabelText("左边距")).toHaveValue(12);
    expect(screen.getByLabelText("上边距")).toHaveValue(24);
    expect(screen.getByLabelText("宽度")).toHaveValue(320);
    expect(screen.getByLabelText("高度")).toHaveValue(150);
  });

  it("can include the source image's right and bottom edges", () => {
    const { onConfirm } = renderCropModal();
    const preview = screen.getByRole("img", {
      name: "拖动框选要保留的图纸范围",
    });
    vi.spyOn(preview, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(preview, {
      pointerId: 2,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(preview, {
      pointerId: 2,
      clientX: 200,
      clientY: 100,
    });
    fireEvent.pointerUp(preview, {
      pointerId: 2,
      clientX: 200,
      clientY: 100,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "完成裁剪" }),
    );

    expect(onConfirm).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      width: 400,
      height: 200,
    });
  });

  it("keeps the full image when dragging from the bottom-right edge backwards", () => {
    const { onConfirm } = renderCropModal();
    const preview = screen.getByRole("img", {
      name: "拖动框选要保留的图纸范围",
    });
    vi.spyOn(preview, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });

    firePointer(preview, "pointerdown", {
      pointerId: 3,
      button: 0,
      clientX: 200,
      clientY: 100,
    });
    firePointer(preview, "pointermove", {
      pointerId: 3,
      buttons: 1,
      clientX: 0,
      clientY: 0,
    });
    firePointer(preview, "pointerup", {
      pointerId: 3,
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "完成裁剪" }),
    );

    expect(onConfirm).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      width: 400,
      height: 200,
    });
  });

  it("ignores right-clicks and events from another pointer", () => {
    const { onConfirm } = renderCropModal();
    const preview = screen.getByRole("img", {
      name: "拖动框选要保留的图纸范围",
    });
    vi.spyOn(preview, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });

    firePointer(preview, "pointerdown", {
      pointerId: 7,
      button: 2,
      clientX: 10,
      clientY: 10,
    });
    firePointer(preview, "pointerdown", {
      pointerId: 8,
      button: 0,
      clientX: 25,
      clientY: 20,
    });
    firePointer(preview, "pointermove", {
      pointerId: 9,
      buttons: 1,
      clientX: 190,
      clientY: 90,
    });
    firePointer(preview, "pointerup", {
      pointerId: 9,
      button: 0,
      clientX: 190,
      clientY: 90,
    });
    firePointer(preview, "pointermove", {
      pointerId: 8,
      buttons: 1,
      clientX: 150,
      clientY: 70,
    });
    firePointer(preview, "pointerup", {
      pointerId: 8,
      button: 0,
      clientX: 150,
      clientY: 70,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "完成裁剪" }),
    );

    expect(onConfirm).toHaveBeenCalledWith({
      x: 50,
      y: 40,
      width: 250,
      height: 100,
    });
  });

  it("closes on Escape when idle and blocks Escape while busy", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <CropModal
        open
        imageSrc="blob:test-pattern"
        imageWidth={400}
        imageHeight={200}
        translate={t}
        onClose={onClose}
        onUseOriginal={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "裁剪画面" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(
      <CropModal
        open
        busy
        imageSrc="blob:test-pattern"
        imageWidth={400}
        imageHeight={200}
        translate={t}
        onClose={onClose}
        onUseOriginal={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
