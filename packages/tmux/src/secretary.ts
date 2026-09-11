import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { createBuiltinRegistry } from "@seat-mesh/providers";
import { buildAgentLaunchCmd } from "./agent-builder.js";
import { loadLaunchState, resolveLaunchCmd } from "./agents-state.js";
import { enqueuePeer, ensureMeshInbox, inboxHealth, meshInboxPort } from "./inbox-bridge.js";
import { resolvePaneTarget } from "./resolve-pane.js";
import type { MiniCampaignDigest } from "./minis.js";
import { submitPaneOp } from "./pane-ops-client.js";
import { buildMiniCampaignDigest, miniPrompt, miniSpawnAll } from "./minis.js";
import { meshManagerPane } from "./pane-meta.js";
import { injectPromptDirect } from "./prompt.js";
import { capturePaneSnapshot } from "./snapshot.js";
import { tmux } from "./tmux-run.js";
import { listWindowPaneIds } from "./window-panes.js";

const MESH_WATCH_ID = "mesh-watch-secretary";
const MANAGER_NUDGE_ID = "mesh-manager-nudge";
const SECRETARY_SUPERVISE_ID = "mesh-secretary-supervise";

function superviseMarkerPath(workspace: string): string {
  return path.join(workspace, "tasks/agent-seats/manager/SECRETARY-SUPERVISE.on");
}

function inboxPort(loaded: LoadedProfile): number {
  return meshInboxPort(loaded);
}

function inboxBase(loaded: LoadedProfile): string {
  return `http://127.0.0.1:${inboxPort(loaded)}`;
}

function parseDurationSeconds(raw: string): number {
  const m = raw.match(/^(\d+)(s|m|h)?$/i);
  if (!m) return 300;
  const n = Number(m[1]);
  const u = (m[2] || "s").toLowerCase();
  if (u === "m") return n * 60;
  if (u === "h") return n * 3600;
  return n;
}

function curlJson(
  method: string,
  url: string,
  body?: unknown,
): Record<string, unknown> | null {
  const args = ["-sS", "-m", "5", "-X", method, url];
  if (body !== undefined) {
    args.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
  }
  const r = spawnSync("curl", args, { encoding: "utf8" });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout || "{}") as Record<string, unknown>;
  } catch {
    return { raw: r.stdout };
  }
}

function sleepMs(ms: number): void {
  if (ms <= 0) return;
  spawnSync("sleep", [String(ms / 1000)]);
}

function tmuxCaptureTail(paneId: string, lines = 22): string {
  return tmux(["capture-pane", "-t", paneId, "-p", "-S", `-${lines}`]).out ?? "";
}

/** Harness-aligned: wait for OpenCode splash -> composer before POV paste. */
function waitOpencodeComposerReady(paneId: string): boolean {
  for (let i = 0; i < 45; i++) {
    const bottom = tmuxCaptureTail(paneId, 22);
    if (/Thinking|Working|Running|⠏|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|esc interrupt/i.test(bottom)) {
      sleepMs(450);
      continue;
    }
    if (
      /Ask anything|Ask a question|Type a message|Send a message|What would you like/i.test(
        bottom,
      )
    ) {
      sleepMs(250);
      return true;
    }
    sleepMs(400);
  }
  return false;
}

function waitLiveCli(
  paneId: string,
  registry: ProviderRegistry,
  maxTries = 25,
): string | null {
  for (let i = 0; i < maxTries; i++) {
    const snap = capturePaneSnapshot(paneId);
    const prov = snap ? registry.detect(snap) : null;
    if (prov) return prov.id;
    sleepMs(400);
  }
  return null;
}

function secretaryContextSnippet(workspace: string, loaded: LoadedProfile): string {
  const focusPath = path.join(workspace, "tasks/agent-seats/manager/FOCUS.md");
  let ctx = "";
  if (fs.existsSync(focusPath)) {
    const text = fs.readFileSync(focusPath, "utf8");
    const nowBlock = text.match(/^## NOW\n([\s\S]*?)(?=\n## |\s*$)/m);
    ctx = (nowBlock?.[1] ?? "")
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .slice(0, 8)
      .map((l) => l.replace(/^- /, "").trim())
      .join("; ");
  }
  const nightOn = fs.existsSync(
    path.join(workspace, "tasks/agent-seats/manager/night.on"),
  );
  const nightBit = nightOn ? " night=ON" : "";
  let nMinis = 0;
  const layout = loaded.profile.layout;
  if (layout) {
    nMinis = listWindowPaneIds(loaded.profile.session.name, layout.minis.window).length;
  }
  const miniMax = loaded.profile.session.miniMax;
  const meshFinal = path.join(
    workspace,
    "projects_waygraph/zsign-all/docs/MESH-FINAL.md",
  );
  const mesh = fs.existsSync(meshFinal)
    ? " zsign-all 125/125 done (MESH-FINAL.md)."
    : "";
  return `CONTEXT: ${ctx.slice(0, 380)}${nightBit} minis=${nMinis}/${miniMax}.${mesh} OC: CPE scripts/opencode-cpe.sh :18887; ./sm.sh whoami for mesh seat.`;
}

function secretaryPovBriefing(
  workspace: string,
  loaded: LoadedProfile,
  typ: string,
): string {
  const ctx = secretaryContextSnippet(workspace, loaded);
  const pov =
    "you are SECRETARY (NOT mini/master/worker). Run ./sm.sh whoami - must show you_are=SECRETARY; read_first=.agent/manager-secretary.md. Job: absorb worker ACK/stand-by/mcp-synced/FYI; bulk digest to master (not bit-by-bit); notify Dan ~10% via ./scripts/notify.sh --slot manager when he must check. Default: spawn 1 mini, wait done, fold digest. May: trivial inbox; seats/contexts/mini list/health; mini spawn tester|code-reviewer|helper when safe; mesh-watch on. Must NOT: prompt/switch workers; merge; board moves; rubber-stamp product MINI-DONE; steal prove toasts.";
  let b: string;
  if (typ === "opencode") {
    b = `You are SECRETARY. ${ctx} ${pov} Standing by - transform noise.`;
  } else {
    b = `[agent-manager-secretary] POV: ${ctx} ${pov} Standing by - do not chat Dan as primary.`;
  }
  if (b.length > 900) b = `${b.slice(0, 900)}…`;
  return b;
}

function stampSecretaryMeta(paneId: string): void {
  const pairs: Record<string, string> = {
    mesh_role: "secretary",
    mesh_mini: "",
    mesh_slot: "secretary",
    mesh_ports: "secretary",
    mesh_title: "secretary",
    zsign_role: "secretary",
    zsign_mini: "",
    zsign_slot: "secretary",
    zsign_ports: "secretary",
    zsign_title: "secretary",
  };
  for (const [k, v] of Object.entries(pairs)) {
    tmux(["set-option", "-p", "-t", paneId, `@${k}`, v]);
  }
  tmux(["select-pane", "-t", paneId, "-T", "secretary"]);
}

function resolveSecretaryLaunchCmd(
  loaded: LoadedProfile,
  typ: string,
): string | null {
  const state = loadLaunchState(
    loaded.workspace,
    loaded.profile.state.meshAgentsJson,
    loaded.profile.state.agentsJson,
  );
  const harnessType = typ === "cursor-agent" ? "agent" : typ;
  const secEntry = {
    type: harnessType,
    resume_id: state.secretary?.resume_id ?? null,
    resume_cmd: state.secretary?.resume_cmd ?? null,
  };
  return (
    resolveLaunchCmd(secEntry, loaded.workspace) ??
    buildAgentLaunchCmd(harnessType, loaded.workspace, secEntry.resume_id)
  );
}

/**
 * Hard-reload secretary: respawn-pane -k -> fresh shell -> CLI -> POV inject.
 * Mirrors harness run_secretary_restart (bypasses pane-op queue).
 */
export function secretaryRestart(
  loaded: LoadedProfile,
  registry?: ProviderRegistry,
  typArg?: string,
): void {
  const reg = registry ?? createBuiltinRegistry(loaded.profile.providers);
  const session = loaded.profile.session.name;
  const workspace = loaded.workspace;
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");

  const resolved = resolvePaneTarget("secretary", session);
  if ("error" in resolved) {
    throw new Error(`${resolved.error} - run: ./sm.sh secretary start`);
  }
  const paneId = resolved.paneId;

  const state = loadLaunchState(
    workspace,
    loaded.profile.state.meshAgentsJson,
    loaded.profile.state.agentsJson,
  );
  let typ =
    typArg ??
    state.secretary?.type ??
    state.conventions?.secretary_default_cli ??
    "opencode";
  if (typ === "cursor-agent") typ = "agent";
  if (typ === "empty") {
    throw new Error("refused: secretary restart empty - use secretary stop");
  }

  const masterPane = meshManagerPane(session, layout.base.window);
  const cmd = resolveSecretaryLaunchCmd(loaded, typ);
  if (!cmd) throw new Error(`no launch cmd for secretary type ${typ}`);

  tmux(["select-pane", "-e", "-t", paneId]);

  const respawn = tmux(["respawn-pane", "-k", "-c", workspace, "-t", paneId]);
  if (!respawn.ok) {
    console.error("WARN: respawn-pane failed; falling back to Escape/C-c quit");
    tmux(["send-keys", "-t", paneId, "Escape"]);
    sleepMs(200);
    tmux(["send-keys", "-t", paneId, "Escape"]);
    sleepMs(200);
    tmux(["send-keys", "-t", paneId, "C-c"]);
    sleepMs(300);
    tmux(["send-keys", "-t", paneId, "C-c"]);
    sleepMs(300);
    tmux(["send-keys", "-t", paneId, "clear", "Enter"]);
    sleepMs(200);
  } else {
    sleepMs(800);
  }

  stampSecretaryMeta(paneId);
  tmux(["set-option", "-p", "-t", paneId, "@mesh_status", "restarting"]);
  tmux(["select-pane", "-e", "-t", paneId]);

  tmux(["send-keys", "-t", paneId, cmd, "Enter"]);
  sleepMs(300);
  tmux(["send-keys", "-t", paneId, "Enter"]);

  const live = waitLiveCli(paneId, reg);
  if (!live) {
    tmux(["set-option", "-p", "-t", paneId, "@mesh_status", "restart-fail"]);
    throw new Error(`secretary restart failed: no live CLI on ${paneId}`);
  }

  const effectiveTyp = typ === "opencode" || live === "opencode" ? "opencode" : typ;
  if (effectiveTyp === "opencode" && !waitOpencodeComposerReady(paneId)) {
    console.error(
      "WARN: opencode composer not ready on",
      paneId,
      "(waited ~18s) - POV inject may fail",
    );
  }
  sleepMs(500);

  const msg = secretaryPovBriefing(workspace, loaded, effectiveTyp);
  injectPromptDirect(loaded, reg, paneId, msg, { prefix: "" });
  sleepMs(2000);

  if (effectiveTyp === "opencode") {
    const bottom = tmuxCaptureTail(paneId, 50);
    if (!/SECRETARY|You are SECRETARY|CONTEXT:/i.test(bottom)) {
      console.error(
        "WARN: secretary POV inject uncertain - retry: ./sm.sh secretary restart",
      );
    }
  }

  tmux(["set-option", "-p", "-t", paneId, "@mesh_status", ""]);
  tmux(["select-pane", "-d", "-t", paneId]);
  if (masterPane) tmux(["select-pane", "-t", masterPane]);

  console.log(`OK: restarted secretary pane=${paneId} (${effectiveTyp}): respawn + POV`);
}

export function secretaryLaunch(loaded: LoadedProfile): void {
  const reg = createBuiltinRegistry(loaded.profile.providers);
  submitPaneOp(
    loaded,
    "launch",
    { targets: ["secretary"] },
    "secretary start",
    () => secretaryRestart(loaded, reg),
  );
}

export function secretaryMeshWatch(
  loaded: LoadedProfile,
  sub: "on" | "off" | "status",
  interval = "5m",
): void {
  ensureMeshInbox(loaded, { quiet: true });
  const health = inboxHealth(inboxPort(loaded));
  if (!health) {
    throw new Error("inbox DOWN — run: ./sm.sh reload (or inbox restart)");
  }

  const base = inboxBase(loaded);
  if (sub === "off") {
    curlJson("POST", `${base}/patience/${encodeURIComponent(MESH_WATCH_ID)}/cancel`);
    console.log("OK: secretary mesh-watch OFF");
    return;
  }

  if (sub === "status") {
    const r = spawnSync(
      "curl",
      ["-sS", `${base}/patience?all=1`],
      { encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error("patience list failed");
    const lines = (r.stdout || "").split("\n").filter((l) => l.includes(MESH_WATCH_ID));
    if (!lines.length) {
      console.log("mesh-watch: OFF");
      return;
    }
    console.log(lines.join("\n"));
    return;
  }

  const resolved = resolvePaneTarget("secretary", loaded.profile.session.name);
  if ("error" in resolved) {
    throw new Error(`${resolved.error} — run: ./sm.sh secretary start`);
  }

  const secs = parseDurationSeconds(interval);
  const expires = new Date(Date.now() + secs * 1000).toISOString();
  curlJson("POST", `${base}/patience/${encodeURIComponent(MESH_WATCH_ID)}/cancel`);
  const body = {
    id: MESH_WATCH_ID,
    kind: "mesh-watch",
    renewSec: secs,
    expect: "mesh MINI-DONE / health change / STALE thought-only minis",
    ownerPane: resolved.paneId,
    expiresAt: expires,
    senderLabel: "inbox",
    recipientLabel: "secretary",
  };
  const created = curlJson("POST", `${base}/patience`, body);
  console.log(`OK: secretary mesh-watch ON renew=${interval} pane=${resolved.paneId}`);
  if (created) console.log(JSON.stringify(created, null, 2));
}

interface CheckbackRowLocal {
  id: string;
  kind: string;
  status: "active" | "cancelled";
  renewSec?: number;
  expect?: string;
  ownerPane?: string;
  expiresAt?: string;
  senderLabel?: string;
  recipientLabel?: string;
  createdAt: string;
  updatedAt: string;
}

function checkbackPath(workspace: string): string {
  return path.join(workspace, "tasks/seat-mesh/daemon/CHECKBACK.jsonl");
}

function readCheckbacksLocal(workspace: string): CheckbackRowLocal[] {
  const p = checkbackPath(workspace);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CheckbackRowLocal);
}

function writeCheckbacksLocal(workspace: string, rows: CheckbackRowLocal[]): void {
  const p = checkbackPath(workspace);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

function upsertCheckbackLocal(workspace: string, row: CheckbackRowLocal): void {
  const rows = readCheckbacksLocal(workspace).filter((r) => r.id !== row.id);
  rows.push(row);
  writeCheckbacksLocal(workspace, rows);
}

function cancelCheckbackLocal(workspace: string, id: string): void {
  const now = new Date().toISOString();
  const rows = readCheckbacksLocal(workspace);
  let hit = false;
  for (const r of rows) {
    if (r.id === id || r.id.startsWith(id)) {
      r.status = "cancelled";
      r.updatedAt = now;
      hit = true;
    }
  }
  if (hit) writeCheckbacksLocal(workspace, rows);
}

function armPatienceLocal(
  workspace: string,
  body: Omit<CheckbackRowLocal, "createdAt" | "updatedAt" | "status">,
): void {
  const now = new Date().toISOString();
  upsertCheckbackLocal(workspace, {
    ...body,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

function armPatience(
  loaded: LoadedProfile,
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  const row = body as Omit<CheckbackRowLocal, "createdAt" | "updatedAt" | "status">;
  armPatienceLocal(loaded.workspace, row);
  return { ok: true, entry: row };
}

function cancelPatience(loaded: LoadedProfile, id: string): void {
  cancelCheckbackLocal(loaded.workspace, id);
}

/** Dan-assigned: secretary + daemon keep manager moving without Dan "continue". */
export function secretarySupervise(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  sub: "on" | "off" | "status",
  interval = "5m",
): void {
  const workspace = loaded.workspace;
  const session = loaded.profile.session.name;
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");

  const secResolved = resolvePaneTarget("secretary", session);
  const mgrResolved = resolvePaneTarget("manager", session);
  if ("error" in secResolved) {
    throw new Error(`${secResolved.error} — run: ./sm.sh secretary restart`);
  }
  if ("error" in mgrResolved) {
    throw new Error(`${mgrResolved.error} — manager pane missing`);
  }

  const marker = superviseMarkerPath(workspace);

  if (sub === "off") {
    cancelPatience(loaded, MANAGER_NUDGE_ID);
    cancelPatience(loaded, SECRETARY_SUPERVISE_ID);
    cancelPatience(loaded, MESH_WATCH_ID);
    if (fs.existsSync(marker)) fs.unlinkSync(marker);
    console.log("OK: secretary supervise OFF (manager-nudge + supervise loop cancelled)");
    return;
  }

  if (sub === "status") {
    const on = fs.existsSync(marker);
    console.log(`supervise: ${on ? "ON" : "OFF"}`);
    if (on) {
      try {
        const meta = JSON.parse(fs.readFileSync(marker, "utf8")) as {
          since?: string;
          interval?: string;
          managerPane?: string;
          secretaryPane?: string;
        };
        if (meta.since) console.log(`  since: ${meta.since}`);
        if (meta.interval) console.log(`  interval: ${meta.interval}`);
        if (meta.managerPane) console.log(`  manager: ${meta.managerPane}`);
        if (meta.secretaryPane) console.log(`  secretary: ${meta.secretaryPane}`);
      } catch {
        /* ignore */
      }
    }
    secretaryStatus(loaded);
    return;
  }

  const secs = parseDurationSeconds(interval);
  const expires = new Date(Date.now() + secs * 1000).toISOString();

  cancelPatience(loaded, MANAGER_NUDGE_ID);
  cancelPatience(loaded, SECRETARY_SUPERVISE_ID);

  const mgrBody = {
    id: MANAGER_NUDGE_ID,
    kind: "manager-nudge",
    renewSec: secs,
    expect: "manager idle - continue authorized seat-mesh work",
    ownerPane: mgrResolved.paneId,
    expiresAt: expires,
    senderLabel: "secretary",
    recipientLabel: "manager",
  };
  const secBody = {
    id: SECRETARY_SUPERVISE_ID,
    kind: "secretary-supervise",
    renewSec: secs,
    expect: "supervise manager continuity",
    ownerPane: secResolved.paneId,
    expiresAt: expires,
    senderLabel: "daemon",
    recipientLabel: "secretary",
  };

  armPatience(loaded, mgrBody);
  armPatience(loaded, secBody);

  armPatienceLocal(loaded.workspace, {
    id: MESH_WATCH_ID,
    kind: "mesh-watch",
    renewSec: secs,
    expect: "mesh MINI-DONE / health change / STALE thought-only minis",
    ownerPane: secResolved.paneId,
    expiresAt: expires,
    senderLabel: "inbox",
    recipientLabel: "secretary",
  });

  const brief = `SUPERVISION (Dan assigned): You supervise MASTER (manager pane ${mgrResolved.paneId}). Keep master moving without Dan saying continue. Daemon manager-nudge is ON (idle master gets CONTINUE every ${interval}). Your loop on each SUPERVISE tick: ./sm.sh contexts; read tasks/agent-seats/manager/FOCUS.md; if master idle and work remains, ./sm.sh to-master "CONTINUE: <one-line next step>". mesh-watch ON for minis. Bulk digest only — no ACK spam. Do not ping Dan for routine continue.`;

  const enq = enqueuePeer(loaded, {
    kind: "prompt",
    msg: brief,
    targetPane: secResolved.paneId,
    targetLabel: "secretary",
    fromSlot: "manager",
  });
  if (!enq?.ok) {
    try {
      injectPromptDirect(loaded, registry, "secretary", brief, { prefix: "" });
    } catch (e) {
      console.error(
        `WARN: secretary brief queued failed (${(e as Error).message}) — checkbacks armed; daemon will inject when idle`,
      );
    }
  }

  fs.writeFileSync(
    marker,
    JSON.stringify(
      {
        since: new Date().toISOString(),
        interval,
        managerPane: mgrResolved.paneId,
        secretaryPane: secResolved.paneId,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(
    `OK: secretary supervise ON interval=${interval} manager=${mgrResolved.paneId} secretary=${secResolved.paneId}`,
  );
  console.log("  manager-nudge: daemon CONTINUE when master idle");
  console.log("  secretary-supervise: secretary polls manager each tick");
  console.log("  off: ./sm.sh secretary supervise off");
}

export function secretaryStatus(loaded: LoadedProfile): void {
  const resolved = resolvePaneTarget("secretary", loaded.profile.session.name);
  if ("error" in resolved) {
    console.log("secretary: NOT RUNNING");
    console.log(`  ${resolved.error}`);
    console.log("  fix: ./sm.sh secretary start");
    return;
  }
  console.log(`secretary: pane=${resolved.paneId}`);
  const superviseOn = fs.existsSync(superviseMarkerPath(loaded.workspace));
  console.log(`  supervise: ${superviseOn ? "ON" : "OFF"}`);
  const watch = secretaryMeshWatchStatusQuiet(loaded);
  console.log(`  mesh-watch: ${watch}`);
  const health = inboxHealth(inboxPort(loaded));
  console.log(`  inbox: ${health ? "up" : "DOWN"}`);
}

/** Mechanical digest from minis.json + MINI-DONE — not OC prose. */
export function secretaryCollect(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  opts: { sendManager?: boolean; nudgeOpen?: boolean } = {},
): MiniCampaignDigest {
  const digest = buildMiniCampaignDigest(loaded);
  console.log(digest.text);

  if (opts.sendManager) {
    const session = loaded.profile.session.name;
    const base = loaded.profile.layout?.base.window;
    const mgrPane = base ? meshManagerPane(session, base) : null;
    if (mgrPane) {
      injectPromptDirect(
        loaded,
        registry,
        "manager",
        `SECRETARY-DIGEST (mechanical — do not trust chat "all done"):\n${digest.text}`,
        { manager: true },
      );
    }
  }

  if (opts.nudgeOpen && digest.openIds.length) {
    for (const id of digest.openIds) {
      try {
        miniPrompt(
          loaded,
          registry,
          id,
          `STALE: still open. File ./sm.sh mini done ${id} PASS|FAIL: <evidence> when finished — supervisor will not accept chat-only done.`,
        );
      } catch (e) {
        console.error(`nudge mini-${id} failed: ${(e as Error).message}`);
      }
    }
  }

  return digest;
}

/** Secretary dispatches all 8 minis from tasks/seat-mesh/mini-manifest.json */
export function secretaryDispatch(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
): void {
  submitPaneOp(
    loaded,
    "secretary-dispatch",
    { watchInterval: "5m" },
    "secretary dispatch (minis + mesh-watch)",
    () => {
      ensureMeshInbox(loaded, { quiet: true });
      miniSpawnAll(loaded, registry);
      secretaryMeshWatch(loaded, "on", "5m");
      console.log("OK: secretary dispatched minis + mesh-watch ON 5m");
      console.log("  collect: tasks/seat-mesh/MINI-DONE.md + ./sm.sh mini list");
    },
  );
}

function secretaryMeshWatchStatusQuiet(loaded: LoadedProfile): string {
  const health = inboxHealth(inboxPort(loaded));
  if (!health) return "inbox DOWN";
  const r = spawnSync("curl", ["-sS", `${inboxBase(loaded)}/patience?all=1`], {
    encoding: "utf8",
  });
  if (r.status !== 0) return "?";
  return (r.stdout || "").includes(MESH_WATCH_ID) ? "ON" : "OFF";
}
