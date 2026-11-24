# Lumina Fuse Bead Studio（拼豆工作台）

[English](README.md) · [简体中文](README_CN.md) · [使用流程](#从拼豆图纸到-3d-打印) · [本地开发与打包](#本地开发与打包) · [权限与工程格式](#权限与工程格式) · [Lumina Studio](https://github.com/lumina-layer-studio/Lumina-Layers)

[Lumina Studio](https://github.com/lumina-layer-studio/Lumina-Layers) 的官方拼豆工作台创意工坊模块（`lumina.bead-pattern`）。

拼豆工作台可以把常见的拼豆图纸与清晰截图识别为可编辑的拼豆矩阵，实时预览不同熨烫压合程度下豆粒挤压融合的几何外观，对照当前 Lumina 耗材档案或 LUT 预览打印配色，并将干净的源色矢量 SVG（附带 PNG 兼容图与 `2.6 mm` 默认豆距）交回 Lumina Studio 完成平面全彩 FDM 打印。

## 支持的图纸类型

支持清晰、正视的 PNG、JPEG 和 WebP 图纸，涵盖三种常见版式：

- **编号网格图纸：** 自动定位规则网格，避开格线与色号文字提取每格豆色。
- **像素块图纸：** 从整数像素块推断正方形豆格，并区分透明背景与空白豆位。
- **圆豆俯视图：** 沿豆粒圆环取色，自动避开中心孔。

置信度较低或边界模糊的格子会汇总到待确认列表，方便在编辑器里逐格核对修补。识别细节与输入要求见 [docs/recognition-contract.md](docs/recognition-contract.md)。

## 从拼豆图纸到 3D 打印

1. **导入图纸：** 选择拼豆图纸或截图，确认图纸类型（编号网格、像素图或圆豆俯视图）。
2. **校准网格：** 裁剪画面范围，按需微调行列数、方向与空位样本。
3. **编辑豆阵：** 使用画笔、橡皮、吸管或油漆桶修改豆格，快速处理待确认格子。
4. **调节熨烫压合度：** 拖动 `0`–`100` 压合滑块，实时查看豆粒之间的挤压与融合形态：

   | 压合数值 | 几何效果 |
   | ---: | --- |
   | `0` | 完整保留圆豆轮廓、中心孔与豆间空隙 |
   | `50` | 标准熨烫压合，相邻豆粒贴合并保留细小四角凹点 |
   | `80` | 深度压合，中心孔与缝隙明显收窄 |
   | `100` | 完全压紧闭合，中心孔与四豆交汇缝隙全部填平 |

5. **预览打印配色（可选）：** 将图纸颜色映射到当前激活的 Lumina LUT 或耗材档案预览成色，同时完整保留工程中的图纸原色。
6. **交回 Lumina 打印：** 确认成品物理尺寸后，将源色矢量 SVG、兼容 PNG 与 `bead-recipe/v1` 配方一并交给 Lumina 转换器分层建模。

默认相邻豆粒中心距为 **2.6 mm**（小豆规格），导出画布尺寸为 `列数 × 2.6 mm` 与 `行数 × 2.6 mm`。

## 在 Lumina Studio 中安装

直接在 Lumina Studio 的**创意工坊**中即可安装与更新「拼豆工作台」。正式版本以 `lumina.bead-pattern-<version>.lumina-workshop` 安装包及配套 `.sha256` 校验文件发布在 [GitHub Releases](https://github.com/MOVIBALE/Lumina-Fuse-Bead-Studio/releases)，并收录于 [`Lumina-Workshop-Registry`](https://github.com/lumina-layer-studio/Lumina-Workshop-Registry) 签名目录。

## 本地开发与打包

本模块基于 React、TypeScript、Vite 与 [`@lumina/workshop-sdk`](https://github.com/lumina-layer-studio/Lumina-Workshop-SDK) 构建。

需要 Node.js 22+ 与 `pnpm@10.33.2`：

```bash
pnpm install --frozen-lockfile
pnpm test:run
pnpm exec tsc --noEmit
node scripts/benchmark.mjs --check-regression
pnpm package
```

`pnpm package` 会运行测试、构建单文件界面产物，并在 `artifacts/` 下生成确定性的 `lumina.bead-pattern-<version>.lumina-workshop` 安装包与 `.sha256` 校验文件。在 Lumina Studio 中打开 **创意工坊 → 开发者**，即可加载该本地安装包验证完整交互。

测试说明见 [docs/testing.md](docs/testing.md)。

## 权限与工程格式

模块遵循 Lumina Workshop API `>=1.0.0 <2.0.0`，在 [`manifest.json`](manifest.json) 中申请四项权限：

- `image.pick` —— 从 Lumina 选择并读取拼豆图纸图片
- `project.storage` —— 在本地保存与恢复拼豆工程（`bead-project/v1`）
- `color-library.read` —— 读取当前 LUT 或耗材档案色库以供配色预览
- `handoff.image` —— 将确认后的源色 SVG、兼容 PNG 与物理尺寸交给转换器

模块同时支持可选的 `.lum` 工程实时快照协议（`projectSnapshots` / `bead-workspace/v1`），随宿主工程保存与恢复尚未落盘的编辑进度；详见 [docs/portable-projects.md](docs/portable-projects.md) 与 [docs/security.md](docs/security.md)。

## 许可证

采用 [MIT License](LICENSE) 开源许可。安全问题反馈请参考 [SECURITY.md](SECURITY.md)。
