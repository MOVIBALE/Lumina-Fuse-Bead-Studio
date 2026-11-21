import { describe, expect, it } from "vitest";

import { messages, translate } from "../src/i18n/translations";

describe("bead workbench user language", () => {
  it("uses natural Chinese craft terms instead of algorithmic or machine-translated jargon", () => {
    const expected = {
      "workshop.bead.calibrationTitle": "对齐网格",
      "workshop.bead.mode.numbered-grid": "色号格图",
      "workshop.bead.mode.hard-pixel": "像素格图",
      "workshop.bead.mode.ring-preview": "圆豆预览图",
      "workshop.bead.originX": "左上起点 X",
      "workshop.bead.originY": "左上起点 Y",
      "workshop.bead.pickEmpty": "点选空格",
      "workshop.bead.noEmpty": "全图无空格",
      "workshop.bead.emptySample": "已选背景空格",
      "workshop.bead.recognize": "提取拼豆图案",
      "workshop.bead.editorTitle": "拼豆编辑",
      "workshop.bead.threeEditMode": "画豆",
      "workshop.bead.threeViewMode": "转视角",
      "workshop.bead.workspace.mode.edit": "排豆修图",
      "workshop.bead.workspace.mode.fusion": "熨烫效果",
      "workshop.bead.workspace.mode.print": "耗材配色",
      "workshop.bead.workspace.auxiliary": "2D 对照",
      "workshop.bead.toolsTitle": "摆豆工具",
      "workshop.bead.tool.paint": "摆豆",
      "workshop.bead.tool.erase": "擦除",
      "workshop.bead.tool.eraseFill": "整片擦除",
      "workshop.bead.tool.eyedropper": "吸色",
      "workshop.bead.tool.fill": "整片填色",
      "workshop.bead.view.matrix": "豆格图",
      "workshop.bead.view.pressure": "熨烫图",
      "workshop.bead.view.original": "原图纸",
      "workshop.bead.preview.source": "图纸原色",
      "workshop.bead.preview.print": "耗材实色",
      "workshop.bead.createPrintMapping": "一键配对耗材",
      "workshop.bead.printLibraryLabel": "当前色库：{label}",
      "workshop.bead.printMappingTitle": "画面配色",
      "workshop.bead.compression": "熨烫程度",
      "workshop.bead.pressureLight": "0 · 留孔",
      "workshop.bead.pressureStandard": "50 · 适中",
      "workshop.bead.pressureTight": "100 · 满烫",
      "workshop.bead.irregularity": "手作起伏",
      "workshop.bead.beadPitch": "豆子规格",
      "workshop.bead.physicalSize": "成品长宽：约 {width} × {height} mm",
      "workshop.bead.handoff": "生成打印文件",
    } as const;

    for (const [key, value] of Object.entries(expected)) {
      expect(translate("zh-CN", key)).toBe(value);
    }

    const allChineseCopy = Object.values(messages["zh-CN"]).join("\n");
    for (const bannedJargon of [
      "矩阵",
      "置信度",
      "空位样本",
      "空位基准",
      "硬边像素图",
      "圆豆俯视图",
      "网格原点",
      "受挤压的豆形波峰",
      "不会被静默替换",
      "倾斜实拍",
    ]) {
      expect(allChineseCopy).not.toContain(bannedJargon);
    }
  });

  it("uses concise, idiomatic English craft labels", () => {
    const expected = {
      "workshop.bead.calibrationTitle": "Align grid",
      "workshop.bead.mode.numbered-grid": "Coded grid",
      "workshop.bead.mode.hard-pixel": "Pixel chart",
      "workshop.bead.mode.ring-preview": "Bead preview",
      "workshop.bead.recognize": "Extract pattern",
      "workshop.bead.editorTitle": "Edit pattern",
      "workshop.bead.threeEditMode": "Draw",
      "workshop.bead.threeViewMode": "Orbit",
      "workshop.bead.workspace.mode.edit": "Beads",
      "workshop.bead.workspace.mode.fusion": "Ironing",
      "workshop.bead.workspace.mode.print": "Filaments",
      "workshop.bead.workspace.auxiliary": "2D Reference",
      "workshop.bead.toolsTitle": "Bead tools",
      "workshop.bead.tool.paint": "Place",
      "workshop.bead.tool.erase": "Erase",
      "workshop.bead.tool.eraseFill": "Erase area",
      "workshop.bead.tool.eyedropper": "Eyedrop",
      "workshop.bead.tool.fill": "Fill area",
      "workshop.bead.view.matrix": "Bead grid",
      "workshop.bead.view.pressure": "Ironed 2D",
      "workshop.bead.preview.source": "Chart colors",
      "workshop.bead.preview.print": "Filament colors",
      "workshop.bead.createPrintMapping": "Auto-match filaments",
      "workshop.bead.printLibraryLabel": "Library: {label}",
      "workshop.bead.compression": "Ironing melt",
      "workshop.bead.pressureLight": "0 · Open",
      "workshop.bead.pressureStandard": "50 · Classic",
      "workshop.bead.pressureTight": "100 · Flat",
      "workshop.bead.irregularity": "Hand-ironed look",
      "workshop.bead.beadPitch": "Bead size",
      "workshop.bead.handoff": "Create print file",
    } as const;

    for (const [key, value] of Object.entries(expected)) {
      expect(translate("en-US", key)).toBe(value);
    }
  });
});
