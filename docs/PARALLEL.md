# Parallel run (legacy + seat-mesh)

**Rule:** seat-mesh does **not** delete or replace `tmux-zsign.sh`, `inbox-server.mjs`,
or `scripts/cpe-*.sh` until an explicit cutover. Both stacks can run side by side.

| Layer | Legacy (today) | seat-mesh (building) |
|-------|----------------|----------------------|
| Tmux layout | 8 workers, old window names | 6-slot 3x2 + `base` (not applied yet) |
| Pane inject | bash `send_agent_keys` | daemon orchestrator only (WIP) |
| Inbox | `inbox-server.mjs` :3099 | `@seat-mesh/daemon` + BullMQ (WIP) |
| Proxy / OC | bash + inbox hooks | `@seat-mesh/connectivity` + limit hooks |
| Entry | `./tmux-zsign.sh` | `./sm.sh` (seat-mesh only; no tmux-zsign passthrough) |
| Stack | `./dc.sh` | `./sm.sh stack` / `./sm.sh dc` (passthrough to `./dc.sh` only) |

Cutover (later): profile flag `orchestrator.primary: true` + Dan says go. Until then
producers may **dual-write** (jsonl row + Bull job) for shadow testing.
