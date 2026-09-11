# Slots (unified model)

**Manager, secretary, workers, and minis are all slots.** Same features; **guards**
restrict what each role may do — not separate code paths.

## Slot registry (6-worker layout)

| Slot id | Pane | Ports | Role guard |
|---------|------|-------|------------|
| `manager` | `base` col 0 | `manager` | coord, spawn minis, PROPOSAL gate |
| `secretary` | `base` col 1 | `secretary` | inbox transform, digest, spawn tester minis |
| `worker-1` .. `worker-6` | `workers` 3x2 | `30N0/30N1` | product delivery, prove, to-master |
| `mini-1` .. `mini-8` | `minis` 4x2 | `mini-N` | parallel jobs, mini done, peer |

Legacy `slot-7` / `slot-8` fold into cold snapshots only; new sessions are 6 workers.

## Same features (every slot)

| Feature | API | Guard examples |
|---------|-----|----------------|
| Seat files | `FOCUS.md`, `TASKS.md`, `REMINDER.md` | all slots |
| Inbox / send | `send to-*` (queued) | mini cannot `to-master` substance without mini done |
| Status border | `@mesh_status` from Mark + composer | daemon paints all |
| Title / name | `@mesh_title`, hub line in FOCUS | all |
| Provider | detect + inject plan | empty pane = no inject |
| Checkback | arm on expect-reply sends | all |
| NAV log | `nav log` telemetry | workers + minis typical |
| **Snapshot** | `snapshot here <slug>` | all (see below) |
| Limits hooks | provider `limits[]` | OC/CC on any slot with that CLI |

Guards live in `SlotGuard` table (profile + role), not `if (role === manager)` in orchestrator.

```ts
interface SlotGuard {
  role: SlotRole;
  allow: CommsAction[];   // send.toMaster, send.peer, spawn.mini, merge, ...
  deny?: CommsAction[];
}
```

## Two layers of “snapshot”

### 1. Seat file snapshot (cold archive)

What `tmux-zsign.sh snapshot` does today:

- Copy `FOCUS.md` + `TASKS.md` + `REMINDER.md` (+ optional `NAV.jsonl`) to
  `tasks/agent-seats/_snapshots/<date>_<seatId>_<slug>/`
- Reset live trio to templates; FOCUS Mark -> OPEN with pointer to cold path
- Grep-ignored; `contexts --snapshots` lists

**Unified seat ids:** `manager`, `secretary`, `worker-3`, `mini-2` (not only `slot-N`).

### 2. Runtime snapshot (live pane state)

Point-in-time for orchestrator / triage / `providers scan`:

- tmux pane id, window, cwd, capture tail
- provider id + resume id + `composerState`
- border segments (ports, title, status)
- optional: last NAV tail, open TASKS count

Used by daemon drain decisions (hold inject if typing). **Not** a substitute for cold
archive — complementary.

### Combined `SlotSnapshot` (export)

```ts
interface SlotSnapshot {
  id: string;              // worker-3 | manager | secretary | mini-1
  role: SlotRole;
  takenAt: string;
  files?: SeatFileBundle;  // present on cold archive
  runtime?: PaneRuntime;   // present on live capture
  meta: { slug?: string; hub?: string; mark?: string };
}
```

CLI:

```bash
seat-mesh snapshot here my-slug     # cold archive (files + runtime meta.json)
seat-mesh snapshot capture          # runtime only (all slots in session)
seat-mesh contexts                  # live FOCUS one-liners + marks
seat-mesh contexts --snapshots      # list cold dirs
```

## Paths on disk (profile-driven)

```text
tasks/agent-seats/
  manager/          # slot id: manager
  secretary/        # slot id: secretary  (NEW folder; was role-only)
  slot-1/ .. slot-6/
  minis.json        # mini-1..8 task state (pane map)
  _snapshots/
    2026-09-11_worker-3_privacy-done/
    2026-09-11_manager_eod/
```

Secretary gets a real seat folder (same trio as workers). Manager already has `manager/`.

## Migration from legacy

| Legacy | Unified |
|--------|---------|
| `@zsign_role=manager` | slot `manager` |
| `@zsign_role=secretary` | slot `secretary` |
| `@zsign_slot=3` | slot `worker-3` |
| `@zsign_mini=2` | slot `mini-2` |
| `seat-mesh/tmux/snapshot.ts` | rename -> `pane-capture.ts` (runtime only) |
| bash `run_snapshot` | `seat-mesh seats snapshot` + shim |

Old `_snapshots` names `slot-3_*` remain valid; new ones use `worker-3_*`.

## Not built yet

- [ ] `secretary/` seat folder + templates in zsign
- [ ] `SlotGuard` enforcement in `send` router
- [ ] `seat-mesh snapshot` command
- [ ] Combined meta.json with runtime block on cold snapshot
