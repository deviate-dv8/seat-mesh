# seat-mesh: one path (read this)

**patterns.md:** collapse decision points. If you are on session `mesh`, use **only**
this table. Do not mix harness (`dev` / `:3099`) and mesh (`:3100`) in one task.

## Pick one stack

| You are in | Use | Never also |
|------------|-----|------------|
| `mesh` tmux (`./sm.sh`) | `./sm.sh …` + inbox `:3100` | `./tmux-zsign.sh`, `:3099`, `@zsign_*` |
| `dev` tmux (legacy) | `./tmux-zsign.sh …` + inbox `:3099` | `./sm.sh` comms on same seat |

**Default for new mesh work:** stay on `mesh` only until cutover doc says otherwise.

## Pick one command (mesh)

| Need | Command | Notes |
|------|---------|-------|
| Attach / bring stack up | `./sm.sh` or `./sm.sh session up` | Starts layout + CLIs + inbox daemon |
| Who am I | `./sm.sh whoami` | `@mesh_slot`, ports, role |
| Status to manager | `./sm.sh to-master <msg>` | Enqueue only; daemon injects manager |
| Peer worker | `./sm.sh to-slot <N> <msg>` | Enqueue; daemon injects target |
| Peer mini | `./sm.sh to-mini <N> <msg>` | Enqueue; daemon injects target |
| Wait without blocking | `./sm.sh checkback start 5m --renew 3m --expect "…" --here` | Alias: `patience` |
| Manager → worker | `./sm.sh prompt <slot> "…"` | Enqueue `PEER.jsonl` → daemon inject |
| Remind seats | `./sm.sh remind <slot\|all> "…"` | Enqueue `PEER.jsonl` → daemon inject |
| Launch / restart / switch / layout / mini spawn | `./sm.sh launch …`, `secretary start`, `switch`, `layout` | Enqueue `PANE_OPS.jsonl` — **one at a time** (`./sm.sh ops list`) |
| Shrink grid with live work | `./sm.sh layout --dry-run` then `--yes` | Default **refuses** if active workers/minis would be killed |
| Room broadcast | `./sm.sh room say "…"` | Ledger + optional checkback |
| Inbox / health | `./sm.sh inbox` | Auto-starts daemon if down |
| Layout fix | `./sm.sh layout` | Minis grid from `profiles/zsign/mesh.config.yaml` (`grid`, `max`, `leads`) |
| Smoke | `./sm.sh test` && `./sm.sh verify` | |
| Persist session | `./sm.sh save` | Writes `mesh-agents.json` (minis grid/leads + CLI per slot); yaml is fallback only |

**Do not invent:** raw `tmux send-keys`, curl `:3099`, harness `to-master` from a mesh pane.

## One inject path (implementation)

```text
producer → append jsonl (INBOX | PEER | CHECKBACK) [+ optional BullMQ nudge]
         → mesh-inbox daemon (:3100)
         → orchestratorDrainTick()
         → deliverToPane() → provider.injectPlan() → injectToPane()
```

- **One drain function:** `orchestratorDrainTick` (inbox + peer + checkback + border paint).
- **One wake mechanism that matters on host today:** poll loop (`pollMs`, default 4s).
- **BullMQ:** optional; auto-off when Redis unreachable. Not a second inject path.

## State files (grep these, not harness paths)

| File | Purpose |
|------|---------|
| `tasks/seat-mesh/daemon/INBOX.jsonl` | to-master queue |
| `tasks/seat-mesh/daemon/PEER.jsonl` | to-slot / to-mini queue |
| `tasks/seat-mesh/daemon/CHECKBACK.jsonl` | checkback timers |
| `tasks/seat-mesh/daemon/mesh-inbox.log` | daemon trace |

## Deep docs (only when the table is not enough)

| Doc | When |
|-----|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Target design, layout, providers |
| [COMMS.md](COMMS.md) | Room/checkback hop detail |
| [PARALLEL.md](PARALLEL.md) | Why two stacks exist |
| [TODO.md](../TODO.md) | Parity checklist vs harness |
