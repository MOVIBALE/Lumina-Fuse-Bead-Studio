# Lumina Fuse Bead Studio（拼豆工作台）

[English](README.md) · [简体中文](README_CN.md) · [使用流程](#从拼豆图纸到-3d-打印) · [本地开发](#本地开发) · [权限说明](#权限说明) · [Lumina Studio](https://github.com/lumina-layer-studio/Lumina-Layers)

[Lumina Studio](https://github.com/lumina-layer-studio/Lumina-Layers) 的官方拼豆工作台创意工坊模块。

拼豆工作台可将拼豆图纸与清晰截图识别为可编辑的豆阵，实时预览熨烫压合效果，对照当前 Lumina 耗材档案或 LUT 预览打印成色，并将源色矢量 SVG 交回 Lumina Studio 进行平面全彩 FDM 打印。

## 支持的图纸类型

支持清晰、正视的 PNG、JPEG 和 WebP 图纸：

- **编号网格图纸：** 定位规则网格，避开格线与色号文字提取豆色。
- **像素块图纸：** 从整数像素块推断正方形豆格，区分透明背景与空白豆位。
- **圆豆俯视图：** 沿豆粒圆环取色，自动避开中心孔。

低置信度格子会汇总到待确认列表，方便逐格修补。识别边界见 [docs/recognition-contract.md](docs/recognition-contract.md)。

## 从拼豆图纸到 3D 打印

1. **导入图纸**并确认版式（编号网格、像素图或圆豆俯视图）。
2. **校准网格：** 裁剪范围，微调行列数、方向与空位样本。
3. **编辑豆阵：** 用画笔、橡皮、吸管或油漆桶修改豆格，处理待确认格子。
4. **调节熨烫压合度：** 拖动 `0`–`100` 滑块预览豆粒挤压与融合形态：

   | 压合度 | 预览效果 |
   | ---: | --- |
   | `0` | 保留圆豆轮廓、中心孔与豆间空隙 |
   | `50` | 标准压合，豆粒贴合并保留细小四角凹点 |
   | `80` | 深度压合，中心孔与缝隙明显收窄 |
   | `100` | 完全压紧闭合，中心孔与缝隙全部填平 |

5. **预览打印配色（可选）：** 对照当前 Lumina LUT 或耗材档案预览成色，同时保留图纸原色。
6. **交回 Lumina 打印：** 按默认 **2.6 mm** 豆距（`列数 × 2.6 mm` × `行数 × 2.6 mm`）将源色矢量 SVG（附 PNG 兼容图）送入 Lumina 转换器。

## 安装与本地开发

### 在 Lumina Studio 中安装

直接在 Lumina Studio **创意工坊**中安装或更新（发行包发布在 [GitHub Releases](https://github.com/MOVIBALE/Lumina-Fuse-Bead-Studio/releases)，并收录于 [`Lumina-Workshop-Registry`](https://github.com/lumina-layer-studio/Lumina-Workshop-Registry)）。

### 本地开发

需要 Node.js 22+ 与 `pnpm@10.33.2`：

```bash
pnpm install --frozen-lockfile
pnpm test:run
pnpm exec tsc --noEmit
node scripts/benchmark.mjs --check-regression
pnpm package
```

在 Lumina Studio 打开 **创意工坊 → 开发者** 即可加载 `artifacts/` 下生成的 `.lumina-workshop` 安装包。测试说明见 [docs/testing.md](docs/testing.md)。

## 权限说明

在 [`manifest.json`](manifest.json) 中声明以下四项权限（基于 [`@lumina/workshop-sdk`](https://github.com/lumina-layer-studio/Lumina-Workshop-SDK)）：

- `image.pick` —— 选择并读取拼豆图纸图片
- `project.storage` —— 保存与恢复本地工程（支持随宿主 `.lum` 保存实时快照，见 [docs/portable-projects.md](docs/portable-projects.md)）
- `color-library.read` —— 读取当前 LUT 或耗材色库用于配色预览
- `handoff.image` —— 将源色 SVG、兼容 PNG 与物理尺寸交给转换器

安全边界说明见 [docs/security.md](docs/security.md)。

## 许可证

采用 [MIT License](LICENSE)。安全问题反馈见 [SECURITY.md](SECURITY.md)。
