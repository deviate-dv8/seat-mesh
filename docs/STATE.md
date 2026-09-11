# Mesh state file (`mesh-agents.json`)

Mesh-owned provenance of which agent CLI type and resume id each slot runs.
Status: **partial** (`TODO 4.1`). `./sm.sh save` writes layout + live slot
state; `set`/`tag`/`switch` persist still open.

| | Path |
|---|------|
| **File** | `mesh-agents.json` (workspace root, next to legacy `tmux-main-agents.json`) |
| **Schema** | `packages/core/src/schema/agents.ts` (`MeshAgentsSchema`) |
| **Reader** | `packages/tmux/src/agents-state.ts` (`loadMeshAgents`) |
| **Config** | `mesh.config.yaml` → `state.meshAgentsJson` (default `mesh-agents.json`) |

## Why

`tmux-main-agents.json` is harness-owned and mutated by `tmux-zsign.sh`.
seat-mesh must never write it (`TODO.md` rule). `mesh-agents.json` is the
mesh replica: same purpose (which CLI / resume per slot), mesh-owned format,
Zod-validated on read.

## Slot mapping (same as `docs/SLOTS.md`)

| Slot | Key in `mesh-agents.json` | Window |
|------|---------------------------|--------|
| manager | `manager` | `base` col 0 |
| secretary | `secretary` | `base` col 1 |
| worker-1..6 | `workers[]` (has `slot: N`) | `workers` 3x2 |
| mini-1..8 | `minis[]` (has `mini: N`) | `minis` 4x2 |

## Format

```jsonc
{
  "schemaVersion": 1,
  "session": "mesh",
  "workdir": "/home/dan/Desktop/Work/zsign",
  "manager": {
    "type": "agent",
    "name": "manager",
    "resumeId": "4e911d2e-…",
    "resumeCmd": "env -u NO_COLOR … agent --resume …"
  },
  "secretary": {
    "type": "opencode",
    "wanted": true,
    "resumeId": null
  },
  "workers": [
    {
      "type": "agent",
      "slot": 3,
      "name": "worker-3",
      "ports": "3030/3031",
      "resumeId": "5027fc00-…",
      "paneIndex": 2
    }
  ],
  "minis": [
    {
      "type": "opencode",
      "mini": 1,
      "role": "helper",
      "task": "Draft mesh-agents.json schema…",
      "paneIndex": 0
    }
  ],
  "conventions": {
    "secretaryDefaultCli": "opencode",
    "miniDefaultCli": "opencode",
    "launchSkipsEmpty": true
  },
  "updatedAt": "2026-09-11T13:01:19Z"
}
```

## Conventions

- **camelCase** keys (legacy harness uses `resume_id` / `resume_cmd` --
  `meshToLegacyAgentsState()` maps for compat callers).
- `type` is a `CliType` enum: `agent | claude | kiro | opencode | empty`.
- Absent `mesh-agents.json` → `loadMeshAgents` returns `null`; layout falls
  back to `mesh.config.yaml` (`applyMeshState` / `meshLoaded`).
- `layout.minis` in this file overrides profile yaml (`grid`, `max`, `leads`).
- `./sm.sh save` refreshes from live session; edit by hand only for recovery.

## Read path

```ts
// packages/tmux/src/agents-state.ts
loadMeshAgents(workspace, "mesh-agents.json")       // MeshAgents | null
meshToLegacyAgentsState(mesh)                        // AgentsStateFile adapter
loadAgentsStateCompat(workspace, mesh, legacy)       // tagged union
```

Launch (`launch.ts`) and scan callers can consume either source. `set` /
`tag` / `switch` persist to this file once the write path lands (TODO 4.1).

## Migration from legacy

1. Seed `mesh-agents.json` from `tmux-main-agents.json` (copy + rename keys,
   split `panes[]` into `workers[]` / `minis[]` by `role`).
2. Flip `launch` / `switch` / `whoami` to read via `loadAgentsStateCompat`,
   prefer `source === "mesh"`.
3. Enable write path (currently OFF) — `set` / `tag` persist here.
4. Harness keeps its own file untouched; nothing in seat-mesh writes legacy.

## Status

- [x] `MeshAgentsSchema` (zod) in core
- [x] `loadMeshAgents` read + `meshToLegacyAgentsState` adapter
- [x] `profilePaths().meshAgentsJson`
- [x] `save` / `auto` write path (`saveMeshSession`)
- [x] `layout.minis` read override (`applyMeshState`)
- [ ] Write path (`set` / `tag` / `switch`) — TODO 4.1 remainder
- [ ] Seed script / migration step