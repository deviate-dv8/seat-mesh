# Agent comms (target)

Same rule as ARCHITECTURE.md: **producers enqueue, daemon injects.** Legacy
`tmux-zsign.sh` keeps working in parallel until cutover (`docs/PARALLEL.md`).

## Today (legacy — split)

| CLI | Path | Queued? |
|-----|------|---------|
| `to-master` | POST `:3099/to-master` -> `INBOX.jsonl` -> poll inject | yes |
| `to-slot` | `send_agent_keys` direct to peer pane | **no** |
| `to-mini` / `mini ask` / `mini peer` | direct paste | **no** |
| `prompt` / `remind` / `continue` | manager direct paste | **no** |
| `secretary` digest | bulk line to master | **no** |
| `checkback` | `CHECKBACK.jsonl` + daemon poll inject | yes |
| `schedule` | `SCHEDULE.jsonl` + daemon | yes |
| limit recovery (OC/CC) | inbox-server side effects + paste | mixed |

Secretary **transformer**: ACK-class `to-master` held/absorbed; substance queued for
bulk digest to master. Workers still expect prefixes (`[agent-worker-slot-N]`, etc.).

## Target (seat-mesh)

One envelope, one writer:

```ts
interface CommsEnvelope {
  id: string;
  channel: "inbox" | "peer" | "coord" | "inject";
  from: { kind: "worker"|"mini"|"secretary"|"manager"|"daemon"|"schedule"; slot?: number; mini?: number };
  to: { paneId?: string; slot?: number; mini?: number; role?: "manager"|"secretary" };
  body: string;
  prefix?: "manager"|"worker"|"mini"|"peer"|"none";  // resolved by router from from/to
  priority: number;           // BLOCKED/PROVED > routine ACK
  expectReply?: boolean;    // arms checkback on sender
  meta?: { kind?: "ack"|"substance"|"prove"|"blocked"; scheduleId?: string };
}
```

Producers only call:

```bash
seat-mesh send to-master "DONE: ..."
seat-mesh send to-slot 3 "need FE port confirm"
seat-mesh send to-mini 2 "re: picker bug"
seat-mesh send peer-mini 4 "split done"
# shim: ./tmux-zsign.sh to-master ... -> same enqueue (dual-write during migration)
```

Daemon workers (BullMQ):

| Queue | Drains into | Policy |
|-------|-------------|--------|
| `mesh:inbox` | secretary or master | ACK absorb; substance batch; settle gate |
| `mesh:peer` | target worker/mini pane | prefix `[agent-worker-slot-N]` etc. |
| `mesh:coord` | manager/secretary | manager prefix; digest compaction |
| `mesh:inject` | any pane | checkback, schedule, limit resume |

Inject step: `registry.detect(target)` -> `provider.injectPlan()` -> single tmux path.

## Routing (no if/else in orchestrator)

```text
CommsRouter (table-driven)
  match envelope -> DeliveryRule { queue, formatPrefix, holdIfTyping, secretaryFirst? }
```

Examples:

| from -> to | queue | prefix formatter |
|------------|-------|------------------|
| worker -> master | inbox | `[agent-worker-slot-N]` body; secretary filter ACK |
| worker -> worker | peer | `[agent-worker-slot-N]` |
| worker -> mini | peer | `[agent-worker-slot-N] TO-MINI-N` or plain for OC |
| mini -> worker | peer | `[agent-manager-mini-N] ASK` |
| mini -> mini | peer | `[agent-manager-mini-N] PEER` |
| manager -> worker | coord | `[agent-manager-...]` + slot stamp |
| daemon -> any | inject | checkback / resume / limit |

Prefix strings live in **profile** (`mesh.config.yaml` `comms.prefixes`), not hardcoded zsign.

## Secretary transformer (unchanged behavior, new pipe)

```text
worker to-master -> mesh:inbox -> SecretaryWorker
  |-- ACK regex match -> secretary pane file (no master inject)
  '-- substance -> batch buffer -> mesh:coord digest -> master
```

## ChatRoom (parallel contracts)

Shared append-only ledger for contract members — not master inbox. See
`docs/CHATROOM.md`. `room say` / future `send --room` append to
`tasks/chat-rooms/<slug>/ROOM.jsonl`; agents `room tail` to deconflict without
manager ACK loops.

## ChatFile (per-slot prompt log)

Queryable history of **human prompt + agent response** per seat (not peer comms).
See `docs/CHATFILE.md`. Storage: `tasks/chat-files/<slot>/CHAT.jsonl`. Every
`AgentProvider` implements `sessionId`, `modelId`, `scrapePromptTurn`. CLI:
`chat tail|query|append|record`.

## Checkback + comms

**Default on all comms** (room say, peer send when wired): arm checkback on the
sender so agents never chat-block in human POV waiting for a peer reply. Name:
**checkback** (`patience` = legacy bash alias).

Any `send` with `expectReply: true` atomically enqueues checkback row (same as today).
`room say` always arms checkback unless `--no-checkback`.
Reply on peer channel auto-matches `expect` (inbox objective match for ipify, etc.).
Unrelated intercept -> agent acks via `checkback ack` (not auto).

## Status / borders

Not comms — daemon **paint** tick reads FOCUS Mark + `provider.composerState()` ->
`@mesh_status` (legacy `@zsign_status` alias during migration).

## Migration (no delete)

1. `send` CLI -> dual-write jsonl + Bull job (shadow mode)
2. Flip peer (`to-slot`, `to-mini`, `mini peer`) to enqueue-only
3. Flip manager `prompt`/`remind` to enqueue-only
4. Retire bash `send_agent_keys` except inside daemon package

## Built in seat-mesh today

- [x] queue type stubs (`packages/core/src/queue/types.ts`)
- [x] provider inject plans (per CLI)
- [ ] `CommsEnvelope` + router
- [ ] `seat-mesh send` CLI
- [ ] daemon inbox/peer workers
- [ ] tmux-zsign shim dual-write for `to-master` only
