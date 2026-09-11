# Agent comms path

**Command picker:** [ONE-PATH.md](ONE-PATH.md) — use that table first; this file is hop detail only.

Same rule as ARCHITECTURE.md: **producers enqueue, daemon injects.** Legacy
`tmux-zsign.sh` keeps working in parallel until cutover (`docs/PARALLEL.md`).

## Comms path: `room say` -> checkback -> daemon inject

This is the primary comms flow today. Three hops, each documented below.

### Hop 1: `room say` (implemented)

`room say` appends a message to the room ledger and optionally arms a checkback
on the sender pane so they never chat-block waiting for a peer reply.

```
seat-mesh room say "DONE: picker fix" [-r global] [--kind claim] [--no-checkback]
```

**What runs:**

1. `sayInRoom()` in `packages/core/src/chatroom/room.ts` appends the message to
   `tasks/chat-rooms/<slug>/ROOM.jsonl` (durable ledger).
2. Unless `--no-checkback`, it calls `armCheckback()` which POSTs to the mesh
   daemon (`POST /patience` on `:3100`).
3. The checkback payload includes: `expect` (e.g.
   `chat-room:global peer update (claim)`), `ownerPane`, `expiresAt` (5m default),
   `renewSec` (3m default), `kind`, sender info.

**Real code:**

| File | Lines | Role |
|------|-------|------|
| `packages/core/src/chatroom/room.ts` | 267 | `sayInRoom()` - ledger append + arm checkback |
| `packages/core/src/chatroom/inbox-client.ts` | 81 | `armCheckback()` - HTTP client to daemon |
| `packages/cli/src/room-cli.ts` | 226 | CLI: `room list\|create\|say\|broadcast\|tail` |
| `packages/core/src/chatroom/types.ts` | - | Zod schemas for `RoomMessage`, `RoomKind` |
| `packages/core/src/chatroom/global.ts` | - | `canBroadcastToGlobal()`, `resolveRoomSlug()` |
| `packages/core/src/chatroom/agent-id.ts` | - | `resolveAgentId()` |
| `packages/core/src/chatroom/duration.ts` | - | `parseDurationToSeconds()`, `expiresAtUtcFromDuration()` |

**Config** (`profiles/zsign/mesh.config.yaml`):

```yaml
daemon:
  port: 3100
  autoStart: true
  pollMs: 4000
chatRooms:
  root: tasks/chat-rooms
  globalSlug: global
  checkback:
    duration: 5m
    renew: 3m
```

### Hop 2: checkback (implemented, partial)

The mesh inbox daemon stores checkback rows in `CHECKBACK.jsonl` and polls them.
When a checkback expires, the daemon fires the message to the owner pane.

**What runs:**

`fireDueCheckbacks()` in `packages/daemon/src/mesh-inbox-server.ts` runs every
4s (`pollMs`). For each active checkback past expiry:

1. Formats message: `[mesh-inbox] Check: <expect>` (or mesh-watch variant).
2. Calls `pastePane()` - raw tmux `send-keys` to the owner pane:
   - `C-u` (clear line)
   - `send-keys -l "<msg>"` (literal text)
   - `Enter`
3. If `renewSec > 0`, renews expiry; otherwise marks `cancelled`.

**Implemented (2026-09-11):** Daemon uses `deliverToPane()` in
`packages/daemon/src/inject-delivery.ts` — `registry.detect` ->
`provider.injectPlan()` -> `injectToPane()`. Holds when composer is
`typing`/`busy`/`limit` (delivers on `empty`/`afk` only).

**Real code:**

| File | Lines | Role |
|------|-------|------|
| `packages/daemon/src/mesh-inbox-server.ts` | 324 | Full daemon: HTTP routes + poll loop |
| `packages/tmux/src/inbox-bridge.ts` | 202 | Daemon lifecycle: `start`/`stop`/`restart`/`status` |

**HTTP routes:**

| Route | Purpose |
|-------|---------|
| `GET /health` | Engine status, `checkbackActive` count |
| `GET /patience` | List active checkbacks (`?all=1` for all) |
| `POST /patience` | Arm a checkback (called by `armCheckback()`) |
| `POST /patience/:id/cancel` | Cancel a checkback |

**State files:** `tasks/seat-mesh/daemon/CHECKBACK.jsonl`, `mesh-inbox.json`,
`mesh-inbox.log`

### Hop 3: daemon inject plan (stubbed)

The target is: daemon -> `InboxOrchestrator.drainTick()` -> BullMQ workers ->
`registry.detect(target) -> provider.injectPlan() -> injectToPane()`.

**What actually exists:**

The inject infrastructure is built at the type and provider level, but the
orchestration wiring is a no-op stub.

**Implemented (types + providers):**

| File | Role |
|------|------|
| `packages/core/src/queue/types.ts` | `QueueChannel`, `InjectJob`, `LimitQueueJob`, `QueueDrainPolicy` |
| `packages/core/src/comms/envelope.ts` | `CommsEnvelopeSchema` (zod; `channel: inbox\|peer\|coord\|inject`) |
| `packages/core/src/providers/types.ts` | `InjectPlan`, `AgentProvider`, `ProviderRegistry` interfaces |
| `packages/providers/src/opencode.ts` | `injectPlan()` for opencode (`enterDelayMs: 150`, `flushEscFirst: true`) |
| `packages/providers/src/claude.ts` | `injectPlan()` for claude (`enterDelayMs: 200`) |
| `packages/providers/src/kiro.ts` | `injectPlan()` for kiro (`useBracketedPaste: true`) |
| `packages/providers/src/cursor-agent.ts` | `injectPlan()` for cursor-agent (`enterDelayMs: 400`) |
| `packages/providers/src/empty.ts` | Neutral fallback plan |
| `packages/tmux/src/inject.ts` | `injectToPane()` - the tmux primitive (load-buffer, send-keys, enter delay) |
| `packages/tmux/src/prompt.ts` | `injectPlan()` wired for `prompt`/`mini spawn` commands only |

**Daemon orchestrator (real):**

| File | Status |
|------|--------|
| `packages/daemon/src/jsonl-store.ts` | INBOX / PEER / CHECKBACK jsonl CRUD |
| `packages/daemon/src/mesh-orchestrator.ts` | Sole drain tick: inbox, peer, checkback, border paint |
| `packages/daemon/src/border-paint.ts` | `@mesh_status`, `@mesh_patience`, manager `INBOX · N` |
| `packages/daemon/src/bullmq-runtime.ts` | `mesh-inject` worker when Redis ping OK; else poll fallback |
| `packages/daemon/src/orchestrator.ts` | Thin `InboxOrchestrator` wrapper |
| `packages/daemon/src/workers.ts` | Queue name constants (`mesh-inject`, …) |

**Not built:**

- `CommsEnvelope` router (table-driven `CommsRouter`)
- `seat-mesh send` CLI
- Daemon `mesh:inbox` / `mesh:peer` workers
- `tmux-zsign.sh` shim dual-write for `to-master`

## Current state summary

| Piece | Status |
|-------|--------|
| Room ledger append (`sayInRoom`) | **Real** |
| Checkback HTTP client (`POST /patience`) | **Real** |
| Room CLI (`say/broadcast/tail/list/create`) | **Real** |
| Mesh inbox daemon HTTP + poll/BullMQ drain | **Real** (`deliverToPane` + provider registry) |
| Daemon lifecycle bridge | **Real** |
| `injectToPane` tmux primitive | **Real** (prompt, mini spawn, daemon `deliverToPane`) |
| Provider `injectPlan()` (5 providers) | **Real** (static plans per CLI) |
| Queue/envelope/provider type definitions | **Real** |
| `orchestratorDrainTick()` | **Real** - inbox/peer/checkback + border paint |
| BullMQ `mesh-inject` worker | **Real** when Redis reachable; poll loop when not |
| `CommsEnvelope` router | **Not built** |
| `seat-mesh send` CLI | **Not built** |
| Daemon inbox/peer workers | **Not built** |

## Target design (for reference)

One envelope, one writer:

```ts
interface CommsEnvelope {
  id: string;
  channel: "inbox" | "peer" | "coord" | "inject";
  from: { kind: "worker"|"mini"|"secretary"|"manager"|"daemon"|"schedule"; slot?: number; mini?: number };
  to: { paneId?: string; slot?: number; mini?: number; role?: "manager"|"secretary" };
  body: string;
  prefix?: "manager"|"worker"|"mini"|"peer"|"none";
  priority: number;
  expectReply?: boolean;
  meta?: { kind?: "ack"|"substance"|"prove"|"blocked"; scheduleId?: string };
}
```

Producers only call:

```bash
seat-mesh send to-master "DONE: ..."
seat-mesh send to-slot 3 "need FE port confirm"
seat-mesh send to-mini 2 "re: picker bug"
seat-mesh send peer-mini 4 "split done"
```

Daemon workers (BullMQ):

| Queue | Drains into | Policy |
|-------|-------------|--------|
| `mesh:inbox` | secretary or master | ACK absorb; substance batch; settle gate |
| `mesh:peer` | target worker/mini pane | prefix `[agent-worker-slot-N]` etc. |
| `mesh:coord` | manager/secretary | manager prefix; digest compaction |
| `mesh:inject` | any pane | checkback, schedule, limit resume |

Inject step: `registry.detect(target)` -> `provider.injectPlan()` -> single tmux path.

Routing:

| from -> to | queue | prefix formatter |
|------------|-------|------------------|
| worker -> master | inbox | `[agent-worker-slot-N]` body; secretary filter ACK |
| worker -> worker | peer | `[agent-worker-slot-N]` |
| worker -> mini | peer | `[agent-worker-slot-N] TO-MINI-N` or plain for OC |
| mini -> worker | peer | `[agent-manager-mini-N] ASK` |
| mini -> mini | peer | `[agent-manager-mini-N] PEER` |
| manager -> worker | coord | `[agent-manager-...]` + slot stamp |
| daemon -> any | inject | checkback / resume / limit |

Prefix strings live in **profile** (`mesh.config.yaml` `comms.prefixes`).

## Migration (no delete)

1. `send` CLI -> dual-write jsonl + Bull job (shadow mode)
2. Flip peer (`to-slot`, `to-mini`, `mini peer`) to enqueue-only
3. Flip manager `prompt`/`remind` to enqueue-only
4. Retire bash `send_agent_keys` except inside daemon package

## Built in seat-mesh today

- [x] queue type stubs (`packages/core/src/queue/types.ts`)
- [x] provider inject plans (per CLI)
- [x] room say + checkback arm + daemon poll/fire
- [x] mesh inbox daemon HTTP server on `:3100`
- [ ] `CommsEnvelope` + router
- [ ] `seat-mesh send` CLI
- [ ] daemon inbox/peer workers
- [ ] tmux-zsign shim dual-write for `to-master` only
- [x] daemon inject via `registry.detect -> provider.injectPlan` (`inject-delivery.ts`)
- [x] `to-master` INBOX drain + `to-slot`/`to-mini` PEER enqueue (`PEER.jsonl`)
