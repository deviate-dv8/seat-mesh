# zsign profile (`profiles/zsign`)

**patterns.md / ONE-PATH (every mesh pane, including mini-N):** session `mesh`
only — `./sm.sh` + inbox `:3100`. Read [../../docs/ONE-PATH.md](../../docs/ONE-PATH.md)
first. Never mix `dev` / `tmux-zsign.sh` / `:3099` on the same pane. Banner prints
at the top of `./sm.sh whoami`.

Profile for the zsign workspace. **seat-mesh core has no zsign imports** — this
folder is config + role YAML only.

## `./sm.sh` = seat-mesh, not tmux-zsign

```bash
# workspace root sm.sh:
exec seat-mesh/bin/seat-mesh --profile seat-mesh/profiles/zsign "$@"
```

- **Session name:** `mesh` (`mesh.config.yaml` `session.name`) — **not** `dev`
- **Bare `./sm.sh`:** attach or create **mesh** (seat-mesh layout)
- **Does not** run `tmux-zsign.sh`, read `tmux-main-agents.json`, or touch `dev`

## sm commands (seat-mesh)

```bash
./sm.sh                    # attach/create mesh (outside tmux)
./sm.sh session up|attach|status
./sm.sh whoami [slot|%{id}|manager|mini-N]
./sm.sh room tail|say …
./sm.sh chat tail|query …
./sm.sh stack up           # → ./dc.sh (only passthrough)
./sm.sh index show|validate
./sm.sh proxy status|check
./sm.sh providers list|scan
```

## Legacy harness (separate — session dev)

```bash
./tmux-zsign.sh            # dev only — inbox, mini, prompt, triage, 8 workers
```

Use **one session per agent pane.** Do not assume `whoami` in `dev` applies in
`mesh` or vice versa.

Handout: [../../docs/PARALLEL.md](../../docs/PARALLEL.md)
