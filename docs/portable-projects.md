# Portable current workspace snapshots

The unreleased `1.0.9-dev.0` module implements the optional Workshop project snapshot protocol from SDK PR #3. Its SDK dependency is pinned to the reviewed source commit, not a mutable branch. No package or registry release is published by this change.

On a host project save, the module captures its live upload, calibration or editor state, including source bytes, working raster, crop and calibration draft, editor history, selected cell and tool, and the active colour library. This works before the next autosave. The existing autosave and recipe handoff remain separate owners.

Restore prepares and validates a detached workspace using the bead domain validators and undo/redo reducer. Commit cancels obsolete processing requests, adopts the workspace in React, then acknowledges the host. Modules advertise `projectSnapshots: { protocol: 1, schemas: ["bead-workspace/v1"] }`; hosts without the optional protocol can still run the normal module.

Validation: 360 Vitest tests passed, including capture before autosave and prepare/commit/recapture through the real SDK MessagePort. TypeScript/Vite build and all 4 inline-worker/package-output checks passed. The local package is for review and is not a signed registry release.
