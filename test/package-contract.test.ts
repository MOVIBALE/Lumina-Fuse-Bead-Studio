// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { BEAD_MODULE_VERSION } from "../src/domain/types";

describe("module package contract", () => {
  it("uses the stable identity and only public Workshop permissions", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
    );
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );

    expect(manifest.version).toBe(packageJson.version);
    expect(manifest.version).toBe(BEAD_MODULE_VERSION);
    expect(BEAD_MODULE_VERSION).toBe("1.0.9-dev.0");

    expect(manifest).toEqual({
      manifestVersion: 1,
      id: "lumina.bead-pattern",
      version: BEAD_MODULE_VERSION,
      name: { "zh-CN": "拼豆工作台", "en-US": "Fuse Bead Studio" },
      description: {
        "zh-CN": "识别、校正并模拟熨烫融合后的拼豆图纸",
        "en-US": "Recognize, correct, and render iron-fused bead patterns",
      },
      publisher: "Lumina Studio",
      workshopApi: { min: "1.0.0", maxExclusive: "2.0.0" },
      luminaVersion: { min: "2.0.0" },
      entrypoints: { ui: "ui/index.html" },
      projectSnapshots: { protocol: 1, schemas: ["bead-workspace/v1"] },
      permissions: [
        { name: "image.pick", reason: "选择并读取拼豆图纸或截图" },
        { name: "project.storage", reason: "保存可继续编辑的拼豆工程" },
        { name: "color-library.read", reason: "预览当前 LUT 或耗材档案色库" },
        { name: "handoff.image", reason: "将确认后的源色 SVG 与兼容 PNG 交给 Lumina 转换" },
      ],
    });
  });
});
