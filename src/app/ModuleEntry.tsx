import {
  applyWorkshopUiState,
  connectWorkshop,
  type WorkshopClient,
  type WorkshopUiState,
} from "@lumina/workshop-sdk";
import { useEffect, useState } from "react";

import type { BeadImageCodec } from "../host/imageCodec";
import { normalizeLocale } from "../i18n/translations";
import {
  BEAD_MODULE_ID,
  BEAD_MODULE_VERSION,
} from "../domain/types";
import { StatusBanner } from "../ui/panelPrimitives";
import {
  BeadWorkshopModule,
  type BeadProcessingEngine,
} from "./BeadWorkshopModule";

type ConnectFunction = () => Promise<WorkshopClient>;

function sameWorkshopUiState(
  left: WorkshopUiState | null,
  right: WorkshopUiState,
): boolean {
  if (
    left === null ||
    left.locale !== right.locale ||
    left.theme !== right.theme
  ) {
    return false;
  }
  const leftTokens = Object.entries(left.tokens).sort(
    ([leftName], [rightName]) => leftName.localeCompare(rightName),
  );
  const rightTokens = Object.entries(right.tokens).sort(
    ([leftName], [rightName]) => leftName.localeCompare(rightName),
  );
  return (
    leftTokens.length === rightTokens.length &&
    leftTokens.every(
      ([name, value], index) =>
        rightTokens[index]?.[0] === name &&
        rightTokens[index]?.[1] === value,
    )
  );
}

interface ModuleEntryProps {
  connect?: ConnectFunction;
  createEngine?: () => BeadProcessingEngine;
  imageCodec?: BeadImageCodec;
  autosaveDelayMs?: number;
}

const connectToLumina: ConnectFunction = () =>
  connectWorkshop({
    moduleId: BEAD_MODULE_ID,
    moduleVersion: BEAD_MODULE_VERSION,
  });

export function ModuleEntry({
  connect = connectToLumina,
  createEngine,
  imageCodec,
  autosaveDelayMs,
}: ModuleEntryProps) {
  const [connection, setConnection] = useState<{
    client: WorkshopClient;
    locale: "zh-CN" | "en-US";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let connectedClient: WorkshopClient | null = null;
    let unsubscribeUiState: (() => void) | null = null;
    const cleanupConnection = () => {
      unsubscribeUiState?.();
      unsubscribeUiState = null;
      connectedClient?.close();
      connectedClient = null;
    };
    const start = async () => {
      try {
        const client = await connect();
        connectedClient = client;
        if (!active) {
          cleanupConnection();
          return;
        }
        let appliedUiState: WorkshopUiState | null = null;
        const applyUiState = (ui: WorkshopUiState) => {
          if (!active || sameWorkshopUiState(appliedUiState, ui)) return;
          appliedUiState = ui;
          applyWorkshopUiState(ui);
          setConnection({
            client,
            locale: normalizeLocale(ui.locale),
          });
        };
        unsubscribeUiState = client.ui.subscribeState(applyUiState);
        const ui = await client.ui.getState();
        if (!active) {
          cleanupConnection();
          return;
        }
        applyUiState(ui);
      } catch {
        cleanupConnection();
        if (active) {
          setError(
            "连接 Lumina 失败，请关闭窗口重新打开试试。 / Unable to connect to the Lumina Workshop host.",
          );
        }
      }
    };
    void start();
    return () => {
      active = false;
      cleanupConnection();
    };
  }, [connect]);

  if (error) {
    return (
      <main className="module-shell">
        <StatusBanner tone="error">{error}</StatusBanner>
      </main>
    );
  }

  if (!connection) {
    return (
      <main className="module-shell">
        <StatusBanner>拼豆工作台正在连接 Lumina…</StatusBanner>
      </main>
    );
  }

  return (
    <BeadWorkshopModule
      client={connection.client}
      locale={connection.locale}
      createEngine={createEngine}
      imageCodec={imageCodec}
      autosaveDelayMs={autosaveDelayMs}
    />
  );
}
