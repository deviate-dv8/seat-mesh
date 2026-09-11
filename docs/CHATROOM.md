# ChatRoom (parallel agent comms)

**Goal:** One durable file every contract member reads so parallel agents see what
others already said — without ACK loops through manager/secretary and without
human-assistant POV ("would you like me to...") aimed at nobody.

Inbox still drains to master/secretary. **ChatRoom stays.**

## Global room (default)

**Every tmux agent is in the global room by default** — no join step, no manager ACK.

| Room | Slug (config) | Who | Access |
|------|---------------|-----|--------|
| **Global** | `global` (`chatRooms.globalSlug`) | All workers, minis, manager, secretary | Auto-created on first `say`/`tail` |
| **Contract** | any other slug | Parallel slice / mesh job | `room create` / `contract create` |

Manager and secretary:

- **`room say`** and **`room broadcast`** to global — no membership restriction
- **`broadcast`** = high-signal fan-out (`kind: broadcast`, body prefixed `BROADCAST:`)

Workers / minis:

- **`room say`** without `--room` → global (same as `--room global`)
- **`room tail`** without `--room` → global ledger at turn start

```bash
# Any agent — global by default
./sm.sh room say "FYI: slot 3 on auth slice"
./sm.sh room tail

# Manager / secretary — explicit broadcast
./sm.sh room broadcast "Pause mesh until Dan checks #248"

# Named parallel contract (optional)
./sm.sh room say --room zsign-all-auth "CLAIMED: login.block.ts"
```

## Inbox vs room

| | Inbox | ChatRoom |
|---|-------|----------|
| Audience | Manager / secretary | **Peers** (global = all agents; contract = members) |
| Lifetime | Consumed / injected / resolved | **Append-only** (`ROOM.jsonl`) |
| Purpose | Gates, prove, coordination authority | **Deconflict** parallel work |
| Manager ACK | Often required today | **Not required** to keep working |

## Chat contract

A **chat contract** is a named room + optional roster (`profile.yaml`). Any agent
can start one when parallel work needs a shared ledger:

```bash
./sm.sh contract create zsign-all-auth --scope "auth blocks" --lead mini-1
# or
./sm.sh room create zsign-all-auth ...
```

Members append machine lines; they **read the room** at turn start instead of
asking peers or waiting on secretary digest.

Optional fields (all loose — any configuration is fine):

| Field | Role |
|-------|------|
| `lead` | Tracks others + owns a slice |
| `supervisor` | Polls room / nudges (often secretary) |
| `members` | Hint list; not enforced until daemon phase |

## On disk

```text
tasks/chat-rooms/<slug>/
  ROOM.jsonl      # append-only log (source of truth)
  profile.yaml    # optional contract metadata
```

### Message shape

```json
{
  "id": "uuid",
  "ts": "ISO-8601",
  "from": "mini-4",
  "kind": "claim|done|blocked|fyi|status|broadcast|msg",
  "body": "CLAIMED: src/blocks/auth/login.block.ts",
  "expectReply": false
}
```

### POV rules (hard for agents)

Write **ledger lines**, not chat to a human:

| Good | Bad |
|------|-----|
| `CLAIMED: path or slice` | "Would you like me to continue?" |
| `DONE: 5/5 specs green` | "Let me know if you want..." |
| `BLOCKED: need inventory section 8` | "I'll wait for your reply" |
| `FYI: pairing with mini-6 on requests` | Rhetorical questions |

If the line looks like it expects a human reply (`?`, "would you", "can you"),
`expectReply` is set true — still **no blocking**; see checkback below.

## CLI

```bash
seat-mesh room say "<line>" [-r global] [--kind claim] [--no-checkback]
seat-mesh room broadcast "<line>"              # manager / secretary only
seat-mesh room tail [-r global] [-n 50]
seat-mesh room list

seat-mesh room create <slug> ...                 # named contract (not global slug)
seat-mesh contract create <slug> ...             # alias
```

zsign consumer: `./sm.sh room say ...` / `./sm.sh contract create ...`

Identity defaults from `./sm.sh whoami` / tmux pane (`mini-N`, `worker-N`).

## Checkback on all comms (default)

Name: **checkback** (`patience` is a legacy alias in bash).

Every `room say` arms checkback on the **sender** (unless `--no-checkback` or
`--no-checkback`):

- **expect:** `chat-room:<slug> peer update (<kind>)`
- **duration / renew:** profile `chatRooms.checkback` (default `5m` / `3m`)

Agent keeps working; inbox polls later with **Check:** — read `room tail`, do not
idle in composer waiting for a peer to answer like a human.

Same rule applies to future `seat-mesh send` (peer / coord): comms enqueue +
checkback arm, never chat-block.

### Armed checkback is not a stop signal

Queued checkback does **not** pause the pane. On **Check:** run one verify
(`room tail` / grep `CLAIMED`), then continue.

## Agent workflow

1. **Start of turn:** `./sm.sh room tail` (global, `-n 30`) — see what others claimed
2. **Before shared edit:** `./sm.sh room say "CLAIMED: ..."` (global or `--room` contract)
3. **Finish slice:** `./sm.sh room say "DONE: ..."`
4. **Never** route routine peer progress through `to-master` ACK

**Manager / secretary:** `room broadcast` for all-agent lines; `room say` also works on
global with no restriction.

**Named contracts:** use `--room <slug>` when parallel work needs a separate ledger.

## Implementation (libraries — not hand-rolled)

Per `agents-i-dislike.md` #2 (reinvent the wheel):

| Concern | Library |
|---------|---------|
| jsonl append / tail / stream | `ndjson`, `read-last-lines`, `@seat-mesh/core/jsonl` |
| Parallel append lock | `proper-lockfile` |
| Duration (`5m`, `1h`) | `ms` |
| Inbox checkback POST | `ky` |
| CLI `room` / `contract` | `commander` |

Do not add bespoke jsonl parsers, duration regexes, or manual argv loops for this feature.

## Profile (`mesh.config.yaml`)

```yaml
chatRooms:
  root: tasks/chat-rooms
  globalSlug: global
  checkback:
    duration: 5m
    renew: 3m
```

## Migration

Phase 1 (now): local file append + checkback via inbox `:3099/patience`.

Phase 2: `seat-mesh send --room <slug>` dual-write; secretary mirror high-signal
lines to digest only when gate-hot.

Phase 3: daemon optional notify on `BLOCKED:` / `DONE:` — room file remains canonical.
