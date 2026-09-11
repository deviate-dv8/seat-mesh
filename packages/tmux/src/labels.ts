import type { LoadedProfile } from "@seat-mesh/core";
import { portsForSlot } from "@seat-mesh/core";
import { tmux } from "./tmux-run.js";
import { listWindowPaneIds } from "./window-panes.js";

function setPaneOptions(pane: string, pairs: Record<string, string>): void {
  for (const [k, v] of Object.entries(pairs)) {
    const r = tmux(["set-option", "-p", "-t", pane, `@${k}`, v]);
    if (!r.ok) throw new Error(`set @${k} on ${pane}: ${r.err || r.out}`);
  }
}

/** Paint @mesh_* on panes (seat-mesh session — not @zsign_* harness). */
export function labelMeshSession(loaded: LoadedProfile, session: string): void {
  const layout = loaded.profile.layout;
  if (!layout) return;

  const baseWin = layout.base.window;
  const workersWin = layout.workers.window;
  const minisWin = layout.minis.window;

  const basePanes = listWindowPaneIds(session, baseWin);
  if (basePanes[0]) {
    setPaneOptions(basePanes[0], {
      mesh_role: "manager",
      mesh_slot: "manager",
      mesh_ports: "manager",
      mesh_title: "master",
    });
  }
  if (basePanes[1]) {
    setPaneOptions(basePanes[1], {
      mesh_role: "secretary",
      mesh_slot: "secretary",
      mesh_ports: "secretary",
      mesh_title: "secretary",
    });
  }

  const workerPanes = listWindowPaneIds(session, workersWin);
  workerPanes.forEach((paneId, i) => {
    const slot = i + 1;
    if (slot > loaded.profile.session.workerCount) return;
    setPaneOptions(paneId, {
      mesh_role: "worker",
      mesh_slot: String(slot),
      mesh_ports: portsForSlot(loaded.profile.ports.worker, slot),
      mesh_title: `slot-${slot}`,
    });
  });

  const miniPanes = listWindowPaneIds(session, minisWin);
  miniPanes.forEach((paneId, i) => {
    const n = i + 1;
    const miniMax = layout?.minis.max ?? loaded.profile.session.miniMax;
    if (n > miniMax) return;
    setPaneOptions(paneId, {
      mesh_role: "manager-mini",
      mesh_slot: `mini-${n}`,
      mesh_ports: `mini-${n}`,
      mesh_mini: String(n),
      mesh_title: `mini-${n}`,
    });
  });
}
