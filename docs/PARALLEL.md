# Parallel run: seat-mesh vs tmux-zsign.sh

## seat-mesh is NOT a harness plugin

**Wrong mental model:** "`./sm.sh` is how you run tmux-zsign" / "sm wraps dev" /
"sm is a thin alias for `./tmux-zsign.sh`."

**Correct:** seat-mesh is a **separate** tmux workbench. It has its own session
name (`mesh` in the zsign profile), its own layout (see `ARCHITECTURE.md`), its
own pane options (`@mesh_*`), and its own CLI (`whoami`, `room`, `session`, …).

`tmux-zsign.sh` is the **legacy zsign harness** for session `dev` (8 workers,
manager, inbox, mini spawn, board triage, etc.). It does not load
`mesh.config.yaml` and seat-mesh does not source it.

```text
  ./sm.sh                    ./tmux-zsign.sh
       |                            |
       v                            v
  seat-mesh CLI                bash harness
       |                            |
       v                            v
  tmux session "mesh"          tmux session "dev"
  (profile layout)             (tmux-main-agents.json)
```

Both can exist on one machine. **Do not merge entrypoints.** No `exec
tmux-zsign.sh` from `sm.sh`. No dual-write linker in the harness unless a
documented migration step says so.

## Only shared passthrough

| External command | Who calls it | Why |
|------------------|--------------|-----|
| `./dc.sh` | `./sm.sh stack` / `dc` | Profile `stack.command` — docker/worktrees, not tmux |

Nothing else from the harness is passthrough. Not `prompt`, not `mini`, not
`inbox`, not `attach` to `dev`.

## Command map

| Concern | Legacy harness (`tmux-zsign.sh`, session `dev`) | seat-mesh (`./sm.sh`, session `mesh`) |
|---------|-----------------------------------------------|---------------------------------------|
| Attach / create session | `./tmux-zsign.sh` | `./sm.sh` or `./sm.sh session attach` |
| Seat identity | `./tmux-zsign.sh whoami` (harness) | `./sm.sh whoami` (`@mesh_*` + role index) |
| Manager prompt / mini / inbox | yes | no (daemon WIP) |
| Chat room / chat file | — | `./sm.sh room` / `chat` |
| Stack / docker | `./dc.sh` directly | `./sm.sh stack` → `./dc.sh` |
| Board triage, night, labels | harness | not sm |

## Cutover (later)

Per-command migration: producers enqueue; daemon injects; harness commands shrink.
Until then, agents on **dev** follow `.agent/` harness docs; agents on **mesh**
follow seat-mesh profile + role index.
