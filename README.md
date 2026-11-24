# Lumina Fuse Bead Studio

[English](README.md) · [简体中文](README_CN.md) · [Workflow](#from-pattern-chart-to-3d-print) · [Development](#local-development) · [Permissions](#permissions) · [Lumina Studio](https://github.com/lumina-layer-studio/Lumina-Layers)

The official Fuse Bead Studio Creative Workshop module for [Lumina Studio](https://github.com/lumina-layer-studio/Lumina-Layers).

Fuse Bead Studio turns clear bead pattern charts and screenshots into an editable bead matrix, previews iron/press fusion, checks colors against your active Lumina filaments or LUTs, and sends clean vector SVG geometry back to Lumina Studio for flat full-color FDM printing.

## Supported pattern charts

Supports front-facing PNG, JPEG, and WebP charts in three styles:

- **Numbered grid charts:** detects regular grid cells and samples bead colors around grid lines and printed codes.
- **Pixel-art bead charts:** infers square cells from crisp pixel blocks while distinguishing transparent backgrounds from empty pegboard slots.
- **Top-down bead previews:** samples color along each bead ring while ignoring the center hole.

Low-confidence cells are collected for quick manual touch-up. Input guidelines are in [docs/recognition-contract.md](docs/recognition-contract.md).

## From pattern chart to 3D print

1. **Import a chart** and confirm its style (numbered grid, pixel chart, or bead ring view).
2. **Align the grid:** crop and adjust row/column counts, orientation, and empty-slot samples.
3. **Edit the matrix:** paint, erase, eyedrop, flood-fill, or step through flagged cells.
4. **Preview iron fusion:** drag the fusion slider from `0` to `100`:

   | Fusion | Preview |
   | ---: | --- |
   | `0` | Circular beads with open center holes and gaps |
   | `50` | Light press with soft square contact and small four-bead dimples |
   | `80` | Tight fuse with narrow pinholes and seams |
   | `100` | Fully fused surface with closed holes and seams |

5. **Preview printable colors (optional):** map colors against your active Lumina LUT or filament profiles while keeping the chart's source palette intact.
6. **Send to Lumina Studio:** hand off the source-color SVG (with PNG fallback) at **2.6 mm** default bead pitch (`columns × 2.6 mm` by `rows × 2.6 mm`).

## Install and local development

### Install in Lumina Studio

Install or update **Fuse Bead Studio** directly from **Creative Workshop** in Lumina Studio (releases are published on [GitHub Releases](https://github.com/MOVIBALE/Lumina-Fuse-Bead-Studio/releases) and signed in [`Lumina-Workshop-Registry`](https://github.com/lumina-layer-studio/Lumina-Workshop-Registry)).

### Local development

Requires Node.js 22+ and `pnpm@10.33.2`:

```bash
pnpm install --frozen-lockfile
pnpm test:run
pnpm exec tsc --noEmit
node scripts/benchmark.mjs --check-regression
pnpm package
```

Load the generated `.lumina-workshop` file from `artifacts/` in **Creative Workshop → Developer** inside Lumina Studio. Testing notes are in [docs/testing.md](docs/testing.md).

## Permissions

Declared in [`manifest.json`](manifest.json) (built with [`@lumina/workshop-sdk`](https://github.com/lumina-layer-studio/Lumina-Workshop-SDK)):

- `image.pick` — pick and read a pattern chart image
- `project.storage` — save and restore local bead projects (including `.lum` workspace snapshots; see [docs/portable-projects.md](docs/portable-projects.md))
- `color-library.read` — read the active LUT or filament library for color previews
- `handoff.image` — hand off the finished SVG, PNG fallback, and physical dimensions to Lumina's converter

Security details are in [docs/security.md](docs/security.md).

## License

Licensed under the [MIT License](LICENSE). Report security issues per [SECURITY.md](SECURITY.md).
