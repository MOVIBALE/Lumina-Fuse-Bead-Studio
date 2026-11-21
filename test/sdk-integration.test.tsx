import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { WorkshopUiState } from "@lumina/workshop-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BeadProcessingEngine } from "../src/app/BeadWorkshopModule";
import { ModuleEntry } from "../src/app/ModuleEntry";
import { createBeadProject } from "../src/domain/project";
import { renderBeadProject } from "../src/domain/renderer";
import { createSdkHarness } from "./helpers/sdkHarness";

describe("Workshop SDK entry", () => {
  beforeEach(() => {
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getContext",
    ).mockReturnValue(null);
  });

  it("gets UI state, restores latest, and reports ready after usable render", async () => {
    const project = createBeadProject({
      projectId: "sdk-entry",
      moduleVersion: "1.0.0",
      now: "2026-07-30T00:00:00.000Z",
      rows: 1,
      columns: 1,
      palette: [[32, 120, 220]],
      cells: [{ kind: "color", paletteIndex: 0 }],
    });
    const harness = createSdkHarness({
      latestProject: {
        projectId: project.projectId,
        schemaVersion: project.schemaVersion,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        project,
      },
      uiState: {
        locale: "zh-CN",
        theme: "dark",
        tokens: {
          "--lumina-surface": "#111827",
          "--lumina-text": "#edf2f7",
        },
      },
    });

    let nextId = 1;
    const engine: BeadProcessingEngine = {
      classify: () => {
        throw new Error("not used");
      },
      recognize: () => {
        throw new Error("not used");
      },
      render: (value, compression, pixelsPerCell) => ({
        id: nextId++,
        promise: Promise.resolve(
          renderBeadProject(value, {
            compression,
            pixelsPerCell,
          }),
        ),
      }),
      cancelBefore: () => undefined,
      cancel: () => undefined,
      dispose: () => undefined,
    };

    render(
      <ModuleEntry
        connect={harness.connect}
        createEngine={() => engine}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "拼豆编辑" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(harness.methods()).toEqual(
        expect.arrayContaining([
          "ui.getState",
          "project.latest",
          "lifecycle.ready",
        ]),
      );
    });
    expect(harness.indexOf("lifecycle.ready")).toBeGreaterThan(
      harness.indexOf("project.latest"),
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.lang).toBe("zh-CN");
    harness.close();
  });

  it("applies pushed UI state without remounting the active project", async () => {
    const project = createBeadProject({
      projectId: "live-ui-state",
      moduleVersion: "1.0.0",
      now: "2026-08-13T00:00:00.000Z",
      rows: 1,
      columns: 1,
      palette: [[32, 120, 220]],
      cells: [{ kind: "color", paletteIndex: 0 }],
    });
    const harness = createSdkHarness({
      latestProject: {
        projectId: project.projectId,
        schemaVersion: project.schemaVersion,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        project,
      },
      uiState: {
        locale: "zh-CN",
        theme: "dark",
        tokens: {
          "--lumina-surface": "#111827",
          "--lumina-text": "#edf2f7",
        },
      },
    });
    let nextId = 1;
    const engine: BeadProcessingEngine = {
      classify: () => {
        throw new Error("not used");
      },
      recognize: () => {
        throw new Error("not used");
      },
      render: (value, compression, pixelsPerCell) => ({
        id: nextId++,
        promise: Promise.resolve(
          renderBeadProject(value, {
            compression,
            pixelsPerCell,
          }),
        ),
      }),
      cancelBefore: () => undefined,
      cancel: () => undefined,
      dispose: () => undefined,
    };
    const view = render(
      <ModuleEntry
        connect={harness.connect}
        createEngine={() => engine}
      />,
    );

    const heading = await screen.findByRole("heading", {
      name: "拼豆编辑",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "熨烫效果" }),
    );
    fireEvent.change(
      screen.getByRole("slider", { name: "熨烫程度" }),
      { target: { value: "84" } },
    );
    expect(
      screen.getByRole("slider", { name: "熨烫程度" }),
    ).toHaveValue("84");

    await act(async () => {
      await harness.pushUiState({
        locale: "en-US",
        theme: "light",
        tokens: {
          "--lumina-surface": "#f8fafc",
          "--lumina-text": "#172033",
        },
      });
    });

    expect(
      screen.getByRole("heading", { name: "Edit pattern" }),
    ).toBe(heading);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.lang).toBe("en-US");
    expect(
      document.documentElement.style.getPropertyValue(
        "--lumina-surface",
      ),
    ).toBe("#f8fafc");
    expect(
      screen.getByRole("slider", { name: "Ironing melt" }),
    ).toHaveValue("84");
    expect(
      harness.methods().filter((method) => method === "project.latest"),
    ).toHaveLength(1);

    view.unmount();
    await act(async () => {
      await harness.pushUiState({
        locale: "zh-CN",
        theme: "dark",
        tokens: { "--lumina-surface": "#111827" },
      });
    });
    expect(document.documentElement.lang).toBe("en-US");
    harness.close();
  });

  it("does not let the initial UI response overwrite a newer pushed state", async () => {
    let resolveInitial!: (state: WorkshopUiState) => void;
    const initial = new Promise<WorkshopUiState>((resolve) => {
      resolveInitial = resolve;
    });
    const harness = createSdkHarness({
      uiStateResponse: initial,
    });

    render(<ModuleEntry connect={harness.connect} />);
    await waitFor(() => {
      expect(harness.methods()).toContain("ui.getState");
    });

    await act(async () => {
      await harness.pushUiState({
        locale: "en-US",
        theme: "light",
        tokens: { "--lumina-surface": "#f8fafc" },
      });
    });
    expect(document.documentElement.lang).toBe("en-US");
    expect(document.documentElement.dataset.theme).toBe("light");

    await act(async () => {
      resolveInitial({
        locale: "zh-CN",
        theme: "dark",
        tokens: { "--lumina-surface": "#111827" },
      });
      await initial;
    });

    expect(document.documentElement.lang).toBe("en-US");
    expect(document.documentElement.dataset.theme).toBe("light");
    harness.close();
  });

  it("applies a replayed initial UI state once and still accepts token changes", async () => {
    const project = createBeadProject({
      projectId: "replayed-ui-state",
      moduleVersion: "1.0.0",
      now: "2026-08-13T00:00:00.000Z",
      rows: 1,
      columns: 1,
      palette: [[32, 120, 220]],
      cells: [{ kind: "color", paletteIndex: 0 }],
    });
    const harness = createSdkHarness({
      latestProject: {
        projectId: project.projectId,
        schemaVersion: project.schemaVersion,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        project,
      },
    });
    const client = await harness.connect();
    await harness.pushUiState({
      locale: "en-US",
      theme: "light",
      tokens: {
        "--lumina-surface": "#f8fafc",
        "--lumina-text": "#172033",
      },
    });
    const setProperty = vi.spyOn(
      document.documentElement.style,
      "setProperty",
    );

    const view = render(
      <ModuleEntry connect={async () => client} />,
    );
    const heading = await screen.findByRole("heading", {
      name: "Edit pattern",
    });
    await waitFor(() => {
      expect(harness.methods()).toContain("project.latest");
    });

    expect(
      setProperty.mock.calls.filter(([name]) =>
        name.startsWith("--lumina-"),
      ),
    ).toHaveLength(2);
    expect(
      harness.methods().filter((method) => method === "project.latest"),
    ).toHaveLength(1);

    await act(async () => {
      await harness.pushUiState({
        locale: "en-US",
        theme: "light",
        tokens: {
          "--lumina-surface": "#eef2ff",
          "--lumina-text": "#172033",
        },
      });
    });
    expect(screen.getByRole("heading", { name: "Edit pattern" })).toBe(
      heading,
    );
    expect(
      document.documentElement.style.getPropertyValue(
        "--lumina-surface",
      ),
    ).toBe("#eef2ff");
    expect(
      setProperty.mock.calls.filter(([name]) =>
        name.startsWith("--lumina-"),
      ),
    ).toHaveLength(4);

    view.unmount();
    setProperty.mockRestore();
    harness.close();
  });

  it("closes a connected client once when UI state subscription fails", async () => {
    const harness = createSdkHarness();
    const client = await harness.connect();
    const close = vi.spyOn(client, "close");
    vi.spyOn(client.ui, "subscribeState").mockImplementation(() => {
      throw new Error("subscription failed");
    });

    const view = render(
      <ModuleEntry connect={async () => client} />,
    );

    expect(
      await screen.findByText(/Unable to connect to the Lumina Workshop host/),
    ).toBeInTheDocument();
    expect(close).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(close).toHaveBeenCalledTimes(1);
    harness.close();
  });

  it("closes a client that connects after the module unmounts", async () => {
    const harness = createSdkHarness();
    const client = await harness.connect();
    const close = vi.spyOn(client, "close");
    const getState = vi.spyOn(client.ui, "getState");
    const subscribeState = vi.fn(() => vi.fn());
    Object.assign(client.ui, { subscribeState });
    let resolveConnection!: (value: typeof client) => void;
    const connection = new Promise<typeof client>((resolve) => {
      resolveConnection = resolve;
    });

    const view = render(
      <ModuleEntry connect={() => connection} />,
    );
    view.unmount();

    await act(async () => {
      resolveConnection(client);
      await connection;
      await Promise.resolve();
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(subscribeState).not.toHaveBeenCalled();
    expect(getState).not.toHaveBeenCalled();
    harness.close();
  });
});
