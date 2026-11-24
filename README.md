# Lumina Fuse Bead Studio

[English](README.md) · [简体中文](README_CN.md) · [Workflow](#from-pattern-chart-to-3d-print) · [Development](#local-development-and-packaging) · [Permissions](#permissions-and-project-format) · [Lumina Studio](https://github.com/lumina-layer-studio/Lumina-Layers)

The official Fuse Bead Studio (`lumina.bead-pattern`) Creative Workshop module for [Lumina Studio](https://github.com/lumina-layer-studio/Lumina-Layers).

Fuse Bead Studio turns bead pattern charts and clean screenshots into an editable bead matrix, previews how beads press and fuse together under different ironing levels, lets you check how your palette maps onto your active Lumina filaments or LUTs, and hands crisp vector SVG geometry back to Lumina Studio for flat full-color FDM printing.

## Supported pattern charts

Fuse Bead Studio recognizes clear, front-facing PNG, JPEG, and WebP pattern charts in three common styles:

- **Numbered grid charts:** detects regular grid lines and samples each cell's bead color around grid strokes and printed color codes.
- **Pixel-art bead charts:** infers square bead cells from crisp integer pixel blocks while distinguishing transparent background areas from empty pegboard slots.
- **Top-down bead previews:** samples colors along each circular bead ring while ignoring the center hole.

Ambiguous or low-confidence cells are highlighted in a review list so you can inspect and touch them up before exporting. Full recognition rules and input guidelines are in [docs/recognition-contract.md](docs/recognition-contract.md).

## From pattern chart to 3D print

1. **Import a chart** and confirm its pattern style (numbered grid, pixel chart, or bead ring view).
2. **Align the grid:** crop the pattern and calibrate row/column counts, orientation, and empty-slot samples if needed.
3. **Edit the bead matrix:** paint, erase, eyedrop, flood-fill, or step through flagged low-confidence cells.
4. **Preview iron fusion:** drag the press/fusion slider from `0` to `100` to choose how open or fused the bead rings look:

   | Fusion level | Geometry preview |
   | ---: | --- |
   | `0` | Distinct circular beads with full center holes and inter-bead gaps |
   | `50` | Standard iron press with soft square contact and small four-bead dimples |
   | `80` | Heavy fuse with narrow remaining pinholes and seams |
   | `100` | Fully fused surface with closed center holes and four-bead corners |

5. **Check printable colors (optional):** preview your pattern against your active Lumina LUT or filament profiles while keeping the chart's original source colors intact in your project.
6. **Send to Lumina Studio:** hand off the source-color vector SVG, compatible PNG fallback, physical size, and `bead-recipe/v1` metadata to Lumina's 3D print converter.

By default, bead center-to-center pitch is **2.6 mm** (mini bead scale), giving an output canvas of `columns × 2.6 mm` by `rows × 2.6 mm`.

## Install in Lumina Studio

Install and update **Fuse Bead Studio** directly from **Creative Workshop** inside Lumina Studio. Official releases are published as `lumina.bead-pattern-<version>.lumina-workshop` archives with `.sha256` checksums on [GitHub Releases](https://github.com/MOVIBALE/Lumina-Fuse-Bead-Studio/releases) and indexed in [`Lumina-Workshop-Registry`](https://github.com/lumina-layer-studio/Lumina-Workshop-Registry).

## Local development and packaging

Fuse Bead Studio is built with React, TypeScript, Vite, and [`@lumina/workshop-sdk`](https://github.com/lumina-layer-studio/Lumina-Workshop-SDK).

Requires Node.js 22+ and `pnpm@10.33.2`:

```bash
pnpm install --frozen-lockfile
pnpm test:run
pnpm exec tsc --noEmit
node scripts/benchmark.mjs --check-regression
pnpm package
```

`pnpm package` runs the test suite, builds the single-file UI bundle, and writes a deterministic `artifacts/lumina.bead-pattern-<version>.lumina-workshop` archive alongside its `.sha256` checksum. To test a local build end-to-end, install that `.lumina-workshop` file inside Lumina Studio under **Creative Workshop → Developer**.

See [docs/testing.md](docs/testing.md) for test coverage and host verification steps.

## Permissions and project format

The module targets Lumina Workshop API `>=1.0.0 <2.0.0` and declares four scoped capabilities in [`manifest.json`](manifest.json):

- `image.pick` — select and read a pattern chart image from Lumina Studio
- `project.storage` — save and reopen local bead projects (`bead-project/v1`)
- `color-library.read` — read the active LUT or filament library for color previews
- `handoff.image` — send the confirmed SVG, PNG fallback, and physical dimensions to the converter

It also supports optional live `.lum` workspace snapshots (`projectSnapshots` / `bead-workspace/v1`) so unsaved edits can be saved and restored alongside a host Lumina project; see [docs/portable-projects.md](docs/portable-projects.md) and [docs/security.md](docs/security.md).

## License

Licensed under the [MIT License](LICENSE). For security reports, follow [SECURITY.md](SECURITY.md).
