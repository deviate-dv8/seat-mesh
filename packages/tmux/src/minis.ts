import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { loadAgentsState } from "./agents-state.js";
import { buildAgentLaunchCmd } from "./agent-builder.js";
import { launchSession, sendLaunch } from "./launch.js";
import { listWindowPaneIds } from "./window-panes.js";
import { resolvePaneTarget } from "./resolve-pane.js";
import { capturePaneSnapshot } from "./snapshot.js";
import { injectPromptDirect } from "./prompt.js";
import { tmux } from "./tmux-run.js";

const SECRETARY_PREFIX = "[mesh-secretary] ";
const SUPERVISOR_PREFIX = "[mesh-supervisor] ";

export interface MiniManifestEntry {
  id: number;
  role: string;
  hub: string;
  task: string;
}

export interface MiniManifest {
  campaign: string;
  supervisor: string;
  minis: MiniManifestEntry[];
}

export interface MiniRow {
  id: number;
  paneId: string;
  job_role: string;
  status: "idle" | "spawned" | "done" | "failed";
  hub: string;
  task: string;
  spawnedAt?: string;
  doneAt?: string;
  report?: string;
}

export interface MinisStateFile {
  campaign?: string;
  supervisor?: string;
  updatedAt?: string;
  minis: Record<string, MiniRow>;
}

function minisStatePath(workspace: string): string {
  return path.join(workspace, "tasks/seat-mesh/minis.json");
}

function miniDonePath(workspace: string): string {
  return path.join(workspace, "tasks/seat-mesh/MINI-DONE.md");
}

function manifestPath(workspace: string): string {
  return path.join(workspace, "tasks/seat-mesh/mini-manifest.json");
}

export function loadMinisState(workspace: string): MinisStateFile {
  const p = minisStatePath(workspace);
  if (!fs.existsSync(p)) {
    return { minis: {} };
  }
  return JSON.parse(fs.readFileSync(p, "utf8")) as MinisStateFile;
}

export function saveMinisState(workspace: string, state: MinisStateFile): void {
  const p = minisStatePath(workspace);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + "\n");
}

export function loadMiniManifest(workspace: string): MiniManifest {
  const p = manifestPath(workspace);
  if (!fs.existsSync(p)) {
    throw new Error(`missing ${p} — supervisor must write mini-manifest.json first`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8")) as MiniManifest;
}

function miniPaneId(loaded: LoadedProfile, n: number): string | null {
  const layout = loaded.profile.layout;
  if (!layout) return null;
  const panes = listWindowPaneIds(loaded.profile.session.name, layout.minis.window);
  return panes[n - 1] ?? null;
}

function sleepMs(ms: number): void {
  spawnSync("sleep", [String(ms / 1000)]);
}

function ensureMiniCli(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  n: number,
): string {
  const paneId = miniPaneId(loaded, n);
  if (!paneId) throw new Error(`mini-${n} pane missing`);

  const snap = capturePaneSnapshot(paneId);
  const live = snap ? registry.detect(snap) : null;

  if (!live) {
    const agents = loadAgentsState(loaded.workspace, loaded.profile.state.agentsJson);
    const harnessType =
      agents.conventions?.mini_default_cli ??
      agents.conventions?.secretary_default_cli ??
      "opencode";
    const type = harnessType === "cursor-agent" ? "agent" : harnessType;
    const cmd = buildAgentLaunchCmd(type, loaded.workspace, null);
    if (!cmd) throw new Error(`no launch cmd for mini type ${type}`);
    sendLaunch(paneId, cmd);
    sleepMs(type === "opencode" ? 4000 : 2500);

    const reSnap = capturePaneSnapshot(paneId);
    const reLive = reSnap ? registry.detect(reSnap) : null;
    if (!reLive) {
      sendLaunch(paneId, cmd);
      sleepMs(6000);
      const finalSnap = capturePaneSnapshot(paneId);
      const finalLive = finalSnap ? registry.detect(finalSnap) : null;
      if (!finalLive) {
        throw new Error(
          `mini-${n} pane ${paneId} failed to start CLI after 2 launch attempts — still plain_shell`,
        );
      }
    }
  }
  return paneId;
}

export function listMinis(loaded: LoadedProfile): MiniRow[] {
  const state = loadMinisState(loaded.workspace);
  const max = loaded.profile.session.miniMax;
  const rows: MiniRow[] = [];
  for (let n = 1; n <= max; n++) {
    const key = String(n);
    const paneId = miniPaneId(loaded, n) ?? "?";
    const saved = state.minis[key];
    if (saved) {
      rows.push({ ...saved, paneId: saved.paneId || paneId });
    } else {
      rows.push({
        id: n,
        paneId,
        job_role: "-",
        status: "idle",
        hub: "-",
        task: "",
      });
    }
  }
  return rows;
}

export interface MiniCampaignDigest {
  campaign: string;
  done: number;
  open: number;
  failed: number;
  total: number;
  allDone: boolean;
  openIds: number[];
  recentDone: string[];
  text: string;
}

/** Mechanical campaign status — secretary must not invent "all done" without this. */
export function buildMiniCampaignDigest(loaded: LoadedProfile): MiniCampaignDigest {
  const state = loadMinisState(loaded.workspace);
  const total = loaded.profile.session.miniMax;
  const rows = listMinis(loaded);
  let done = 0;
  let open = 0;
  let failed = 0;
  const openIds: number[] = [];
  for (const r of rows) {
    if (r.status === "done") done++;
    else if (r.status === "failed") failed++;
    else {
      open++;
      openIds.push(r.id);
    }
  }
  const allDone = open === 0 && failed === 0 && done >= total;

  const donePath = miniDonePath(loaded.workspace);
  let recentDone: string[] = [];
  if (fs.existsSync(donePath)) {
    recentDone = fs
      .readFileSync(donePath, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("mini-"))
      .slice(-8);
  }

  const lines = [
    `CAMPAIGN ${state.campaign ?? "?"}: ${done}/${total} done, ${open} open, ${failed} failed`,
    allDone ? "STATUS: COMPLETE (mechanical)" : `STATUS: INCOMPLETE — open mini(s): ${openIds.join(", ") || "none"}`,
    "",
    "Recent MINI-DONE:",
    ...(recentDone.length ? recentDone : ["(none)"]),
  ];
  if (openIds.length) {
    lines.push("", "Still spawned (no done or stale):");
    for (const id of openIds) {
      const r = rows.find((x) => x.id === id);
      lines.push(`  mini-${id} hub=${r?.hub ?? "?"} ${(r?.task ?? "").slice(0, 100)}`);
    }
  }

  return {
    campaign: state.campaign ?? "?",
    done,
    open,
    failed,
    total,
    allDone,
    openIds,
    recentDone,
    text: lines.join("\n"),
  };
}

export function printMiniList(loaded: LoadedProfile): void {
  for (const r of listMinis(loaded)) {
    console.log(
      `mini-${r.id}\t${r.paneId}\t${r.status}\trole=${r.job_role}\thub=${r.hub}\t${r.task.slice(0, 72)}`,
    );
  }
}

export interface MiniSpawnOptions {
  /** Secretary inject prefix (default true for dispatch). */
  viaSecretary?: boolean;
  hub?: string;
  skipState?: boolean;
}

export function miniSpawn(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  n: number,
  role: string,
  task: string,
  opts: MiniSpawnOptions = {},
): void {
  if (n < 1 || n > loaded.profile.session.miniMax) {
    throw new Error(`mini id must be 1-${loaded.profile.session.miniMax}`);
  }

  const paneId = ensureMiniCli(loaded, registry, n);
  const prefix = opts.viaSecretary === false ? SUPERVISOR_PREFIX : SECRETARY_PREFIX;
  const brief = `${prefix}MINI-TASK id=${n} role=${role}: ${task}

You are mini-${n} in session mesh (NOT a worker seat, NOT dev harness). Code only under seat-mesh/ and tasks/seat-mesh/. When done: ./sm.sh mini done ${n} PASS|FAIL: <evidence>. Then stop.`;

  injectPromptDirect(loaded, registry, `mini-${n}`, brief, { prefix: "" });

  if (!opts.skipState) {
    const state = loadMinisState(loaded.workspace);
    state.campaign = state.campaign ?? "sm-parity";
    state.minis[String(n)] = {
      id: n,
      paneId,
      job_role: role,
      status: "spawned",
      hub: opts.hub ?? "-",
      task,
      spawnedAt: new Date().toISOString(),
    };
    saveMinisState(loaded.workspace, state);
  }

  console.log(`OK: spawned mini-${n} role=${role} pane=${paneId}`);
}

export function miniPrompt(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  n: number,
  text: string,
): void {
  injectPromptDirect(loaded, registry, `mini-${n}`, text, { prefix: SECRETARY_PREFIX });
  console.log(`OK: prompt mini-${n}`);
}

export function miniDone(
  loaded: LoadedProfile,
  n: number,
  report: string,
): void {
  const state = loadMinisState(loaded.workspace);
  const key = String(n);
  const row = state.minis[key];
  const paneId = miniPaneId(loaded, n) ?? row?.paneId ?? "?";
  const line = `${new Date().toISOString()} mini-${n} ${report}`;
  fs.mkdirSync(path.dirname(miniDonePath(loaded.workspace)), { recursive: true });
  fs.appendFileSync(miniDonePath(loaded.workspace), line + "\n");

  state.minis[key] = {
    id: n,
    paneId,
    job_role: row?.job_role ?? "?",
    status: report.trim().toUpperCase().startsWith("PASS") ? "done" : "failed",
    hub: row?.hub ?? "-",
    task: row?.task ?? "",
    spawnedAt: row?.spawnedAt,
    doneAt: new Date().toISOString(),
    report,
  };
  saveMinisState(loaded.workspace, state);

  const mgr = resolvePaneTarget("manager", loaded.profile.session.name);
  if (!("error" in mgr)) {
    tmux([
      "display-message",
      "-t",
      mgr.paneId,
      `MINI-DONE mini-${n}: ${report.slice(0, 120)}`,
    ]);
  }

  console.log(`OK: mini done ${n} — ${report.slice(0, 80)}`);
}

export function miniSpawnAll(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  manifest?: MiniManifest,
): void {
  const m = manifest ?? loadMiniManifest(loaded.workspace);
  const state = loadMinisState(loaded.workspace);
  state.campaign = m.campaign;
  state.supervisor = m.supervisor;
  saveMinisState(loaded.workspace, state);

  launchSession(loaded, { targets: ["minis"] });
  sleepMs(5000);

  const max = loaded.profile.layout?.minis.max ?? loaded.profile.session.miniMax;
  let dispatched = 0;
  for (const entry of m.minis) {
    if (entry.id > max) {
      console.log(`SKIP mini-${entry.id}: profile max=${max} (${loaded.profile.layout?.minis.grid ?? "grid"})`);
      continue;
    }
    try {
      miniSpawn(loaded, registry, entry.id, entry.role, entry.task, {
        viaSecretary: true,
        hub: entry.hub,
      });
      dispatched++;
      sleepMs(800);
    } catch (e) {
      console.error(`FAIL mini-${entry.id}: ${(e as Error).message}`);
    }
  }
  console.log(`--- dispatched ${dispatched}/${m.minis.length} minis campaign=${m.campaign} max=${max}`);
}
