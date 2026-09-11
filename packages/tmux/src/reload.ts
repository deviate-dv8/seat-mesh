import { spawnSync } from "node:child_process";
import path from "node:path";
import type { LoadedProfile } from "@seat-mesh/core";
import { applyMeshSessionBorders } from "./borders.js";
import { labelMeshSession } from "./labels.js";
import { ensureMeshInbox } from "./inbox-bridge.js";
import { assertRelayoutSafe } from "./layout-guard.js";
import { submitPaneOp } from "./pane-ops-client.js";
import { relayoutMeshSession } from "./session.js";
import { tmuxHasSession } from "./tmux-run.js";

export interface ReloadOptions {
  /** Re-run equal 3x2 / 4x2 grid (disruptive — kills extra panes). */
  layout?: boolean;
  /** With layout: skip minis lead swap (profile `layout.minis.leads` applied by default). */
  skipMinisLeads?: boolean;
  /** With layout: kill active panes when shrinking (default: refuse). */
  force?: boolean;
  /** Skip npm build (labels-only). */
  skipBuild?: boolean;
}

/**
 * Lazy reload: rebuild seat-mesh CLI, refresh labels/borders — no session kill.
 * `bin/seat-mesh` also auto-builds on stale dist; this is the explicit "keep hacking" path.
 */
export function reloadMesh(loaded: LoadedProfile, opts: ReloadOptions = {}): void {
  const session = loaded.profile.session.name;
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");
  if (!tmuxHasSession(session)) {
    throw new Error(`session '${session}' missing — ./sm.sh session up`);
  }

  if (!opts.skipBuild) {
    const seatMeshRoot = path.join(loaded.workspace, "seat-mesh");
    const r = spawnSync("npm", ["run", "build"], {
      cwd: seatMeshRoot,
      stdio: "inherit",
    });
    if (r.status !== 0) {
      throw new Error(`npm run build failed in ${seatMeshRoot} (exit ${r.status ?? 1})`);
    }
  }

  if (opts.layout) {
    submitPaneOp(
      loaded,
      "relayout",
      { skipMinisLeads: opts.skipMinisLeads, force: opts.force ?? false },
      "reload --layout",
      () => {
        assertRelayoutSafe(loaded, opts.force ?? false);
        relayoutMeshSession(loaded, {
          skipMinisLeads: opts.skipMinisLeads,
          force: opts.force,
        });
      },
    );
    return;
  }

  labelMeshSession(loaded, session);
  applyMeshSessionBorders(session, [
    layout.nvim.window,
    layout.base.window,
    layout.workers.window,
    layout.minis.window,
  ]);
  ensureMeshInbox(loaded, { quiet: true });
}
