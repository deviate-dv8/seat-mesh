import { spawnSync } from "node:child_process";
import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import {
  capturePaneSnapshot,
  listMeshMinis,
  listMeshWorkers,
  meshManagerPane,
} from "@seat-mesh/tmux";
import type { JsonlStore } from "./jsonl-store.js";

function tmuxSet(paneId: string, key: string, value: string): void {
  spawnSync("tmux", ["set-option", "-p", "-t", paneId, key, value], { encoding: "utf8" });
}

function phaseLabel(phase: string, busyLabel?: string, limitKind?: string): string {
  if (phase === "busy") return busyLabel ?? "BUSY";
  if (phase === "limit") return limitKind ?? "LIMIT";
  if (phase === "typing") return "typing";
  if (phase === "afk") return "AFK";
  if (phase === "plain_shell") return "empty";
  return "idle";
}

/** Paint @mesh_status (+ optional @mesh_patience) on live panes. */
export function paintMeshBorders(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  store: JsonlStore,
  session: string,
  baseWindow: string,
  workersWindow: string,
  minisWindow: string,
  skipPaneIds: Set<string> = new Set(),
): void {
  const activeCb = store.readCheckbacks().filter((r) => r.status === "active").length;
  const unresolved = store.readInbox().filter((r) => !r.resolved).length;
  const unsent = store.readInbox().filter((r) => !r.sent && !r.resolved).length;

  const paintOne = (paneId: string, defaultPorts: string) => {
    if (skipPaneIds.has(paneId)) return;
    const snap = capturePaneSnapshot(paneId);
    if (!snap) return;
    const prov = registry.detect(snap);
    if (!prov) {
      tmuxSet(paneId, "@mesh_status", "empty");
      return;
    }
    const st = prov.composerState(snap);
    if (st.phase === "limit") {
      tmuxSet(paneId, "@mesh_status", `OC-LIMIT:${st.limitKind ?? "limit"}`);
    } else {
      tmuxSet(paneId, "@mesh_status", phaseLabel(st.phase, st.busyLabel, st.limitKind));
    }
    const ownerCb = store
      .readCheckbacks()
      .filter((r) => r.status === "active" && r.ownerPane === paneId).length;
    if (ownerCb > 0) {
      tmuxSet(paneId, "@mesh_patience", `PS:${ownerCb}`);
    } else if (activeCb > 0) {
      tmuxSet(paneId, "@mesh_patience", `PO:${activeCb}`);
    } else {
      tmuxSet(paneId, "@mesh_patience", "");
    }
  };

  for (const w of listMeshWorkers(session, workersWindow)) {
    paintOne(w.paneId, w.ports);
  }
  for (const m of listMeshMinis(session, minisWindow)) {
    paintOne(m.paneId, m.ports);
  }

  const mgr = meshManagerPane(session, baseWindow);
  if (mgr) {
    if (unsent > 0) {
      tmuxSet(mgr, "@mesh_status", `INBOX · ${unsent} pending`);
    } else if (unresolved > 0) {
      tmuxSet(mgr, "@mesh_status", `INBOX · ${unresolved} unresolved`);
    } else {
      paintOne(mgr, "manager");
    }
  }
}
