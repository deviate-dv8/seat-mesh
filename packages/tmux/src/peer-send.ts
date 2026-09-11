import type { LoadedProfile } from "@seat-mesh/core";
import { portsForSlot } from "@seat-mesh/core";
import { enqueuePeer } from "./inbox-bridge.js";
import { resolvePaneTarget } from "./resolve-pane.js";
import { runWhoami } from "./whoami.js";
import { capturePaneSnapshot } from "./snapshot.js";

function requireWorkerSender(loaded: LoadedProfile): {
  slot: string;
  ports: string;
} {
  if (!process.env.TMUX_PANE) {
    throw new Error("refused: run from a worker tmux pane");
  }
  const who = runWhoami(loaded, "here");
  if (who.role === "manager" || who.role === "secretary" || who.role === "manager-mini") {
    throw new Error(`refused: ${who.role} cannot use peer send (use prompt / mini peer)`);
  }
  if (who.role !== "worker" || who.slot == null) {
    throw new Error(`refused: @mesh_role is '${who.role}' (want worker)`);
  }
  const slot = String(who.slot);
  if (who.slot < 1 || who.slot > loaded.profile.session.workerCount) {
    throw new Error(`refused: bad worker slot '${slot}'`);
  }
  const ports = who.ports ?? portsForSlot(loaded.profile.ports.worker, who.slot);
  return { slot, ports };
}

function formatToSlotMsg(fromSlot: string, fromPorts: string, destSlot: string, report: string): string {
  return `[agent-worker-slot-${fromSlot}] TO-SLOT-${destSlot} (${fromPorts}): ${report} (peer only - no merge/QA/Delivery authority)`;
}

function targetIsOpenCode(paneId: string): boolean {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return false;
  return /opencode/i.test(snap.currentCommand);
}

function formatToMiniMsg(
  fromSlot: string,
  fromPorts: string,
  miniId: string,
  report: string,
  targetPane: string,
): string {
  if (targetIsOpenCode(targetPane)) {
    return `Worker slot-${fromSlot} (${fromPorts}) -> mini-${miniId}: ${report}`;
  }
  return `[agent-worker-slot-${fromSlot}] TO-MINI-${miniId} (${fromPorts}): ${report}`;
}

/** Enqueue peer delivery (daemon injects when target pane idle). */
export function runToSlot(loaded: LoadedProfile, destSlot: string, report: string): void {
  const { slot, ports } = requireWorkerSender(loaded);
  const dest = destSlot.replace(/^slot-/, "");
  if (!/^[1-8]$/.test(dest)) {
    throw new Error("usage: to-slot <1-8> <msg...>");
  }
  if (dest === slot) {
    throw new Error(`refused: cannot to-slot yourself (slot-${slot})`);
  }
  if (!report.trim()) {
    throw new Error("usage: to-slot <1-8> <msg...>");
  }

  const session = loaded.profile.session.name;
  const resolved = resolvePaneTarget(dest, session);
  if ("error" in resolved) throw new Error(resolved.error);

  const msg = formatToSlotMsg(slot, ports, dest, report.trim());
  const resp = enqueuePeer(loaded, {
    kind: "to-slot",
    fromSlot: slot,
    fromPorts: ports,
    targetPane: resolved.paneId,
    targetLabel: `slot-${dest}`,
    msg,
  });
  if (!resp?.ok) {
    throw new Error("FAIL: to-slot enqueue (inbox down?) — run: ./sm.sh inbox");
  }
  console.log(`OK: queued -> slot-${dest} from slot-${slot} (daemon inject when idle)`);
}

export function runToMini(loaded: LoadedProfile, miniId: string, report: string): void {
  const { slot, ports } = requireWorkerSender(loaded);
  const mid = miniId.replace(/^mini-/, "");
  const max = loaded.profile.session.miniMax;
  if (!/^[1-9]$/.test(mid) || Number(mid) > max) {
    throw new Error(`usage: to-mini <1-${max}> <msg...>`);
  }
  if (!report.trim()) {
    throw new Error(`usage: to-mini <1-${max}> <msg...>`);
  }

  const session = loaded.profile.session.name;
  const resolved = resolvePaneTarget(`mini-${mid}`, session);
  if ("error" in resolved) throw new Error(resolved.error);

  const msg = formatToMiniMsg(slot, ports, mid, report.trim(), resolved.paneId);

  const resp = enqueuePeer(loaded, {
    kind: "to-mini",
    fromSlot: slot,
    fromPorts: ports,
    targetPane: resolved.paneId,
    targetLabel: `mini-${mid}`,
    msg,
  });
  if (!resp?.ok) {
    throw new Error("FAIL: to-mini enqueue (inbox down?) — run: ./sm.sh inbox");
  }
  console.log(`OK: queued -> mini-${mid} from slot-${slot} (daemon inject when idle)`);
}
