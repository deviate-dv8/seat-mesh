import { tmux } from "./tmux-run.js";

/** Tab-separated — tmux collapses empty space-separated fields. */
export const PANE_META_FMT =
  "#{pane_id}\t#{@mesh_role}\t#{@mesh_slot}\t#{@mesh_mini}\t#{@mesh_ports}";

export interface MeshPaneMeta {
  paneId: string;
  role: string;
  slot: string;
  mini: string;
  ports: string;
}

export function parsePaneMetaLine(line: string): MeshPaneMeta | null {
  const parts = line.trim().split("\t");
  if (!parts[0]?.startsWith("%")) return null;
  let slot = parts[2] || "";
  let mini = parts[3] || "";
  if (slot.startsWith("mini-")) {
    mini = slot.slice(5);
    slot = "";
  }
  return {
    paneId: parts[0],
    role: parts[1] || "",
    slot,
    mini,
    ports: parts[4] || "",
  };
}

function listWindowMeta(session: string, window: string): MeshPaneMeta[] {
  const target = `${session}:${window}`;
  const out = tmux(["list-panes", "-t", target, "-F", PANE_META_FMT]).out;
  if (!out) return [];
  return out
    .split("\n")
    .map((line) => parsePaneMetaLine(line))
    .filter((m): m is MeshPaneMeta => m !== null);
}

export function listMeshWorkers(session: string, workersWindow: string): MeshPaneMeta[] {
  return listWindowMeta(session, workersWindow).filter((m) => {
    const n = Number(m.slot);
    return m.role === "worker" && n >= 1;
  });
}

export function listMeshMinis(session: string, minisWindow: string): MeshPaneMeta[] {
  return listWindowMeta(session, minisWindow).filter((m) => /^[1-9]$/.test(m.mini));
}

export function meshManagerPane(session: string, baseWindow: string): string | null {
  for (const m of listWindowMeta(session, baseWindow)) {
    if (m.role === "manager") return m.paneId;
  }
  return listWindowMeta(session, baseWindow)[0]?.paneId ?? null;
}

export function meshSecretaryPane(session: string, baseWindow: string): string | null {
  for (const m of listWindowMeta(session, baseWindow)) {
    if (m.role === "secretary") return m.paneId;
  }
  return null;
}

export function listMeshMonitorPanes(
  session: string,
  baseWindow: string,
  workersWindow: string,
  minisWindow: string,
): { paneId: string; label: string }[] {
  const out: { paneId: string; label: string }[] = [];
  const seen = new Set<string>();
  const add = (paneId: string, label: string) => {
    if (!paneId || seen.has(paneId)) return;
    seen.add(paneId);
    out.push({ paneId, label });
  };
  for (const w of listMeshWorkers(session, workersWindow)) {
    add(w.paneId, `slot-${w.slot}`);
  }
  for (const m of listMeshMinis(session, minisWindow)) {
    add(m.paneId, `mini-${m.mini}`);
  }
  const mgr = meshManagerPane(session, baseWindow);
  if (mgr) add(mgr, "master");
  const sec = meshSecretaryPane(session, baseWindow);
  if (sec) add(sec, "secretary");
  return out;
}
