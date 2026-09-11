#!/usr/bin/env node
/**
 * seat-mesh inbox daemon — TypeScript only. Does NOT use scripts/inbox-server.mjs.
 * Default port 3100 (harness legacy inbox stays on 3099 if running).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadProfile } from "@seat-mesh/core";
import { createBuiltinRegistry } from "@seat-mesh/providers";
import {
  capturePaneSnapshot,
  listMeshMonitorPanes,
  listMeshWorkers,
  listMeshMinis,
  meshSecretaryPane,
} from "@seat-mesh/tmux";
import {
  startBullmqRuntime,
  enqueueDrainTick,
  enqueueInboxRow,
  enqueuePeerRow,
  type BullmqRuntime,
} from "./bullmq-runtime.js";
import { JsonlStore, type CheckbackRow } from "./jsonl-store.js";
import { orchestratorDrainTick, type MeshOrchestratorCtx } from "./mesh-orchestrator.js";
import {
  drainPaneOpsOnce,
  enqueuePaneOp,
  queueAheadCount,
  type PaneOpsDrainCtx,
} from "./pane-ops-drain.js";
import type { PaneOpKind } from "@seat-mesh/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(): { profilePath?: string } {
  const out: { profilePath?: string } = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--profile" && argv[i + 1]) out.profilePath = argv[++i];
  }
  return out;
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, null, 2) + "\n");
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function main(): Promise<void> {
  const { profilePath } = parseArgs();
  const loaded = loadProfile(profilePath);
  const profile = loaded.profile;
  const meshLayout = profile.layout;
  if (!meshLayout) {
    console.error("mesh-inbox: profile missing layout");
    process.exit(1);
  }
  const baseWindow = meshLayout.base.window;
  const workersWindow = meshLayout.workers.window;
  const minisWindow = meshLayout.minis.window;

  const session = profile.session.name;
  const port = profile.daemon?.port ?? 3100;
  const pollMs = profile.daemon?.pollMs ?? 4000;
  const redisUrl = profile.orchestrator?.redisUrl ?? "redis://127.0.0.1:6379";
  const workspace = loaded.workspace;
  const stateDir = path.join(workspace, "tasks/seat-mesh/daemon");
  const metaPath = path.join(stateDir, "mesh-inbox.json");
  const logPath = path.join(stateDir, "mesh-inbox.log");

  const store = new JsonlStore(stateDir);
  const registry = createBuiltinRegistry(profile.providers);
  const ocLimited = new Set<string>();
  let monitorPanes: Array<{ paneId: string; label: string }> = [];
  let monitorPaneCursor = 0;
  let pollBusy = false;
  let paneOpBusy = false;
  let bullmq: BullmqRuntime | null = null;
  let healthSnap = {
    workerPanes: 0,
    miniPanes: 0,
    secretaryPane: null as string | null,
    updatedAt: 0,
  };

  function refreshHealthSnap(): void {
    healthSnap = {
      workerPanes: listMeshWorkers(session, workersWindow).length,
      miniPanes: listMeshMinis(session, minisWindow).length,
      secretaryPane: meshSecretaryPane(session, baseWindow),
      updatedAt: Date.now(),
    };
  }

  function log(line: string): void {
    const row = `${new Date().toISOString()} ${line}\n`;
    fs.appendFileSync(logPath, row);
  }

  const paneOpsCtx: PaneOpsDrainCtx = {
    loaded,
    registry,
    store,
    log,
    isBusy: () => paneOpBusy,
    setBusy: (v) => {
      paneOpBusy = v;
    },
  };

  const orchCtx: MeshOrchestratorCtx = {
    loaded,
    registry,
    store,
    session,
    baseWindow,
    workersWindow,
    minisWindow,
    log,
    ocLimitedPaneIds: ocLimited,
    paneOps: paneOpsCtx,
  };

  function drainPaneOpsChain(): void {
    for (let i = 0; i < 12; i++) {
      if (!drainPaneOpsOnce(paneOpsCtx)) break;
    }
  }

  async function runDrain(): Promise<void> {
    orchestratorDrainTick(orchCtx);
  }

  bullmq = await startBullmqRuntime(
    redisUrl,
    async (data) => {
      if (data.op === "drain-tick" || data.op === "inbox-row" || data.op === "peer-row") {
        await runDrain();
      }
    },
    log,
  );

  function scheduleDrain(): void {
    if (bullmq) {
      void enqueueDrainTick(bullmq.injectQueue).catch((e) => {
        log(`enqueue drain-tick error ${(e as Error).message} — poll fallback`);
        runDrain();
      });
    } else {
      runDrain();
    }
  }

  async function enqueueAfterAppend(kind: "inbox" | "peer", rowId: string): Promise<void> {
    if (!bullmq) {
      scheduleDrain();
      return;
    }
    try {
      if (kind === "inbox") await enqueueInboxRow(bullmq.injectQueue, rowId);
      else await enqueuePeerRow(bullmq.injectQueue, rowId);
    } catch (e) {
      log(`enqueue ${kind}-row error ${(e as Error).message} — poll fallback`);
      scheduleDrain();
    }
  }

  function runCpeProxyUp(): void {
    const sh = path.join(workspace, "scripts/cpe-proxy-up.sh");
    if (!fs.existsSync(sh)) return;
    spawnSync("bash", [sh], { cwd: workspace, stdio: "ignore" });
  }

  function resumeOpenCodePanes(): void {
    for (const { paneId } of listMeshMonitorPanes(
      session,
      baseWindow,
      workersWindow,
      minisWindow,
    )) {
      const snap = capturePaneSnapshot(paneId);
      if (!snap) continue;
      const prov = registry.detect(snap);
      if (prov?.id !== "opencode") continue;
      spawnSync("tmux", ["send-keys", "-t", paneId, "Escape"], { encoding: "utf8" });
      spawnSync("tmux", ["send-keys", "-t", paneId, "resume"], { encoding: "utf8" });
      spawnSync("tmux", ["send-keys", "-t", paneId, "Enter"], { encoding: "utf8" });
    }
  }

  function refreshMonitorPanes(): void {
    monitorPanes = listMeshMonitorPanes(session, baseWindow, workersWindow, minisWindow);
    if (monitorPaneCursor >= monitorPanes.length) monitorPaneCursor = 0;
  }

  function pollOcLimitsTick(): void {
    if (!monitorPanes.length) refreshMonitorPanes();
    if (!monitorPanes.length) return;

    const batch = Math.min(2, monitorPanes.length);
    let anyLimit = false;
    for (let i = 0; i < batch; i++) {
      const idx = (monitorPaneCursor + i) % monitorPanes.length;
      const { paneId, label } = monitorPanes[idx];
      const snap = capturePaneSnapshot(paneId);
      if (!snap) continue;
      const prov = registry.detect(snap);
      if (prov?.id !== "opencode") continue;
      const state = prov.composerState(snap);
      const limited = state.phase === "limit";
      if (!limited) {
        ocLimited.delete(paneId);
        continue;
      }
      anyLimit = true;
      const rising = !ocLimited.has(paneId);
      ocLimited.add(paneId);
      if (rising) {
        log(`OC-LIMIT rising edge ${label} ${paneId} kind=${state.limitKind ?? "?"}`);
      }
      spawnSync("tmux", [
        "set-option",
        "-p",
        "-t",
        paneId,
        "@mesh_status",
        `OC-LIMIT:${state.limitKind ?? "limit"}`,
      ]);
    }
    monitorPaneCursor = (monitorPaneCursor + batch) % monitorPanes.length;
    if (monitorPaneCursor === 0) refreshMonitorPanes();

    if (anyLimit || ocLimited.size > 0) {
      runCpeProxyUp();
      if (anyLimit) resumeOpenCodePanes();
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, {
          ok: true,
          engine: "seat-mesh-daemon",
          session,
          port,
          pid: process.pid,
          bullmq: Boolean(bullmq),
          redisUrl,
          workerPanes: healthSnap.workerPanes,
          miniPanes: healthSnap.miniPanes,
          secretaryPane: healthSnap.secretaryPane,
          ocLimitActive: ocLimited.size,
          checkbackActive: store.readCheckbacks().filter((r) => r.status === "active").length,
          inboxUnresolved: store.readInbox().filter((r) => !r.resolved).length,
          peerUnsent: store.readPeer().filter((r) => !r.sent).length,
          paneOpsPending: store.countPaneOpsPending(),
          paneOpBusy,
          stateDir,
        });
      }

      if (req.method === "GET" && url.pathname === "/pane-ops") {
        const rows = store.readPaneOps().slice(-40);
        return json(res, 200, { ok: true, rows, pending: store.countPaneOpsPending(), paneOpBusy });
      }

      if (req.method === "POST" && url.pathname === "/pane-ops") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as {
          kind?: PaneOpKind;
          who?: string;
          summary?: string;
          payload?: Record<string, unknown>;
        };
        const kind = body.kind;
        if (!kind) return json(res, 400, { ok: false, error: "kind required" });
        const ahead = queueAheadCount(store);
        const row = enqueuePaneOp(
          store,
          kind,
          String(body.who ?? "unknown"),
          String(body.summary ?? kind),
          body.payload ?? {},
        );
        log(`PANE-OP queued ${row.id.slice(0, 8)} ${kind} who=${row.who} ahead=${ahead}`);
        drainPaneOpsChain();
        const updated = store.readPaneOps().find((r) => r.id === row.id) ?? row;
        return json(res, 200, {
          ok: true,
          entry: updated,
          queueAhead: Math.max(0, ahead),
        });
      }

      if (req.method === "GET" && url.pathname === "/patience") {
        const all = url.searchParams.get("all") === "1";
        let rows = store.readCheckbacks();
        if (!all) rows = rows.filter((r) => r.status === "active");
        return json(res, 200, { entries: rows });
      }

      if (req.method === "POST" && url.pathname === "/patience") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as Partial<CheckbackRow>;
        const now = new Date().toISOString();
        const row: CheckbackRow = {
          id: String(body.id ?? `cb-${Date.now()}`),
          kind: String(body.kind ?? "checkback"),
          status: "active",
          renewSec: body.renewSec,
          expect: body.expect,
          ownerPane: body.ownerPane,
          expiresAt: body.expiresAt,
          senderLabel: body.senderLabel,
          recipientLabel: body.recipientLabel,
          createdAt: now,
          updatedAt: now,
        };
        store.upsertCheckback(row);
        return json(res, 200, { ok: true, entry: row });
      }

      const cancelMatch = /^\/patience\/([^/]+)\/cancel$/.exec(url.pathname);
      if (req.method === "POST" && cancelMatch) {
        const id = decodeURIComponent(cancelMatch[1]);
        store.cancelCheckback(id);
        return json(res, 200, { ok: true, cancelled: id });
      }

      if (req.method === "POST" && url.pathname === "/to-peer") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as Partial<import("./jsonl-store.js").PeerRow>;
        const msg = String(body.msg ?? "").trim();
        const targetPane = String(body.targetPane ?? "").trim();
        const kindRaw = String(body.kind ?? "to-slot");
        const kind: import("./jsonl-store.js").PeerKind =
          kindRaw === "to-mini" || kindRaw === "prompt" || kindRaw === "remind"
            ? kindRaw
            : "to-slot";
        if (!msg || !targetPane.startsWith("%")) {
          return json(res, 400, { ok: false, error: "msg and targetPane required" });
        }
        const now = new Date().toISOString();
        const row: import("./jsonl-store.js").PeerRow = {
          id: crypto.randomUUID(),
          at: now,
          kind,
          fromSlot: String(body.fromSlot ?? "?"),
          fromPorts: body.fromPorts != null ? String(body.fromPorts) : null,
          targetPane,
          targetLabel: String(body.targetLabel ?? targetPane),
          msg,
          sent: false,
        };
        store.appendPeer(row);
        log(`TO-PEER ${kind} from=slot-${row.fromSlot} -> ${row.targetLabel}`);
        await enqueueAfterAppend("peer", row.id);
        return json(res, 200, { ok: true, entry: row });
      }

      if (req.method === "POST" && url.pathname === "/to-master") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as {
          msg?: string;
          message?: string;
          from?: string;
          slot?: string;
          ports?: string;
        };
        const msg = String(body.msg ?? body.message ?? "").trim();
        if (!msg) return json(res, 400, { ok: false, error: "msg required" });
        const now = new Date().toISOString();
        const row = {
          id: crypto.randomUUID(),
          at: now,
          from: body.from || "worker",
          slot: body.slot != null ? String(body.slot) : null,
          ports: body.ports || null,
          msg,
          sent: false,
          resolved: false,
          read: false,
        };
        store.appendInbox(row);
        log(`TO-MASTER from=${row.from} slot=${row.slot ?? "-"} :: ${msg}`);
        await enqueueAfterAppend("inbox", row.id);
        return json(res, 200, { ok: true, entry: row });
      }

      return json(res, 404, { error: "not found" });
    } catch (e) {
      return json(res, 500, { error: (e as Error).message });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        {
          pid: process.pid,
          port,
          session,
          bullmq: Boolean(bullmq),
          redisUrl,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
    log(`listening :${port} session=${session} bullmq=${Boolean(bullmq)}`);
    console.log(
      `mesh-inbox: listening http://127.0.0.1:${port} session=${session} bullmq=${Boolean(bullmq)}`,
    );
  });

  refreshMonitorPanes();
  refreshHealthSnap();
  setInterval(() => {
    if (pollBusy) return;
    pollBusy = true;
    setImmediate(() => {
      try {
        pollOcLimitsTick();
        scheduleDrain();
        refreshHealthSnap();
      } catch (e) {
        log(`poll error ${(e as Error).message}`);
      } finally {
        pollBusy = false;
      }
    });
  }, pollMs);

  process.on("SIGTERM", () => {
    void bullmq?.close().finally(() => process.exit(0));
  });
}

void main().catch((e) => {
  console.error(`mesh-inbox fatal: ${(e as Error).message}`);
  process.exit(1);
});
