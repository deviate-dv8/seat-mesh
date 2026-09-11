import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LoadedProfile } from "@seat-mesh/core";

/** Mesh-owned daemon — NOT harness :3099 / scripts/inbox-server.mjs */
const DEFAULT_PORT = 3100;

function inboxBase(port = DEFAULT_PORT): string {
  return `http://127.0.0.1:${port}`;
}

function meshDaemonPaths(workspace: string) {
  const stateDir = path.join(workspace, "tasks/seat-mesh/daemon");
  return {
    stateDir,
    metaPath: path.join(stateDir, "mesh-inbox.json"),
    logPath: path.join(stateDir, "mesh-inbox.log"),
    serverJs: path.join(workspace, "seat-mesh/packages/daemon/dist/mesh-inbox-server.js"),
    profileDir: path.join(workspace, "seat-mesh/profiles/zsign"),
  };
}

export function meshInboxPort(loaded: LoadedProfile): number {
  return loaded.profile.daemon?.port ?? DEFAULT_PORT;
}

export function inboxHealth(port = DEFAULT_PORT): Record<string, unknown> | null {
  const r = spawnSync("curl", ["-sS", "-m", "2", `${inboxBase(port)}/health`], {
    encoding: "utf8",
  });
  if (r.status !== 0 || !r.stdout?.trim()) return null;
  try {
    return JSON.parse(r.stdout) as Record<string, unknown>;
  } catch {
    return { raw: r.stdout.trim() };
  }
}

export interface InboxStartOptions {
  /** Engine path: no JSON dump, one line max. */
  quiet?: boolean;
}

export interface SendToMasterOptions {
  from?: string;
  slot?: string;
  ports?: string;
}

/** Enqueue a to-master row (INBOX.jsonl). Enqueue only — no pane inject (daemon owns inject).
 * Returns the parsed daemon response, or null when the daemon is down / errors. */
export type PeerEnqueueKind = "to-slot" | "to-mini" | "prompt" | "remind";

export interface EnqueuePeerOptions {
  kind: PeerEnqueueKind;
  msg: string;
  targetPane: string;
  targetLabel: string;
  fromSlot?: string;
  fromPorts?: string | null;
}

/** Enqueue peer/coord delivery (daemon injects when target pane idle). */
export function enqueuePeer(
  loaded: LoadedProfile,
  opts: EnqueuePeerOptions,
): Record<string, unknown> | null {
  ensureMeshInbox(loaded, { quiet: true });
  const port = meshInboxPort(loaded);
  const r = spawnSync(
    "curl",
    [
      "-sS",
      "-m",
      "5",
      "-X",
      "POST",
      `${inboxBase(port)}/to-peer`,
      "-H",
      "Content-Type: application/json",
      "-d",
      JSON.stringify({
        kind: opts.kind,
        fromSlot: opts.fromSlot ?? "manager",
        fromPorts: opts.fromPorts ?? null,
        targetPane: opts.targetPane,
        targetLabel: opts.targetLabel,
        msg: opts.msg,
      }),
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout || "{}") as Record<string, unknown>;
  } catch {
    return { raw: r.stdout };
  }
}

export function sendToMaster(
  loaded: LoadedProfile,
  msg: string,
  opts: SendToMasterOptions = {},
): Record<string, unknown> | null {
  ensureMeshInbox(loaded, { quiet: true });
  const port = meshInboxPort(loaded);
  const r = spawnSync(
    "curl",
    [
      "-sS",
      "-m",
      "5",
      "-X",
      "POST",
      `${inboxBase(port)}/to-master`,
      "-H",
      "Content-Type: application/json",
      "-d",
      JSON.stringify({ msg, from: opts.from, slot: opts.slot, ports: opts.ports }),
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout || "{}") as Record<string, unknown>;
  } catch {
    return { raw: r.stdout };
  }
}

function autoStartEnabled(loaded: LoadedProfile): boolean {
  return loaded.profile.daemon?.autoStart !== false;
}

export function meshInboxStatusLine(
  loaded: LoadedProfile,
  h: Record<string, unknown> | null,
): string {
  const port = meshInboxPort(loaded);
  if (!h || h.engine !== "seat-mesh-daemon") {
    return `inbox: DOWN (:${port})`;
  }
  return [
    "inbox: up",
    `:${port}`,
    `session=${String(h.session ?? "?")}`,
    `workers=${String(h.workerPanes ?? "?")}`,
    `minis=${String(h.miniPanes ?? "?")}`,
    `ocLimit=${String(h.ocLimitActive ?? 0)}`,
    `checkback=${String(h.checkbackActive ?? 0)}`,
  ].join(" ");
}

export function printMeshInboxStatus(
  loaded: LoadedProfile,
  opts: { json?: boolean } = {},
): boolean {
  const port = meshInboxPort(loaded);
  const h = inboxHealth(port);
  const ok = Boolean(h && h.engine === "seat-mesh-daemon");
  if (opts.json) {
    if (!h) {
      console.log(JSON.stringify({ ok: false, port, engine: null }, null, 2));
    } else {
      console.log(JSON.stringify(h, null, 2));
    }
    return ok;
  }
  console.log(meshInboxStatusLine(loaded, h));
  if (ok && h?.stateDir) {
    console.log(`  state: ${String(h.stateDir)}`);
  }
  if (!ok) {
    console.log(`  log: ${meshDaemonPaths(loaded.workspace).logPath}`);
  }
  return ok;
}

/** Idempotent — start mesh inbox if down. Part of engine (session/reload), not manual ops. */
export function ensureMeshInbox(
  loaded: LoadedProfile,
  opts: InboxStartOptions = {},
): boolean {
  if (!autoStartEnabled(loaded)) return false;
  const port = meshInboxPort(loaded);
  const existing = inboxHealth(port);
  if (existing?.engine === "seat-mesh-daemon") return true;
  if (existing) {
    if (!opts.quiet) {
      throw new Error(
        `port :${port} answered but not seat-mesh-daemon (engine=${String(existing.engine ?? "?")})`,
      );
    }
    return false;
  }
  try {
    startMeshInbox(loaded, opts);
    return true;
  } catch {
    return false;
  }
}

export function startMeshInbox(
  loaded: LoadedProfile,
  opts: InboxStartOptions = {},
): void {
  const port = meshInboxPort(loaded);
  const { logPath, serverJs, profileDir } = meshDaemonPaths(loaded.workspace);

  const existing = inboxHealth(port);
  if (existing?.engine === "seat-mesh-daemon") {
    if (!opts.quiet) {
      console.log(`mesh-inbox already up session=${String(existing.session ?? "?")}`);
    }
    return;
  }
  if (existing) {
    throw new Error(
      `port :${port} answered but not seat-mesh-daemon (engine=${String(existing.engine ?? "?")}) — pick another daemon.port`,
    );
  }

  if (!fs.existsSync(serverJs)) {
    throw new Error(`missing ${serverJs} — run: ./sm.sh reload`);
  }

  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  const r = spawnSync(
    "bash",
    [
      "-c",
      `setsid -f node "${serverJs}" --profile "${profileDir}" >>"${logPath}" 2>&1`,
    ],
    { cwd: loaded.workspace, stdio: opts.quiet ? "ignore" : "inherit" },
  );
  if (r.status !== 0) {
    throw new Error(`mesh-inbox start failed (exit ${r.status ?? 1})`);
  }

  for (let i = 0; i < 25; i++) {
    const h = inboxHealth(port);
    if (h?.engine === "seat-mesh-daemon") {
      if (opts.quiet) {
        console.log(meshInboxStatusLine(loaded, h));
      } else {
        console.log(`OK: mesh-inbox on :${port} session=${loaded.profile.session.name}`);
        console.log(JSON.stringify(h, null, 2));
      }
      return;
    }
    spawnSync("sleep", ["0.2"]);
  }
  throw new Error(`mesh-inbox did not become healthy on ${inboxBase(port)} (see ${logPath})`);
}

export function stopMeshInbox(loaded: LoadedProfile): void {
  const port = meshInboxPort(loaded);
  const { metaPath } = meshDaemonPaths(loaded.workspace);

  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as { pid?: number };
      if (meta.pid) {
        spawnSync("kill", [String(meta.pid)]);
        spawnSync("sleep", ["0.3"]);
        spawnSync("kill", ["-9", String(meta.pid)]);
      }
    } catch {
      /* ignore */
    }
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  }

  const h = inboxHealth(port);
  if (h?.engine === "seat-mesh-daemon") {
    console.log("WARN: mesh-inbox still answering /health");
  } else {
    console.log("OK: mesh-inbox stopped");
  }
}

export function restartMeshInbox(loaded: LoadedProfile): void {
  stopMeshInbox(loaded);
  spawnSync("sleep", ["0.5"]);
  startMeshInbox(loaded);
}
