import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Workshop theme contract", () => {
  it("consumes public host tokens, supports light/dark schemes, and enforces DESIGN.md visual discipline", async () => {
    const css = await readFile("src/ui/theme.css", "utf8");

    expect(css).toMatch(
      /--bead-canvas:\s*var\(\s*--lumina-surface-canvas,\s*var\(\s*--lumina-surface,/,
    );
    expect(css).toMatch(
      /--bead-text:\s*var\(\s*--lumina-text-primary,\s*var\(\s*--lumina-text,/,
    );
    expect(css).toMatch(
      /--bead-border:\s*var\(\s*--lumina-border-subtle,\s*var\(\s*--lumina-border,/,
    );
    expect(css).toMatch(/body\s*{[\s\S]*var\(--bead-canvas\)/);
    expect(css).toMatch(/:root\[data-theme="dark"\]\s*{[\s\S]*color-scheme:\s*dark;/);
    expect(css).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);

    // DESIGN.md: neutral selection state for tools, blue reserved for active step & primary CTA
    expect(css).toMatch(
      /\.selection-control\[aria-pressed="true"\][\s\S]*?background:\s*var\(--bead-tool-active-bg\);/,
    );
    expect(css).toMatch(
      /\.workflow-step-tab\[aria-pressed="true"\]\s*{[^}]*background:\s*var\(--bead-accent\);/,
    );
    expect(css).not.toMatch(/translateY\(-1px\)/);

    // DESIGN.md: StatusBanner uses 3px left semantic accent bar, no full box border
    expect(css).toMatch(
      /\.status-banner\s*{[^}]*border:\s*0\s*;[^}]*border-left:\s*3px solid var\(--bead-accent\)\s*;/,
    );

    // DESIGN.md: Dialogs use 16px radius and solid surface without backdrop blur
    expect(css).toMatch(/\.dialog\s*{[^}]*border-radius:\s*16px\s*;/);
    expect(css).not.toMatch(/\.dialog-scrim\s*{[^}]*backdrop-filter/);

    expect(css).toMatch(
      /\.bead-canvas--matrix\s*{[^}]*border-radius:\s*0\s*;/,
    );
    expect(css).toMatch(
      /\.bead-three-preview\s*{[^}]*height:\s*100%\s*;/,
    );
    expect(css).toMatch(
      /\.bead-three-preview canvas\s*{[^}]*touch-action:\s*none\s*;/,
    );
    expect(css).toMatch(
      /\.bead-three-preview\[data-interaction-mode="edit"\]\s+canvas\s*{[^}]*cursor:\s*crosshair\s*;/,
    );
    expect(css).toMatch(
      /\.bead-three-preview\[data-interaction-mode="view"\]\s+canvas\s*{[^}]*cursor:\s*grab\s*;/,
    );
    expect(css).toMatch(
      /\.bead-three-preview__mode-switch\s*{[^}]*display:\s*flex\s*;[^}]*flex:\s*0\s+0\s+auto\s*;[^}]*border-right:\s*1px solid var\(--bead-border\)\s*;/,
    );
    expect(css).not.toMatch(
      /\.bead-three-preview__mode-switch\s*{[^}]*position:\s*absolute\s*;/,
    );
  });

  it("organizes the editor in a unified-topbar + mode-adaptive CSS grid without overlapping docks", async () => {
    const css = await readFile("src/ui/theme.css", "utf8");
    const floatingWorkspace = css.match(
      /\/\* bead editor floating workspace[\s\S]*?\/\* end bead editor floating workspace \*\//,
    )?.[0];

    expect(floatingWorkspace).toBeDefined();
    expect(floatingWorkspace).toMatch(
      /\.bead-editor-workspace\s*{[\s\S]*?container:\s*bead-editor-workspace\s*\/\s*inline-size;[\s\S]*?display:\s*grid;[\s\S]*?grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\);[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;[\s\S]*?isolation:\s*isolate;[\s\S]*?overflow:\s*hidden;/,
    );
    expect(floatingWorkspace).toMatch(
      /\.bead-editor-workspace__topbar\s*{[\s\S]*?grid-row:\s*1;[\s\S]*?grid-column:\s*1\s*\/\s*-1;/,
    );
    expect(floatingWorkspace).not.toMatch(/padding:\s*5px\s+6px\s+5px\s+48px/);
    expect(floatingWorkspace).not.toMatch(/right:\s*272px/);
    expect(floatingWorkspace).not.toMatch(/\.bead-editor-project-menu/);

    // Edit mode keeps canvas full width with bottom swatch dock; Fusion/Print move controls to right inspector column
    expect(floatingWorkspace).toMatch(
      /\.bead-editor-workspace\[data-mode="edit"\]\s+\.bead-editor-workspace__mode-dock\s*{[\s\S]*?grid-row:\s*2;[\s\S]*?grid-column:\s*1;[\s\S]*?justify-self:\s*center;[\s\S]*?align-self:\s*end;/,
    );
    expect(floatingWorkspace).toMatch(
      /\.bead-editor-workspace:not\(\[data-mode="edit"\]\)\s+\.bead-editor-workspace__mode-dock\s*{[\s\S]*?grid-row:\s*2;[\s\S]*?grid-column:\s*2;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior-y:\s*contain;/,
    );
    expect(floatingWorkspace).toMatch(
      /\.bead-editor-workspace__auxiliary\s*{[\s\S]*?grid-row:\s*2;[\s\S]*?grid-column:\s*1;[\s\S]*?justify-self:\s*end;[\s\S]*?align-self:\s*start;/,
    );
    expect(floatingWorkspace).toMatch(
      /\.bead-editor-workspace__auxiliary\[data-expanded="true"\]\s*{[\s\S]*?grid-row:\s*2;[\s\S]*?grid-column:\s*1\s*\/\s*-1;/,
    );

    expect(css).toMatch(
      /\.bead-palette-three-preview\s*{[^}]*position:\s*relative;[^}]*height:\s*48px;/,
    );
    expect(css).toMatch(
      /\.bead-palette-three-preview__canvas\s*{[^}]*position:\s*sticky;[^}]*left:\s*0;[^}]*height:\s*48px;[^}]*pointer-events:\s*none;/,
    );
    expect(css).toMatch(
      /\.bead-palette-three-preview__targets\s*{[^}]*gap:\s*4px;[^}]*padding-inline:\s*8px;/,
    );
    expect(css).not.toMatch(
      /\.palette-swatch\[aria-pressed="true"\]::(?:before|after)/,
    );
    expect(css).toMatch(
      /\.palette-swatch\[aria-pressed="true"\]\s*{[^}]*border-color:\s*transparent;[^}]*box-shadow:\s*none;/,
    );

    expect(floatingWorkspace).toMatch(
      /@container\s+bead-editor-workspace\s*\(max-width:\s*760px\)[\s\S]*?\.bead-editor-workspace:not\(\[data-mode="edit"\]\)\s+\.bead-editor-workspace__mode-dock\s*{[\s\S]*?grid-row:\s*3;[\s\S]*?grid-column:\s*1;[\s\S]*?\.bead-editor-output-button__compact\s*{[^}]*display:\s*inline;/,
    );
    expect(floatingWorkspace).not.toMatch(
      /@container\s+bead-editor-workspace\s*\(max-width:\s*760px\)[\s\S]*?\.bead-editor-workspace__(?:project|auxiliary)\s*{[^}]*display:\s*none;/,
    );
    expect(floatingWorkspace).toMatch(
      /@media\s*\(max-height:\s*680px\)[\s\S]*?\.bead-editor-tool-rail\s*{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
    );
    expect(floatingWorkspace).not.toMatch(/\.bead-editor-dock(?![-\w])/);
    expect(floatingWorkspace).not.toMatch(
      /backdrop-filter|:\s*(?:#fff(?:fff)?\b|white\s*[;,])/i,
    );
    expect(css).toMatch(/\.workbench-layout\s*{/);
    expect(css).toMatch(/\.panel--controls,/);
  });

  it("lets the editor fill the iframe without a nested document scrollbar", async () => {
    const css = await readFile("src/ui/theme.css", "utf8");

    expect(css).toMatch(
      /html,\s*body,\s*#root\s*{[^}]*height:\s*100%\s*;[^}]*}/,
    );
    expect(css).toMatch(
      /\.module-shell--editor\s*{[^}]*width:\s*100%\s*;[^}]*max-width:\s*none\s*;[^}]*height:\s*100%\s*;[^}]*padding:\s*0\s*;[^}]*overflow:\s*hidden\s*;/,
    );
    expect(css).toMatch(
      /\.workbench-stack--editor\s*{[^}]*height:\s*100%\s*;[^}]*min-height:\s*0\s*;/,
    );
    expect(css).toMatch(
      /\.workbench-stack--editor\s*>\s*\.status-banner\s*{[^}]*top:\s*62px\s*;[^}]*left:\s*50%\s*;[^}]*transform:\s*translateX\(-50%\)\s*;/,
    );
    expect(css).toMatch(
      /\.bead-editor-workspace\s*{[^}]*height:\s*100%\s*;[^}]*min-height:\s*0\s*;[^}]*border:\s*0\s*;[^}]*border-radius:\s*0\s*;/,
    );
    expect(css).toMatch(
      /\.bead-editor-workspace__canvas\s*>\s*\.canvas-stage\s*{[^}]*overflow:\s*hidden\s*;/,
    );
    expect(css).toMatch(
      /\.bead-three-preview-stack\s*{[^}]*position:\s*relative\s*;[^}]*height:\s*100%\s*;/,
    );
    expect(css).toMatch(
      /\.bead-three-preview\s*{[^}]*height:\s*100%\s*;[^}]*border:\s*0\s*;[^}]*border-radius:\s*0\s*;/,
    );
    expect(css).toMatch(
      /\.bead-canvas-viewport__content\s*>\s*\.bead-canvas,\s*\.bead-canvas-viewport__content\s*>\s*\.bead-fusion-preview\s*{[^}]*width:\s*100%\s*;[^}]*max-width:\s*none\s*;[^}]*height:\s*100%\s*;[^}]*max-height:\s*none\s*;/,
    );
    expect(css).toMatch(
      /\.bead-canvas-viewport__toolbar\s*{[^}]*border:\s*1px solid var\(--bead-border\)\s*;[^}]*border-radius:\s*999px\s*;[^}]*box-shadow:\s*var\(--bead-shadow\)\s*;/,
    );
    expect(css).toMatch(
      /\.bead-three-preview__toolbar\s*{[^}]*max-width:\s*calc\(100% - 24px\)\s*;[^}]*overflow-x:\s*auto\s*;/,
    );
    expect(css).toMatch(
      /\.bead-three-preview__rendering-status\s*{[^}]*pointer-events:\s*none\s*;/,
    );
  });
});
