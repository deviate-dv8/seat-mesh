import { spawnSync } from "node:child_process";

export interface PaneRow {
  paneId: string;
  session: string;
  window: string;
  role: string;
  slot: string;
  ports: string;
  mini: string;
}

function tmux(args: string[]): string | null {
  const r = spawnSync("tmux", args, { encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout ?? "").trim() || null;
}

export function listPanes(session?: string): PaneRow[] {
  const args = [
    "list-panes",
    ...(session ? ["-s", "-t", session] : ["-a"]),
    "-F",
    "#{pane_id}\t#{session_name}\t#{window_name}\t#{@mesh_role}\t#{@zsign_role}\t#{@mesh_slot}\t#{@zsign_slot}\t#{@mesh_ports}\t#{@zsign_ports}\t#{@mesh_mini}\t#{@zsign_mini}",
  ];
  const out = tmux(args);
  if (!out) return [];
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [
        paneId,
        sessionName,
        window,
        meshRole,
        zsignRole,
        meshSlot,
        zsignSlot,
        meshPorts,
        zsignPorts,
        meshMini,
        zsignMini,
      ] = line.split("\t");
      return {
        paneId,
        session: sessionName,
        window,
        role: meshRole || zsignRole || "",
        slot: meshSlot || zsignSlot || "",
        ports: meshPorts || zsignPorts || "",
        mini: meshMini || zsignMini || "",
      };
    });
}

/** slot-first: bare 1-8, slot-N, pane-N/pN, manager, mini-N, %id, here */
export function resolvePaneTarget(
  arg?: string,
  sessionName = "dev",
): { paneId: string; row: PaneRow } | { error: string } {
  const raw = (arg ?? "").trim();
  if (!raw || raw === "here") {
    const paneId = process.env.TMUX_PANE;
    if (!paneId) {
      return {
        error:
          "not in tmux — pass a target: ./sm.sh whoami <1-8|slot-N|manager|mini-N|%id>",
      };
    }
    const row = listPanes().find((p) => p.paneId === paneId);
    if (!row) return { error: `pane ${paneId} not found` };
    return { paneId, row };
  }

  if (raw.startsWith("%")) {
    const row = listPanes().find((p) => p.paneId === raw);
    if (!row) return { error: `pane ${raw} not found` };
    return { paneId: raw, row };
  }

  if (raw === "manager" || raw === "master") {
    const row =
      listPanes(sessionName).find((p) => p.role === "manager") ??
      listPanes().find((p) => p.role === "manager");
    if (!row) return { error: "no manager pane in session" };
    return { paneId: row.paneId, row };
  }

  if (raw === "secretary") {
    const row =
      listPanes(sessionName).find((p) => p.role === "secretary") ??
      listPanes().find((p) => p.role === "secretary");
    if (!row) return { error: "no secretary pane in session" };
    return { paneId: row.paneId, row };
  }

  const miniMatch = raw.match(/^mini-(\d+)$/);
  if (miniMatch) {
    const n = miniMatch[1];
    const row =
      listPanes(sessionName).find((p) => p.mini === n || p.slot === `mini-${n}`) ??
      listPanes().find((p) => p.mini === n || p.slot === `mini-${n}`);
    if (!row) return { error: `mini-${n} pane not found` };
    return { paneId: row.paneId, row };
  }

  const slotMatch = raw.match(/^(?:slot-)?(\d+)$/);
  if (slotMatch) {
    const slot = slotMatch[1];
    const row = listPanes(sessionName).find((p) => p.slot === slot);
    if (!row) return { error: `slot ${slot} pane not found in session '${sessionName}'` };
    return { paneId: row.paneId, row };
  }

  const paneIdx = raw.match(/^(?:pane-)?p?(\d+)$/i);
  if (paneIdx && raw !== "pane-0" && raw !== "0") {
    // pane-N is pane index escape hatch — list panes in default window order is fragile; try tmux directly
    const paneId = tmux(["display-message", "-t", raw, "-p", "#{pane_id}"]);
    if (paneId?.startsWith("%")) {
      const row = listPanes().find((p) => p.paneId === paneId);
      if (row) return { paneId, row };
    }
  }

  if (raw.includes(":") || raw.includes(".")) {
    const paneId = tmux(["display-message", "-t", raw, "-p", "#{pane_id}"]);
    if (paneId?.startsWith("%")) {
      const row = listPanes().find((p) => p.paneId === paneId);
      if (row) return { paneId, row };
      return {
        paneId,
        row: {
          paneId,
          session: sessionName,
          window: "?",
          role: "",
          slot: "",
          ports: "",
          mini: "",
        },
      };
    }
  }

  return {
    error: `bad target: ${raw} (want here | 1-8 | slot-N | manager | secretary | mini-N | %id)`,
  };
}
