# Parallel run (seat-mesh + host harness)

**seat-mesh is independent.** It does not source, wrap, or passthrough to a host
tmux script. The only external passthrough is **profile `stack.command`** (zsign:
`./dc.sh` via `./sm.sh stack`).

| Concern | Host harness (zsign: `tmux-zsign.sh`) | seat-mesh |
|---------|--------------------------------------|-----------|
| Tmux layout, prompt, mini, inbox | yes | not yet (daemon WIP) |
| Entry | `./tmux-zsign.sh` | `./bin/seat-mesh --profile …` or consumer `./sm.sh` |
| Stack / docker | `./dc.sh` | `./sm.sh stack` (profile passthrough only) |
| Coupling | zsign-local | none in core packages |

Cutover (later): profile flag + ported commands; host harness shrinks per command.
No dual-entry linker in `tmux-zsign.sh`.
