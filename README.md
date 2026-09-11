# seat-mesh

Typed, **profile-driven** workbench for multi-agent tmux coordination.

**Independent product** — no zsign branding in packages. A host repo adds a
**profile** (`mesh.config.yaml` + role index) and optionally a one-line shim
(zsign: `./sm.sh` → `bin/seat-mesh --profile profiles/zsign`).

## Status (0.1)

- [x] Profile loader (`mesh.config.yaml` + zod)
- [x] Role index YAML (`whoami`, `index show|validate`)
- [x] ChatRoom + ChatFile (CLI)
- [x] Stack passthrough (`stack` / `dc` → profile `stack.command` only external passthrough)
- [x] Connectivity probe (`proxy status|check`)
- [ ] Daemon (inbox / checkback / inject)
- [ ] Tmux layout orchestrator (6-slot target layout)

## Quick start (standalone)

```bash
cd seat-mesh
npm install
npm run build
./bin/seat-mesh --profile profiles/minimal whoami
./bin/seat-mesh --profile profiles/minimal proxy status
npm test
```

## Profile

Every command needs `--profile <dir|mesh.config.yaml>` unless a consumer shim sets it.

| Profile | Purpose |
|---------|---------|
| `profiles/minimal` | Demo / tests — no host coupling |
| `profiles/zsign` | zsign workspace consumer — see `profiles/zsign/README.md` |

## Layout

```text
packages/core          schemas, profile, chatroom, chatfile, stack passthrough
packages/tmux          whoami, pane snapshot
packages/connectivity  proxy probe
packages/cli           seat-mesh binary
profiles/              consumer configs (minimal + zsign)
```

## Boundaries

| seat-mesh | Host (e.g. zsign) |
|-----------|-------------------|
| `whoami`, `room`, `chat`, `index` | `./tmux-zsign.sh` harness until ported |
| `stack` → `stack.command` only | `./dc.sh` via zsign profile |
| No `tmux-zsign.sh` import | `./sm.sh` shim picks `profiles/zsign` |

See `docs/PARALLEL.md`, `docs/ARCHITECTURE.md`.
