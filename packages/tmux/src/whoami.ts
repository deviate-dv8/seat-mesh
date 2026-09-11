import { spawnSync } from "node:child_process";
import {
  profilePaths,
  loadRoleIndex,
  renderRoleIndex,
  portsForSlot,
  type LoadedProfile,
} from "@seat-mesh/core";
import { resolvePaneTarget } from "./resolve-pane.js";

export interface WhoamiResult {
  inTmux: boolean;
  paneId: string | null;
  session: string | null;
  window: string | null;
  role: string;
  slot: number | null;
  slotLabel: string | null;
  ports: string | null;
  profile: string;
  workspace: string;
}

/** @deprecated use WhoamiResult */
export type WhereResult = WhoamiResult;

function tmuxDisplay(pane: string, format: string): string | null {
  const r = spawnSync("tmux", ["display-message", "-t", pane, "-p", format], {
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  return (r.stdout ?? "").trim() || null;
}

function detectRole(pane: string): string {
  const role =
    tmuxDisplay(pane, "#{@mesh_role}") ??
    tmuxDisplay(pane, "#{@zsign_role}") ??
    "worker";
  return role || "worker";
}

function detectSlot(pane: string): number | null {
  const raw =
    tmuxDisplay(pane, "#{@mesh_slot}") ??
    tmuxDisplay(pane, "#{@zsign_slot}");
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function slotFromLabel(label: string): number | null {
  const n = Number.parseInt(label, 10);
  return Number.isFinite(n) ? n : null;
}

export function runWhoami(loaded: LoadedProfile, target?: string): WhoamiResult {
  const resolved = resolvePaneTarget(target, loaded.profile.session.name);
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }
  const { paneId: pane, row } = resolved;
  const inTmux = Boolean(pane);

  let role = "worker";
  let slot: number | null = null;
  let slotLabel: string | null = null;
  let ports: string | null = null;
  let session: string | null = row.session;
  let window: string | null = row.window;

  if (pane) {
    role = row.role || detectRole(pane);
    slotLabel = row.slot || null;
    slot = slotFromLabel(row.slot) ?? detectSlot(pane);
    if (slot != null) {
      ports = portsForSlot(loaded.profile.ports.worker, slot);
    } else {
      ports =
        row.ports ||
        tmuxDisplay(pane, "#{@mesh_ports}") ||
        tmuxDisplay(pane, "#{@zsign_ports}");
    }
    if (!session) session = tmuxDisplay(pane, "#{session_name}");
    if (!window) window = tmuxDisplay(pane, "#{window_name}");
  }

  return {
    inTmux,
    paneId: pane,
    session,
    window,
    role,
    slot,
    slotLabel,
    ports,
    profile: loaded.profile.name,
    workspace: loaded.workspace,
  };
}

/** @deprecated use runWhoami */
export const runWhere = runWhoami;

export function printWhoami(loaded: LoadedProfile, target?: string): void {
  const w = runWhoami(loaded, target);
  const paths = profilePaths(loaded);

  const kind =
    w.role === "manager-mini"
      ? "mini"
      : w.role === "secretary"
        ? "secretary"
        : w.role === "manager"
          ? "master"
          : "worker";

  try {
    const index = loadRoleIndex(paths.rolesDir, kind);
    for (const line of index.banner ?? []) {
      console.log(line);
    }
  } catch {
    console.log("one_path=seat-mesh/docs/ONE-PATH.md | mesh only; ./sm.sh; no harness/:3099");
  }

  console.log(`profile=${w.profile}`);
  console.log(`workspace=${w.workspace}`);
  console.log(`in_tmux=${w.inTmux}`);
  if (w.session) console.log(`session=${w.session}`);
  if (w.window) console.log(`window=${w.window}`);
  if (w.paneId) console.log(`pane=${w.paneId}`);
  console.log(`you_are=${w.role.toUpperCase()}`);
  if (w.slotLabel) console.log(`slot=${w.slotLabel}`);
  else if (w.slot != null) console.log(`slot=${w.slot}`);
  if (w.ports) console.log(`ports=${w.ports}`);
  console.log(`seats_root=${paths.seatsRoot}`);
  console.log("--- index ---");

  try {
    const index = loadRoleIndex(paths.rolesDir, kind);
    const jobRole =
      tmuxDisplay(w.paneId ?? "", "#{@mesh_job_role}") ??
      tmuxDisplay(w.paneId ?? "", "#{@zsign_job_role}") ??
      "";
    console.log(
      renderRoleIndex(
        index,
        {
          jobRole,
          mini: tmuxDisplay(w.paneId ?? "", "#{@mesh_mini}") ?? "",
        },
        { skipBanner: true },
      ),
    );
  } catch (e) {
    console.log(`(no role index for ${kind}: ${(e as Error).message})`);
  }
}

/** @deprecated use printWhoami */
export const printWhere = printWhoami;
