import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import {
  buildMiniCampaignDigest,
  capturePaneSnapshot,
  meshManagerPane,
} from "@seat-mesh/tmux";
import { paintMeshBorders } from "./border-paint.js";
import { deliverToPane } from "./inject-delivery.js";
import type { JsonlStore } from "./jsonl-store.js";
import { drainPaneOpsOnce, type PaneOpsDrainCtx } from "./pane-ops-drain.js";

export interface MeshOrchestratorCtx {
  loaded: LoadedProfile;
  registry: ProviderRegistry;
  store: JsonlStore;
  session: string;
  baseWindow: string;
  workersWindow: string;
  minisWindow: string;
  log: (line: string) => void;
  ocLimitedPaneIds: Set<string>;
  paneOps?: PaneOpsDrainCtx;
}

export interface DrainTickResult {
  attempted: number;
  delivered: number;
  held: number;
}

export function drainInboxOnce(ctx: MeshOrchestratorCtx): DrainTickResult {
  const rows = ctx.store.readInbox();
  const row = rows.find((r) => !r.sent && !r.resolved);
  if (!row) return { attempted: 0, delivered: 0, held: 0 };

  const mgrPane = meshManagerPane(ctx.session, ctx.baseWindow);
  if (!mgrPane) return { attempted: 0, delivered: 0, held: 0 };

  const result = deliverToPane(mgrPane, ctx.store.formatInboxInject(row), ctx.registry);
  if (!result.ok) {
    return { attempted: 1, delivered: 0, held: 1 };
  }
  row.sent = true;
  ctx.store.writeInbox(rows);
  ctx.log(
    `INBOX inject id=${row.id} slot=${row.slot ?? "-"} provider=${result.providerId} mode=${result.mode}`,
  );
  return { attempted: 1, delivered: 1, held: 0 };
}

export function drainPeerOnce(ctx: MeshOrchestratorCtx): DrainTickResult {
  const rows = ctx.store.readPeer();
  const row = rows.find((r) => !r.sent);
  if (!row) return { attempted: 0, delivered: 0, held: 0 };

  const result = deliverToPane(row.targetPane, row.msg, ctx.registry);
  if (!result.ok) {
    return { attempted: 1, delivered: 0, held: 1 };
  }
  row.sent = true;
  ctx.store.writePeer(rows);
  const from =
    row.kind === "prompt" || row.kind === "remind"
      ? row.fromSlot
      : `slot-${row.fromSlot}`;
  ctx.log(
    `PEER inject ${row.kind} -> ${row.targetLabel} from ${from} provider=${result.providerId} mode=${result.mode}`,
  );
  return { attempted: 1, delivered: 1, held: 0 };
}

export function fireDueCheckbacks(ctx: MeshOrchestratorCtx): void {
  const now = Date.now();
  const rows = ctx.store.readCheckbacks();
  for (const row of rows) {
    if (row.status !== "active") continue;
    const exp = row.expiresAt ? Date.parse(row.expiresAt) : 0;
    if (!exp || exp > now) continue;
    const pane = row.ownerPane;
    if (!pane) continue;

    if (row.kind === "mesh-watch") {
      const digest = buildMiniCampaignDigest(ctx.loaded);
      if (digest.allDone) {
        row.status = "cancelled";
        row.updatedAt = new Date().toISOString();
        ctx.log(`mesh-watch AUTO-OFF campaign complete ${digest.done}/${digest.total}`);
        continue;
      }
      const mgrPane = meshManagerPane(ctx.session, ctx.baseWindow);
      const digestBlock = `[mesh-inbox] SECRETARY-DIGEST (mechanical)\n${digest.text}`;
      if (mgrPane) {
        deliverToPane(mgrPane, digestBlock, ctx.registry);
      }
      const secMsg = `[mesh-inbox] INCOMPLETE ${digest.done}/${digest.total} open=[${digest.openIds.join(",")}] — run ./sm.sh secretary collect --nudge`;
      deliverToPane(pane, secMsg, ctx.registry);
      ctx.log(`mesh-watch digest done=${digest.done}/${digest.total} open=${digest.openIds.join(",") || "none"}`);
    } else if (row.kind === "manager-nudge") {
      const mgrPane =
        pane || meshManagerPane(ctx.session, ctx.baseWindow) || undefined;
      if (mgrPane) {
        const snap = capturePaneSnapshot(mgrPane);
        const prov = snap ? ctx.registry.detect(snap) : null;
        const state = prov && snap ? prov.composerState(snap) : null;
        const idle =
          !state ||
          state.phase === "empty" ||
          state.phase === "afk" ||
          state.phase === "plain_shell";
        if (idle) {
          const msg =
            "[mesh-inbox] CONTINUE (secretary-supervised): Read tasks/agent-seats/manager/FOCUS.md NOW + seat-mesh/TODO.md; execute the next authorized slice without stopping for Dan yes/continue. Secretary owns continuity — keep going.";
          const r = deliverToPane(mgrPane, msg, ctx.registry);
          ctx.log(
            `manager-nudge ${r.ok ? "delivered" : `held:${r.reason}`} pane=${mgrPane}`,
          );
        } else {
          ctx.log(
            `manager-nudge skip (phase=${state?.phase ?? "?"}) pane=${mgrPane}`,
          );
        }
      }
    } else if (row.kind === "secretary-supervise") {
      const secMsg =
        "[mesh-inbox] SUPERVISE: Check manager (./sm.sh contexts). If master border is idle/AFK/empty and manager/FOCUS has open work, ./sm.sh to-master \"CONTINUE: <one-line next step>\". Do not ping Dan for routine continue.";
      const r = deliverToPane(pane, secMsg, ctx.registry);
      ctx.log(
        `secretary-supervise ${r.ok ? "delivered" : `held:${r.reason}`} pane=${pane}`,
      );
    } else {
      const msg = `[mesh-inbox] Check: ${row.expect ?? row.kind}`;
      const r = deliverToPane(pane, msg, ctx.registry);
      if (!r.ok) continue;
    }

    if (row.renewSec && row.renewSec > 0) {
      row.expiresAt = new Date(now + row.renewSec * 1000).toISOString();
      row.updatedAt = new Date().toISOString();
    } else {
      row.status = "cancelled";
      row.updatedAt = new Date().toISOString();
    }
  }
  ctx.store.writeCheckbacks(rows);
}

export function orchestratorDrainTick(ctx: MeshOrchestratorCtx): DrainTickResult {
  if (ctx.paneOps) {
    drainPaneOpsOnce(ctx.paneOps);
  }
  const a = drainInboxOnce(ctx);
  const b = drainPeerOnce(ctx);
  fireDueCheckbacks(ctx);
  paintMeshBorders(
    ctx.loaded,
    ctx.registry,
    ctx.store,
    ctx.session,
    ctx.baseWindow,
    ctx.workersWindow,
    ctx.minisWindow,
    ctx.ocLimitedPaneIds,
  );
  return {
    attempted: a.attempted + b.attempted,
    delivered: a.delivered + b.delivered,
    held: a.held + b.held,
  };
}
