# seat-mesh

## TODO / tracking (read before coding)

| File | What |
|------|------|
| **[TODO.md](TODO.md)** | **Full incremental checklist vs harness** |
| **[NOW.md](NOW.md)** | Current slice only |
| `tasks/seat-mesh/FOCUS.md` | Workspace NOW mirror |
| `tasks/seat-mesh/TASKS.md` | Session checkboxes |

---

**seat-mesh** is a standalone, profile-driven tmux workbench for multi-agent
coordination. It is its **own product** — not a plugin, wrapper, shim around
`tmux-zsign.sh`, and not "dev with a different name."

zsign installs it as `./sm.sh` → `seat-mesh/bin/seat-mesh` + `profiles/zsign/`.
That one-line launcher loads the **zsign profile**. It never calls `tmux-zsign.sh`.
The only external exec is profile `stack.command` → `./dc.sh` (docker/worktrees).

## Two tmux stacks (parallel — do not confuse)

| | **seat-mesh (`./sm.sh`)** | **Legacy harness (`./tmux-zsign.sh`)** |
|---|---------------------------|----------------------------------------|
| **Session** | `mesh` (from profile `session.name`) | `dev` |
| **Layout** | ARCHITECTURE.md: nvim, base (manager\|secretary), workers 3×2, minis 4×2 | 8 workers + manager + minis window |
| **Pane vars** | `@mesh_role`, `@mesh_slot`, `@mesh_ports` | `@zsign_role`, `@zsign_slot`, `@zsign_ports` |
| **Entry (outside tmux)** | `./sm.sh` → attach/create **mesh** | `./tmux-zsign.sh` → attach/create **dev** |
| **Prompt** | `[mesh]` | `[dev]` |

Same workspace folder; **different sessions, different tools.** Using one does not
configure the other.

## Handout (read this first)

| Doc | What |
|-----|------|
| **[docs/ONE-PATH.md](docs/ONE-PATH.md)** | **Which command / which stack — zero decisions** |
| **[NOW.md](NOW.md)** | Current slice (short) |
| **[TODO.md](TODO.md)** | Parity checklist vs harness |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Target layout, daemon, providers |
| [docs/PARALLEL.md](docs/PARALLEL.md) | Why `mesh` and `dev` coexist |
| [docs/COMMS.md](docs/COMMS.md) | Room / checkback detail (not the command picker) |
| [docs/SLOTS.md](docs/SLOTS.md) | Slot / port model (6 workers) |

## Status (0.1)

- [x] Profile loader (`mesh.config.yaml` + zod)
- [x] Role index YAML (`whoami`, `index show|validate`)
- [x] **Session** `attach` / `up` / `status` — layout + **launch CLIs** from agents JSON (read-only)
- [x] **Launch** / **prompt** — start agent/kiro/claude/opencode in panes; inject text
- [x] ChatRoom + ChatFile (CLI)
- [x] Stack passthrough (`stack` / `dc` → profile `stack.command` only)
- [x] Connectivity probe (`proxy status|check`)
- [x] Providers registry (`providers list|scan`)
- [~] Daemon (inbox / checkback / inject on `:3100`) — poll drain live; BullMQ when Redis up
- [ ] Port prompt / mini / inbox from harness — **later** (enqueue-only; no bash send-keys in core)

## Quick start (zsign workspace)

```bash
cd /path/to/zsign
./sm.sh                  # outside tmux: attach or create session mesh
./sm.sh session status   # panes + @mesh_* labels
./sm.sh launch all       # (re)launch CLIs from tmux-main-agents.json slots 1-6 + manager
./sm.sh providers scan   # live CLI per pane
./sm.sh prompt --manager 1 "status check"
./sm.sh whoami 1         # slot 1 in mesh (not dev)
./sm.sh stack up         # only external passthrough: ./dc.sh
```

Inside a **mesh** pane: `./sm.sh` or `./sm.sh whoami` = this pane.

Legacy **dev** agents: keep using `./tmux-zsign.sh` until cutover — see
[docs/PARALLEL.md](docs/PARALLEL.md).

## What `./sm.sh` is NOT

- Not `exec tmux-zsign.sh`
- Not a subcommand or plugin of the harness
- Not the same as attaching `[dev]`
- Not allowed to mutate `dev`, `tmux-main-agents.json`, or harness labels
