import { spawnSync } from "node:child_process";
import {
  profilePaths,
  loadRoleIndex,
  renderRoleIndex,
  portsForSlot,
  type LoadedProfile,
} from "@seat-mesh/core";

export interface WhoamiResult {
  inTmux: boolean;
  paneId: string | null;
  role: string;
  slot: number | null;
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

export function runWhoami(loaded: LoadedProfile, target?: string): WhoamiResult {
  const pane = target ?? process.env.TMUX_PANE ?? null;
  const inTmux = Boolean(pane);

  let role = "worker";
  let slot: number | null = null;
  let ports: string | null = null;

  if (pane) {
    role = detectRole(pane);
    slot = detectSlot(pane);
    if (slot != null) {
      ports = portsForSlot(loaded.profile.ports.worker, slot);
    } else {
      ports =
        tmuxDisplay(pane, "#{@mesh_ports}") ??
        tmuxDisplay(pane, "#{@zsign_ports}");
    }
  }

  return {
    inTmux,
    paneId: pane,
    role,
    slot,
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

  console.log(`profile=${w.profile}`);
  console.log(`workspace=${w.workspace}`);
  console.log(`in_tmux=${w.inTmux}`);
  if (w.paneId) console.log(`pane=${w.paneId}`);
  console.log(`you_are=${w.role.toUpperCase()}`);
  if (w.slot != null) console.log(`slot=${w.slot}`);
  if (w.ports) console.log(`ports=${w.ports}`);
  console.log(`seats_root=${paths.seatsRoot}`);
  console.log("--- index ---");

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
    const jobRole =
      tmuxDisplay(w.paneId ?? "", "#{@mesh_job_role}") ??
      tmuxDisplay(w.paneId ?? "", "#{@zsign_job_role}") ??
      "";
    console.log(
      renderRoleIndex(index, {
        jobRole,
        mini: tmuxDisplay(w.paneId ?? "", "#{@mesh_mini}") ?? "",
      }),
    );
  } catch (e) {
    console.log(`(no role index for ${kind}: ${(e as Error).message})`);
  }
}

/** @deprecated use printWhoami */
export const printWhere = printWhoami;
