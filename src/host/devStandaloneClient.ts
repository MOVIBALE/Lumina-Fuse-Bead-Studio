import type {
  WorkshopClient,
  WorkshopColorLibrary,
  WorkshopPickedImage,
  WorkshopProjectRecord,
  WorkshopUiState,
} from "@lumina/workshop-sdk";

const DEV_COLOR_LIBRARY: WorkshopColorLibrary = {
  id: "dev:bambu-pla-basic",
  label: "Bambu PLA Basic (Dev Preview)",
  sourceKind: "material-archive",
  colors: [
    { id: "jade-white", label: "玉石白 Jade White", hex: "#F8FAFC", materialId: "pla-white" },
    { id: "scarlet-red", label: "绯红 Scarlet Red", hex: "#E11D48", materialId: "pla-red" },
    { id: "sunflower-yellow", label: "向日葵黄 Sunflower", hex: "#F59E0B", materialId: "pla-yellow" },
    { id: "cobalt-blue", label: "钴蓝 Cobalt Blue", hex: "#0284C7", materialId: "pla-blue" },
    { id: "bamboo-green", label: "拓竹绿 Bamboo Green", hex: "#10B981", materialId: "pla-green" },
    { id: "mandarin-orange", label: "柑橘橙 Mandarin", hex: "#F97316", materialId: "pla-orange" },
    { id: "violet-purple", label: "紫罗兰 Violet", hex: "#7C3AED", materialId: "pla-purple" },
    { id: "charcoal-black", label: "炭黑 Charcoal", hex: "#1E293B", materialId: "pla-black" },
  ],
};

function buildHostUiState(
  locale: "zh-CN" | "en-US",
  theme: "light" | "dark",
): WorkshopUiState {
  return {
    locale,
    theme,
    tokens: {
      "--lumina-surface": theme === "dark" ? "#0f172a" : "#ffffff",
      "--lumina-surface-muted": theme === "dark" ? "#1e293b" : "#f1f5f9",
      "--lumina-text": theme === "dark" ? "#f8fafc" : "#0f172a",
      "--lumina-text-muted": theme === "dark" ? "#94a3b8" : "#64748b",
      "--lumina-accent": theme === "dark" ? "#3b82f6" : "#0071e3",
      "--lumina-border":
        theme === "dark" ? "rgba(148, 163, 184, 0.22)" : "#e2e8f0",
    },
  };
}

async function generateSamplePickedChart(): Promise<WorkshopPickedImage> {
  const pattern = [
    "....................",
    "....rrrr....rrrr....",
    "..rrrrrrrrrrrrrrrr..",
    ".rrrrwwrrrrrrrrrrrr.",
    ".rrrrwwrrrrrrrrrrrr.",
    ".rrrrrrrrrrrrrrrrrr.",
    "..rrrrrrrrrrrrrrrr..",
    "...rrrrrrrrrrrrrr...",
    "....rrrrrrrrrrrr....",
    "......rrrrrrrr......",
    "........rrrr........",
    "....yyyy....yyyy....",
    "...yyyyyy..yyyyyy...",
    "....................",
  ];
  const cellPx = 22;
  const marginX = 18;
  const marginY = 26;
  const cols = pattern[0].length;
  const rows = pattern.length;
  const width = cols * cellPx + marginX * 2;
  const height = rows * cellPx + marginY * 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas unavailable");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const colorMap: Record<string, { fill: string; code: string; text: string }> = {
    ".": { fill: "#ffffff", code: "", text: "#94a3b8" },
    r: { fill: "#ef4444", code: "R2", text: "#ffffff" },
    w: { fill: "#f8fafc", code: "W1", text: "#334155" },
    y: { fill: "#f59e0b", code: "Y4", text: "#1e293b" },
  };

  ctx.font = "bold 9px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const ch = pattern[r][c] ?? ".";
      const entry = colorMap[ch] ?? colorMap["."];
      const x = marginX + c * cellPx;
      const y = marginY + r * cellPx;
      ctx.fillStyle = entry.fill;
      ctx.fillRect(x, y, cellPx, cellPx);
      if (entry.code) {
        ctx.fillStyle = entry.text;
        ctx.fillText(entry.code, x + cellPx / 2, y + cellPx / 2 + 0.5);
      }
    }
  }
  ctx.fillStyle = "#334155";
  for (let c = 0; c <= cols; c += 1) {
    ctx.fillRect(marginX + c * cellPx, marginY, 1, rows * cellPx + 1);
  }
  for (let r = 0; r <= rows; r += 1) {
    ctx.fillRect(marginX, marginY + r * cellPx, cols * cellPx + 1, 1);
  }
  const imageData = ctx.getImageData(0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("PNG encode failed"));
    }, "image/png");
  });
  const bytes = await blob.arrayBuffer();
  return {
    name: "B0F80921-numbered-chart.png",
    mimeType: "image/png",
    bytes,
    raster: {
      width,
      height,
      data: new Uint8ClampedArray(imageData.data),
    },
  };
}

async function pickLocalImageFile(): Promise<WorkshopPickedImage | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    let settled = false;
    const finish = (value: WorkshopPickedImage | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener("cancel", () => finish(null));
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      void (async () => {
        try {
          const bytes = await file.arrayBuffer();
          const bitmap = await createImageBitmap(file);
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas context unavailable");
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          finish({
            name: file.name,
            mimeType: file.type || "image/png",
            bytes,
            raster: {
              width: imageData.width,
              height: imageData.height,
              data: new Uint8ClampedArray(imageData.data),
            },
          });
        } catch (error) {
          if (!settled) {
            settled = true;
            input.remove();
            reject(error);
          }
        }
      })();
    });
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.append(input);
    input.click();
  });
}

export async function connectStandaloneDevHost(): Promise<WorkshopClient> {
  const params = new URLSearchParams(window.location.search);
  let locale: "zh-CN" | "en-US" =
    params.get("lang") === "en" ? "en-US" : "zh-CN";
  let theme: "light" | "dark" =
    params.get("theme") === "dark" ? "dark" : "light";
  let useSampleOnNextPick = params.get("sample") === "1";

  const listeners = new Set<(state: WorkshopUiState) => void>();
  const savedProjects = new Map<string, WorkshopProjectRecord<unknown>>();
  let latestId: string | null = null;

  const notifyUi = () => {
    const next = buildHostUiState(locale, theme);
    for (const listener of listeners) {
      listener(next);
    }
  };

  // Mount a compact dev-only bar at bottom-right so user/reviewer can toggle theme/lang/sample
  const existingBar = document.getElementById("bead-dev-preview-bar");
  existingBar?.remove();
  const devBar = document.createElement("div");
  devBar.id = "bead-dev-preview-bar";
  devBar.setAttribute("role", "region");
  devBar.setAttribute("aria-label", "Dev preview controls");
  Object.assign(devBar.style, {
    position: "fixed",
    right: "12px",
    bottom: "12px",
    zIndex: "9990",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "5px 8px",
    borderRadius: "999px",
    border: "1px solid var(--bead-border)",
    background: "var(--bead-surface-strong)",
    color: "var(--bead-text)",
    boxShadow: "var(--bead-shadow)",
    fontSize: "12px",
  });

  const makeDevBtn = (text: string, onClick: () => void) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = text;
    Object.assign(btn.style, {
      border: "1px solid var(--bead-border)",
      borderRadius: "999px",
      padding: "3px 9px",
      background: "var(--bead-tool-bg)",
      color: "var(--bead-text)",
      cursor: "pointer",
      fontSize: "12px",
      fontWeight: "600",
    });
    btn.addEventListener("click", onClick);
    return btn;
  };

  const themeBtn = makeDevBtn(theme === "dark" ? "☀ 浅色" : "☾ 深色", () => {
    theme = theme === "dark" ? "light" : "dark";
    themeBtn.textContent = theme === "dark" ? "☀ 浅色" : "☾ 深色";
    notifyUi();
  });

  const langBtn = makeDevBtn(locale === "zh-CN" ? "EN" : "中文", () => {
    locale = locale === "zh-CN" ? "en-US" : "zh-CN";
    langBtn.textContent = locale === "zh-CN" ? "EN" : "中文";
    notifyUi();
  });

  const sampleBtn = makeDevBtn("示例图纸", () => {
    useSampleOnNextPick = true;
    const buttons = Array.from(document.querySelectorAll("button"));
    const pickButton = buttons.find(
      (b) =>
        b.textContent?.includes("选择图纸") ||
        b.textContent?.includes("Choose image") ||
        b.textContent?.includes("换一张图") ||
        b.textContent?.includes("Change image"),
    );
    if (pickButton) {
      pickButton.click();
    } else {
      const newBtn = buttons.find(
        (b) =>
          b.textContent?.includes("新图案") ||
          b.textContent?.includes("New chart"),
      );
      newBtn?.click();
      window.setTimeout(() => {
        const retryPick = Array.from(document.querySelectorAll("button")).find(
          (b) =>
            b.textContent?.includes("选择图纸") ||
            b.textContent?.includes("Choose image"),
        );
        retryPick?.click();
      }, 60);
    }
  });

  devBar.append(sampleBtn, themeBtn, langBtn);
  document.body.append(devBar);

  return {
    sessionId: "dev-standalone-session",
    projectSnapshots: {
      register: () => () => undefined,
      changed: () => undefined,
    },
    image: {
      async pick() {
        if (useSampleOnNextPick) {
          useSampleOnNextPick = false;
          return generateSamplePickedChart();
        }
        return pickLocalImageFile();
      },
    },
    projects: {
      async save(record) {
        const cloned = structuredClone(
          record,
        ) as WorkshopProjectRecord<unknown>;
        savedProjects.set(record.projectId, cloned);
        latestId = record.projectId;
      },
      async load<T>(projectId: string) {
        const found = savedProjects.get(projectId);
        return found ? (structuredClone(found) as WorkshopProjectRecord<T>) : null;
      },
      async latest<T>() {
        if (!latestId) return null;
        const found = savedProjects.get(latestId);
        return found ? (structuredClone(found) as WorkshopProjectRecord<T>) : null;
      },
      async remove(projectId: string) {
        savedProjects.delete(projectId);
        if (latestId === projectId) latestId = null;
      },
    },
    colorLibrary: {
      async read() {
        return structuredClone(DEV_COLOR_LIBRARY);
      },
    },
    handoff: {
      async image() {
        return { status: "completed" };
      },
    },
    ui: {
      async getState() {
        return buildHostUiState(locale, theme);
      },
      subscribeState(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    status: {
      async progress() {
        return undefined;
      },
      async error() {
        return undefined;
      },
      async diagnostics() {
        return undefined;
      },
    },
    lifecycle: {
      async ready() {
        return undefined;
      },
    },
    close() {
      listeners.clear();
      devBar.remove();
    },
  };
}
