import { spawnSync } from "node:child_process";
import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { portsForSlot } from "@seat-mesh/core";
import { buildLaunchCmd } from "./agents-state.js";
import { focusBriefForPane } from "./focus-brief.js";
import { withPaneInputEnabled } from "./inject.js";
import { sendLaunch } from "./launch.js";
import { injectPromptDirect } from "./prompt.js";
import { capturePaneSnapshot } from "./snapshot.js";
import { resolvePaneTarget } from "./resolve-pane.js";
import { tmux } from "./tmux-run.js";

const CLI_TYPES = new Set(["agent", "kiro", "claude", "opencode", "empty"]);

function normalizeType(t: string): string {
  const x = t.trim().toLowerCase();
  if (x === "cursor-agent") return "agent";
  return x;
}

function providerIdToHarnessType(id: string): string {
  if (id === "cursor-agent") return "agent";
  return id;
}

function sleepMs(ms: number): void {
  spawnSync("sleep", [String(ms / 1000)]);
}

export interface SwitchOptions {
  fresh?: boolean;
  resumeId?: string;
  reason?: string;
}

export function runSwitch(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  target: string,
  newTypeRaw: string,
  opts: SwitchOptions = {},
): void {
  const session = loaded.profile.session.name;
  const newType = normalizeType(newTypeRaw);
  if (!CLI_TYPES.has(newType)) {
    throw new Error(`bad type: ${newTypeRaw} (want agent|kiro|claude|opencode|empty)`);
  }

  if (target === "here") {
    const pane = process.env.TMUX_PANE;
    if (!pane) throw new Error("switch here: not in tmux");
    const role = tmux(["display-message", "-t", pane, "-p", "#{@mesh_role}"]).out;
    if (role !== "manager") {
      throw new Error("switch here: only on manager pane (or pass manager|slot)");
    }
    target = "manager";
  }

  if (target === "manager" && newType === "empty") {
    throw new Error("refused: do not leave manager empty");
  }

  const resolved = resolvePaneTarget(target, session);
  if ("error" in resolved) throw new Error(resolved.error);

  const { paneId, row } = resolved;
  const snapBefore = capturePaneSnapshot(paneId);
  const oldProv = snapBefore ? registry.detect(snapBefore) : null;
  const oldType = oldProv ? providerIdToHarnessType(oldProv.id) : "empty";
  const oldDet = oldProv && snapBefore ? oldProv.detect(snapBefore) : null;

  let keepRid: string | null = null;
  if (opts.resumeId) {
    keepRid = opts.resumeId;
  } else if (!opts.fresh && newType !== "empty" && (newType === oldType || oldType === "empty")) {
    keepRid = oldDet?.resumeId ?? null;
  }

  const slot = row.slot || (row.role === "manager" ? "manager" : "?");
  const ports =
    row.ports ||
    (row.slot && /^\d+$/.test(row.slot)
      ? portsForSlot(loaded.profile.ports.worker, Number(row.slot))
      : row.role === "manager"
        ? "manager"
        : "-");

  console.log(`switch ${target} slot=${slot} ports=${ports}  ${oldType} -> ${newType}`);
  if (opts.reason) console.log(`reason: ${opts.reason}`);
  console.log(`resume: ${keepRid ?? "(none - fresh)"}`);

  tmux(["select-pane", "-e", "-t", paneId]);

  withPaneInputEnabled(paneId, () => {
    if (oldType === "kiro") {
      tmux(["send-keys", "-t", paneId, "Escape"]);
      sleepMs(300);
      tmux(["send-keys", "-t", paneId, "Escape"]);
      sleepMs(300);
    }
    tmux(["send-keys", "-t", paneId, "C-c"]);
    sleepMs(350);
    tmux(["send-keys", "-t", paneId, "C-c"]);
    sleepMs(250);
  });

  if (newType === "empty") {
    tmux(["set-option", "-p", "-t", paneId, "@mesh_status", `empty${opts.reason ? ` · ${opts.reason}` : ""}`]);
    withPaneInputEnabled(paneId, () => {
      tmux(["send-keys", "-t", paneId, "clear", "Enter"]);
    });
    console.log(`cleared CLI -> plain terminal on ${paneId}`);
    return;
  }

  const cmd = buildLaunchCmd(newType, loaded.workspace, keepRid);
  if (!cmd) throw new Error(`no launch command for type ${newType}`);
  sendLaunch(paneId, cmd);
  sleepMs(newType === "opencode" ? 3000 : 1500);

  const prefix = loaded.profile.daemon.managerPromptPrefix;
  const stamp =
    row.role === "manager"
      ? ""
      : `slot-${slot} ports ${ports} - `;
  let msg = `${prefix} ${stamp}HANDOFF: replacement CLI (was ${oldType}, now ${newType}).`;
  if (keepRid) msg += ` Resumed session id ${keepRid}.`;
  else msg += ` Fresh session.`;
  if (row.role === "manager") {
    msg +=
      " You are MASTER manager. Docs: .agent/manager-agent.md .agent/manager-minis.md";
  } else {
    msg += ` Slot ${slot}. Ports ${ports} (paired only).`;
  }
  if (opts.reason) msg += ` Reason: ${opts.reason}.`;
  msg += " Continue from seat FOCUS below. .agent/agent-seats.md .agent/permissions.md.";
  msg += `\n\n--- seat FOCUS ---\n${focusBriefForPane(loaded, row)}\n--- end FOCUS ---`;

  try {
    injectPromptDirect(loaded, registry, paneId, msg, { prefix: "" });
    console.log(`injected HANDOFF + FOCUS into ${paneId}`);
  } catch (e) {
    console.error(`WARN: HANDOFF not injected: ${(e as Error).message}`);
  }

  if (row.role === "manager") {
    tmux(["select-pane", "-t", paneId, "-T", "master"]);
  }
  tmux([
    "set-option",
    "-p",
    "-t",
    paneId,
    "@mesh_status",
    `${newType}${opts.reason ? ` · ${opts.reason}` : ""}`,
  ]);
  console.log(`launched: ${cmd}`);
}
