import { spawnSync } from "node:child_process";
import type { LoadedProfile } from "@seat-mesh/core";
import { buildAgentLaunchCmd } from "./agent-builder.js";
import {
  loadLaunchState,
  resolveLaunchCmd,
  workerStateForSlot,
} from "./agents-state.js";
import { ensureMeshSessionEnv } from "./session-env.js";
import { tmux } from "./tmux-run.js";
import { listWindowPaneIds } from "./window-panes.js";

export interface LaunchResult {
  paneId: string;
  label: string;
  status: "launched" | "skipped" | "failed";
  cmd?: string;
  reason?: string;
}

function sleepMs(ms: number): void {
  spawnSync("sleep", [String(ms / 1000)]);
}


export function sendLaunch(paneId: string, cmd: string): void {
  tmux(["send-keys", "-t", paneId, "C-c"]);
  sleepMs(180);
  tmux(["send-keys", "-t", paneId, "C-c"]);
  sleepMs(180);
  tmux(["send-keys", "-t", paneId, "clear", "Enter"]);
  sleepMs(250);
  tmux(["send-keys", "-t", paneId, "-l", cmd]);
  sleepMs(80);
  tmux(["send-keys", "-t", paneId, "Enter"]);
}

function tryLaunch(
  paneId: string,
  label: string,
  cmd: string | null,
  skipEmpty: boolean,
  type: string,
): LaunchResult {
  if (!cmd) {
    return {
      paneId,
      label,
      status: "skipped",
      reason: skipEmpty && type === "empty" ? "empty seat" : "no launch command",
    };
  }
  try {
    sendLaunch(paneId, cmd);
    return { paneId, label, status: "launched", cmd };
  } catch (e) {
    return {
      paneId,
      label,
      status: "failed",
      reason: (e as Error).message,
    };
  }
}

export interface LaunchOptions {
  /** manager | secretary | worker slot number | all */
  targets?: string[];
}

export function launchSession(
  loaded: LoadedProfile,
  opts: LaunchOptions = {},
): LaunchResult[] {
  const session = loaded.profile.session.name;
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");

  ensureMeshSessionEnv(session);

  const state = loadLaunchState(
    loaded.workspace,
    loaded.profile.state.meshAgentsJson,
    loaded.profile.state.agentsJson,
  );
  const skipEmpty = state.conventions?.launch_skips_empty ?? true;
  const wantAll = !opts.targets?.length;
  const want = new Set((opts.targets ?? []).map((t) => t.toLowerCase()));

  const results: LaunchResult[] = [];

  const basePanes = listWindowPaneIds(session, layout.base.window);
  const workerPanes = listWindowPaneIds(session, layout.workers.window);

  if (wantAll || want.has("manager") || want.has("master")) {
    const pane = basePanes[0];
    if (pane && state.manager) {
      const cmd = resolveLaunchCmd(state.manager, loaded.workspace);
      results.push(
        tryLaunch(pane, "manager", cmd, skipEmpty, state.manager.type),
      );
    }
  }

  if (wantAll || want.has("secretary")) {
    const pane = basePanes[1];
    if (pane) {
      const secType =
        state.conventions?.secretary_default_cli ??
        state.secretary?.type ??
        "opencode";
      const wanted = state.secretary?.wanted ?? true;
      if (!wanted) {
        results.push({
          paneId: pane,
          label: "secretary",
          status: "skipped",
          reason: "secretary not wanted",
        });
      } else {
        const harnessType = secType === "cursor-agent" ? "agent" : secType;
        const secEntry = {
          type: harnessType,
          resume_id: state.secretary?.resume_id ?? null,
          resume_cmd: state.secretary?.resume_cmd ?? null,
        };
        const cmd =
          resolveLaunchCmd(secEntry, loaded.workspace) ??
          buildAgentLaunchCmd(harnessType, loaded.workspace, secEntry.resume_id);
        results.push(tryLaunch(pane, "secretary", cmd, skipEmpty, harnessType));
      }
    }
  }

  const miniMax = loaded.profile.session.miniMax;
  const miniPanes = listWindowPaneIds(session, layout.minis.window);
  const miniCli =
    state.conventions?.mini_default_cli ??
    state.conventions?.secretary_default_cli ??
    "opencode";
  const wantMinis =
    wantAll || want.has("minis") || want.has("mini") || [...want].some((t) => t.startsWith("mini-"));
  if (wantMinis) {
    const harnessMini = miniCli === "cursor-agent" ? "agent" : miniCli;
    for (let n = 1; n <= miniMax; n++) {
      const key = `mini-${n}`;
      if (!wantAll && !want.has("minis") && !want.has(key) && !want.has(String(n))) continue;
      const pane = miniPanes[n - 1];
      if (!pane) continue;
      const cmd = buildAgentLaunchCmd(harnessMini, loaded.workspace, null);
      results.push(tryLaunch(pane, key, cmd, false, harnessMini));
    }
  }

  const workerCount = loaded.profile.session.workerCount;
  for (let slot = 1; slot <= workerCount; slot++) {
    const key = String(slot);
    const slotKey = `slot-${slot}`;
    if (!wantAll && !want.has(key) && !want.has(slotKey) && !want.has("workers") && !want.has("all")) {
      continue;
    }
    const pane = workerPanes[slot - 1];
    if (!pane) continue;
    const entry = workerStateForSlot(state, slot);
    if (!entry) {
      results.push({
        paneId: pane,
        label: `slot-${slot}`,
        status: "skipped",
        reason: "no agents json entry",
      });
      continue;
    }
    if (skipEmpty && entry.type === "empty") {
      results.push({
        paneId: pane,
        label: `slot-${slot}`,
        status: "skipped",
        reason: "empty seat",
      });
      continue;
    }
    const cmd = resolveLaunchCmd(entry, loaded.workspace);
    results.push(tryLaunch(pane, `slot-${slot}`, cmd, skipEmpty, entry.type));
  }

  return results;
}

export function printLaunchResults(results: LaunchResult[]): void {
  for (const r of results) {
    const cmd = r.cmd ? ` cmd=${r.cmd.slice(0, 72)}${r.cmd.length > 72 ? "…" : ""}` : "";
    const why = r.reason ? ` (${r.reason})` : "";
    console.log(`${r.label}\t${r.paneId}\t${r.status}${why}${r.status === "launched" ? cmd : ""}`);
  }
  const launched = results.filter((r) => r.status === "launched").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;
  console.log(`--- launch: ${launched} launched, ${skipped} skipped, ${failed} failed`);
}
