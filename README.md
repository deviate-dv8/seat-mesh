# seat-mesh

Typed, **profile-driven** workbench for multi-agent tmux coordination. Product-agnostic
core — no zsign branding in packages. A consumer repo adds a profile (paths, role index,
connectivity policy) and optionally a one-line shim.

## Status (0.1)

- [x] Profile loader (`mesh.config.yaml` + zod)
- [x] Role index YAML (`whoami`, `index show|validate`)
- [x] Connectivity probe (`proxy status|check`; disabled when profile `connectivity.enabled: false`)
- [ ] Daemon port (inbox / checkback / schedule)
- [ ] Full tmux inject / mini / secretary commands

## Quick start

```bash
cd seat-mesh
npm install
npm run build
./bin/seat-mesh profile show
./bin/seat-mesh --profile profiles/minimal whoami
npm test
```

## Profile

Pass `--profile <dir|mesh.config.yaml>`. **zsign:** `./sm.sh` hardcodes `profiles/zsign` (no env vars).

## Layout

```text
packages/core          schemas, profile loader, role index
packages/tmux          whoami (more commands later)
packages/connectivity  proxy/carrier probe + recovery (phase 2+)
packages/cli           seat-mesh binary
profiles/minimal       demo profile shipped with repo
```

## zsign linker (wired)

From the zsign workspace root:

```bash
./sm.sh                                  # start/attach tmux (replaces bare ./tmux-zsign.sh)
./sm.sh prompt slot-3 "..."              # unmigrated -> tmux-zsign.sh passthrough
./sm.sh whoami                           # migrated -> seat-mesh CLI
./sm.sh room tail
./sm.sh stack up                         # ./dc.sh up
./sm.sh save                             # scrape panes -> tmux-main-agents.json
```

Linker: `seat-mesh/scripts/link-from-tmux-zsign.sh` (sourced by `sm.sh` + `tmux-zsign.sh`).
Migration: `./sm.sh` is the front door; commands move into seat-mesh over time (`docs/PARALLEL.md`).
Profile: `seat-mesh/profiles/zsign/` (workspace = parent of `seat-mesh/`).
