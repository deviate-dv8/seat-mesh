# seat-mesh architecture (target)

Product-agnostic multi-agent tmux workbench. **Inbox daemon is the only writer**
to panes; everything else enqueues. Providers are pluggable; limits are hooks, not
if/else chains in the orchestrator.

## Tmux layout

| Index | Window | Layout | Purpose |
|------:|--------|--------|---------|
| 0 | `nvim` | 1 pane | Editor |
| 1 | `base` | 2 cols | **Manager** \| **Secretary** (full height) |
| 2 | `workers` | **3x2** (6 panes) | Worker seats **1-6 only** |
| 3 | `minis` | **profile grid** (e.g. `2x2` / `4x2`) | Parallel minis; `layout.minis.leads` places lead(s) in column 0 |

Rationale: 3-6 agents is the effective parallel cap; slot 7-8 had ~zero activity.
Six paired ports (`3010/3011` .. `3060/3061`) — slot `N` -> `30N0/30N1`.

Minis 4x2 (Dan preference):

```text
TOP:    [ LEAD mini-1 ] [ mini-3 ] [ mini-4 ] [ mini-5 ]
BOTTOM: [ LEAD mini-2 ] [ mini-6 ] [ mini-7 ] [ mini-8 ]
```

`layout 4x2` is tmux-only (select-layout + swap-pane); no kill/respawn.

## No direct send

**Rule:** CLI commands, workers, secretary, and recovery jobs **do not** call
`tmux send-keys` (or equivalent) directly. They append to a **queue file** (or
Redis/BullMQ job). The **inbox daemon** is the sole consumer that empties queues
into panes when policy allows (idle, settle, not typing, etc.).

```text
  producer (any)  -->  queue (durable)  -->  inbox daemon (BullMQ workers)
                                                    |
                                                    v
                                              pane inject (one path)
```

Same orchestrator owns: mail delivery, checkback fires, schedule, limit recovery,
border/status paint, proxy/OC side effects that need pane paste.

## Queue model

| Queue / file | Producer | Consumer action |
|--------------|----------|-----------------|
| `inbox.jsonl` (legacy) / `inbox` Bull queue | workers, minis, schedule | inject master/secretary; resolve/ack |
| `peer.jsonl` / peer queue | worker, mini, secretary | inject target pane |
| `checkback` | comms, limits, night | timed poll inject |
| `limits` | provider detectors | run registered limit handler |
| `connectivity` | proxy probe, OC scan | cpe-up, rotate, resume paste |

Goal of daemon: **best-effort empty** — fair, rate-limited, never stomp composer.

BullMQ: Redis-backed workers inside daemon process (or sidecar). Jsonl remains
valid as audit trail / cold replay; jobs reference row ids.

## Agent provider interface

One **AgentProvider** per CLI family. Detection returns a provider id; no
orchestrator if/else on `agent|kiro|claude|opencode`.

```ts
interface AgentProvider {
  id: string;                    // "cursor-agent" | "kiro" | "claude" | "opencode"
  detect(pane: PaneSnapshot): Detection | null;
  composerState(pane: PaneSnapshot): ComposerState;
  injectTarget(pane: PaneSnapshot): InjectPlan;
  limits?: LimitDetector[];      // optional rising-edge detectors
}
```

| Capability | Provider implements |
|------------|---------------------|
| Live vs empty pane | `detect()` |
| Busy / typing / AFK / limit text | `composerState()` |
| How to paste (buffer, Enter timing, prefix rules) | `injectTarget()` |
| Rate limit / connect error patterns | `limits[]` |

Orchestrator calls `registry.getProvider(pane)` only.

## Limits (hooks, not branches)

```ts
interface LimitDetector {
  id: string;                   // "cc-session-limit" | "oc-connect" | "oc-rate"
  match(state: ComposerState, pane: PaneSnapshot): boolean;
  onRisingEdge(ctx: LimitContext): Promise<void>;  // enqueue jobs, not inject
}
```

Examples:

- **CC limit** -> enqueue schedule + checkback; optional `continue` paste when cleared
- **OC rate limit** -> enqueue proxy rotate + `resume` wave to all OC panes
- **OC connect / PROXY-DOWN** -> enqueue `cpe-proxy-up`; hold checkbacks until ipify

Handlers enqueue work; daemon workers execute. No handler calls tmux directly.

## Connectivity

`@seat-mesh/connectivity` stays a library. Recovery policies enqueue jobs
(`connectivity.rotate`, `connectivity.reboot`). Default policy: reboot API only,
no WiFi bounce, no smart-restart unless profile enables.

## Profile-driven layout

`mesh.config.yaml` declares window names, slot count (6), port formula, provider
registry ids, Redis URL, queue names. zsign profile is one consumer.

## Migration from tmux-zsign.sh (harness is not sm)

seat-mesh does **not** wrap the harness. Migration = run **mesh** session beside
**dev**, then move commands one at a time.

1. **Done (0.1):** `./sm.sh` creates `mesh` layout (6 workers 3x2, base, minis)
2. Layout: harness stays 8 workers on `dev` until cutover
3. Extract providers from bash scrape/inject
4. Inbox-server.mjs -> daemon package + BullMQ
5. Producers enqueue only; daemon sole injector
6. Retire harness paths per command — never `exec tmux-zsign.sh` from sm

## Out of scope for core

- Board triage / GitLab (profile plugin)
- Product ports in docs (profile only)
