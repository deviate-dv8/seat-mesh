# seat-mesh TODO — harness parity (incremental)

**Canonical tracker.** Agents: read this before touching `seat-mesh/`. Update checkboxes every slice.

| File | Job |
|------|-----|
| **TODO.md** (this) | Full parity checklist vs `tmux-zsign.sh` |
| **NOW.md** | Current slice only — what we're doing *this* turn |
| **README.md** | Handout + high-level status |
| **docs/** | Architecture / parallel / comms (not a task list) |

**Harness reference:** `tmux-zsign.sh` → `usage()` (~lines 51–187).

**Rules:** `./sm.sh` ≠ harness plugin. Code in `seat-mesh/packages/*` only. Do **not** write `tmux-main-agents.json` from sm (read-only seed until `mesh-agents.json` exists).

**Status:** `[x]` done · `[~]` partial · `[ ]` not started · `[-]` defer

---

## P0 — broken / unusable

- [x] **0.1** `list-panes -s` bug — labeled whole session as minis → `window-panes.ts`
- [x] **0.2** 3×2 workers + 4×2 minis layout → equal `select-layout` grid (`layoutWorkers3x2` / `layoutMinis4x2`; `./sm.sh layout` fixes live session)
- [x] **0.3** `@mesh_*` labels + border strip → `labels.ts`, `borders.ts`
- [x] **0.4** Launch CLIs on session up → `launch.ts` + `agent-builder.ts` (reads harness JSON read-only)
- [x] **0.4b** Pane env before CLI → `session-env.ts` (NO_COLOR scrub) + `opencode-cpe.sh` for OC proxy
- [x] **0.5** `./sm.sh verify`
- [x] **0.6** `./sm.sh labels`

---

## P1 — daily harness feel

- [~] **1.1** `whoami` — works; harness POV doc map not wired
- [x] **1.2** `manager`
- [x] **1.3** `prompt` / `prompt --manager` — enqueue PEER.jsonl; daemon inject (handoff/mini spawn still direct)
- [x] **1.4** `flush` — `flush.ts` (Enter rescue / Esc stuck draft)
- [x] **1.5** `switch` / `handoff` — relaunch + FOCUS handoff (`switch.ts`)
- [ ] **1.6** `set` / `tag` — needs `mesh-agents.json`
- [~] **1.7** `save` / `auto` — scrape live mesh -> `mesh-agents.json` (layout.minis + slot CLI state)
- [x] **1.8** `title` / `status` — `@mesh_title` / `@mesh_status` + border
- [x] **1.9** `remind` — manager-only; enqueue PEER.jsonl (`remind.ts`)
- [ ] **1.10** `continue` + `night`
- [ ] **1.11** `slot-advice`
- [x] **1.12** `providers list|scan`

---

## P2 — inbox / comms

- [~] **2.1** mesh inbox daemon (`mesh-inbox-server.ts` **:3100** — `JsonlStore` + `mesh-orchestrator` + `border-paint`; BullMQ when Redis reachable, poll fallback)
- [x] **2.2** `to-master` — enqueue + daemon inject (`deliverToPane`, `INBOX.jsonl` drain)
- [~] **2.3** peer comms — `./sm.sh to-slot` / `to-mini` enqueue `PEER.jsonl`; room/chat ledger separate
- [~] **2.4** `checkback` — `start|list|cancel` (`patience` alias) wrapping daemon `/patience`; no `schedule` yet
- [ ] **2.5** `schedule`
- [ ] **2.6** `dc-feedback`

**Hard rule:** only daemon calls `inject.ts`.

---

## P3 — manager / secretary / minis

- [ ] **3.1** `secretary start|stop|…`
- [~] **3.2** `mini list|spawn|prompt|done|dispatch-all` + `secretary dispatch` (`minis.ts`)
- [x] **3.3** minis grid + leads from profile (`layout.minis.grid` / `max` / `leads`, `./sm.sh layout`)
- [-] **3.4** `triage` / `board-sync` — optional thin wrapper
- [x] **3.5** `contexts` / `seats` — `contexts.ts` (FOCUS preview + open TASK/REMINDER counts, `--json`)
- [ ] **3.6** `nav log|summary`
- [-] **3.7** `manager-reminder`
- [~] **3.8** `proxy` — status/check only

---

## P4 — cutover

- [~] **4.1** `mesh-agents.json` (mesh-owned state) — save/read layout override; `set`/`tag`/`switch` persist still open
- [ ] **4.2** `session down` (never touch `dev`)
- [ ] **4.3** kiro trust dialog on launch
- [ ] **4.4** Cursor composer-ready wait before handoff
- [ ] **4.5** cutover doc: when workers leave `dev`

---

## Prove bar (every closed row)

```bash
./sm.sh verify
./sm.sh providers scan
# Dan: attach mesh in Ghostty — eyeball borders + CLIs
```
