#!/usr/bin/env node

import {
  loadProfile,
  profilePaths,
  loadRoleIndex,
  renderRoleIndex,
  validateRoleIndex,
  runStackPassthrough,
} from "@seat-mesh/core";
import { snapshotConnectivity, formatStatus } from "@seat-mesh/connectivity";
import { createBuiltinRegistry } from "@seat-mesh/providers";
import {
  printWhoami,
  runWhoami,
  capturePaneSnapshot,
  listSessionPanes,
  sessionAttach,
  sessionUp,
  sessionStatus,
  relayoutMeshSession,
  reloadMesh,
  ensureMeshInbox,
  startMeshInbox,
  stopMeshInbox,
  restartMeshInbox,
  printMeshInboxStatus,
  sendToMaster,
  secretaryLaunch,
  secretaryRestart,
  secretaryDispatch,
  secretaryCollect,
  secretaryMeshWatch,
  secretarySupervise,
  secretaryStatus,
  printMiniList,
  miniSpawn,
  miniPrompt,
  miniDone,
  miniSpawnAll,
  runMeshSmoke,
  printSmokeResults,
  launchSession,
  printLaunchResults,
  enqueuePrompt,
  runRemind,
  printRemindResults,
  verifyMeshSession,
  printVerify,
  labelMeshSession,
  applyMeshSessionBorders,
  runFlush,
  printFlushResults,
  runSwitch,
  setPaneTitle,
  setPaneStatus,
  printSeatContexts,
  runToSlot,
  runToMini,
  applyMeshState,
  saveMeshSession,
  submitPaneOp,
  printPaneOpsList,
  printRelayoutPlan,
  assertRelayoutSafe,
} from "@seat-mesh/tmux";
import { buildChatCommands } from "./chat-cli.js";
import { buildCheckbackCommands } from "./checkback-cli.js";
import { buildContractCommands, buildRoomCommands } from "./room-cli.js";

function parseArgs(argv: string[]) {
  const profileFlag: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--profile" || a === "-p") {
      const v = argv[++i];
      if (!v) throw new Error("--profile requires a path");
      profileFlag.push(v);
      continue;
    }
    rest.push(a);
  }
  return { profile: profileFlag[0], rest };
}

/** Profile yaml + mesh-agents.json layout overrides (yaml is fallback only). */
function meshLoaded(profileArg?: string) {
  return applyMeshState(loadProfile(profileArg));
}

function usage(loaded?: ReturnType<typeof loadProfile>): void {
  const prof = loaded ? `profile=${loaded.profile.name}` : "";
  console.log(`sm — seat-mesh${prof ? ` (${prof})` : ""} (NOT a tmux-zsign.sh plugin)

  Tracker: seat-mesh/TODO.md + seat-mesh/NOW.md
  Handout: seat-mesh/README.md + seat-mesh/docs/PARALLEL.md

  ./sm.sh                    attach/create profile session (zsign: mesh — not dev)
  ./sm.sh session attach|up|status
  ./sm.sh verify              layout + labels health (like tmux-zsign verify)
  ./sm.sh reload [--layout]   lazy rebuild + labels (no session kill; --layout re-grids)
  ./sm.sh layout [--no-leads] [--dry-run] [--yes]   workers 3x2 + minis grid (queued; --yes kills active doomed panes)
  ./sm.sh ops list                      pane-op queue (launch/restart/relayout serial)
  ./sm.sh save|auto             scrape live session -> mesh-agents.json (layout + CLI/resume per slot)
  ./sm.sh labels              re-apply @mesh_* + border strip
  ./sm.sh inbox [--json]              engine inbox status (auto-starts if down)
  ./sm.sh inbox stop|restart          manual lifecycle (start is automatic)
  ./sm.sh to-master <msg...>          enqueue to-master -> INBOX.jsonl (daemon injects manager)
  ./sm.sh to-slot <1-8> <msg...>      enqueue peer -> PEER.jsonl (worker seats only)
  ./sm.sh to-mini <1-8> <msg...>      enqueue peer -> mini pane (worker seats only)
  ./sm.sh secretary start|dispatch|collect [--send] [--nudge]|status|watch on [5m]|watch off
  ./sm.sh mini list|spawn|prompt|done|dispatch-all
  ./sm.sh checkback start|list|cancel     (alias: patience) — mesh inbox :3100 /patience
  ./sm.sh test                smoke: layout, targets, providers, inbox, proxy, OC patterns
  ./sm.sh launch [all|manager|secretary|minis|mini-N|1-6|slot-N]
  ./sm.sh prompt <target> <text...>       enqueue -> PEER.jsonl (daemon inject)
  ./sm.sh prompt --manager <target> <text...>  manager prefix
  ./sm.sh remind <slot|all> [note...]     manager-only seat refresh (workers 1-6)
  ./sm.sh flush <slot|all|manager|mini-N>     rescue Enter (stuck composer)
  ./sm.sh contexts [--json]           seat -> FOCUS map + open TASK/REMINDER counts
  ./sm.sh switch <target> <agent|kiro|claude|opencode|empty> [--fresh] [reason]
  ./sm.sh handoff ...                         alias for switch
  ./sm.sh title <target> <text...>
  ./sm.sh status <target> <text...>
  ./sm.sh whoami [target]    mesh panes + @mesh_* ; pass slot|%{id}|manager outside tmux
  ./sm.sh room|chat|index|proxy|providers|manager|stack …

  ./tmux-zsign.sh            legacy harness only — session dev (separate tool)

  --profile <dir> override (rare).
`);
}

async function main(): Promise<void> {
  const { profile: profileArg, rest } = parseArgs(process.argv.slice(2));
  const [cmd, sub, ...tail] = rest;

  if (!cmd) {
    const loaded = meshLoaded(profileArg);
    printWhoami(loaded, sub || tail[0]);
    return;
  }

  if (cmd === "-h" || cmd === "--help" || cmd === "help") {
    usage(meshLoaded(profileArg));
    return;
  }

  if (cmd === "profile" && sub === "show") {
    const loaded = meshLoaded(profileArg);
    const paths = profilePaths(loaded);
    console.log(`name=${loaded.profile.name}`);
    console.log(`path=${loaded.profilePath}`);
    console.log(`workspace=${loaded.workspace}`);
    console.log(`seats_root=${paths.seatsRoot}`);
    console.log(`roles_dir=${paths.rolesDir}`);
    return;
  }

  if (cmd === "session") {
    const loaded = meshLoaded(profileArg);
    if (sub === "up") {
      sessionUp(loaded);
      console.log(`OK: session '${loaded.profile.session.name}' created`);
      printMeshInboxStatus(loaded);
      return;
    }
    if (sub === "attach" || !sub) {
      sessionAttach(loaded);
      return;
    }
    if (sub === "status") {
      sessionStatus(loaded);
      return;
    }
    console.error("usage: session attach|up|status");
    process.exit(2);
  }

  if (cmd === "verify") {
    const loaded = meshLoaded(profileArg);
    ensureMeshInbox(loaded, { quiet: true });
    const layoutOk = printVerify(verifyMeshSession(loaded));
    const inboxOk = printMeshInboxStatus(loaded);
    process.exit(layoutOk && inboxOk ? 0 : 1);
  }

  if (cmd === "reload") {
    const loaded = meshLoaded(profileArg);
    const layout = rest.includes("--layout");
    reloadMesh(loaded, { layout });
    console.log(
      layout
        ? `OK: reload + relayout session ${loaded.profile.session.name}`
        : `OK: reload (build + labels) session ${loaded.profile.session.name}`,
    );
    printMeshInboxStatus(loaded);
    return;
  }

  if (cmd === "layout") {
    const loaded = meshLoaded(profileArg);
    const skipLeads = rest.includes("--no-leads");
    const force = rest.includes("--yes");
    const dryRun = rest.includes("--dry-run");
    const m = loaded.profile.layout?.minis;
    if (dryRun) {
      printRelayoutPlan(loaded);
      return;
    }
    submitPaneOp(
      loaded,
      "relayout",
      { skipMinisLeads: skipLeads, force },
      `layout ${m?.grid ?? "grid"}`,
      () => {
        assertRelayoutSafe(loaded, force);
        relayoutMeshSession(loaded, { skipMinisLeads: skipLeads, force });
        const grid = m?.grid ?? "4x2";
        const leadNote =
          skipLeads || !m
            ? ""
            : ` leads=[${Array.isArray(m.leads) ? m.leads.join(",") : "1,2"}]`;
        console.log(
          `OK: relayout ${loaded.profile.session.name} (workers 3x2, minis ${grid}${leadNote})`,
        );
      },
    );
    return;
  }

  if (cmd === "ops") {
    const loaded = meshLoaded(profileArg);
    if (sub === "list" || !sub) {
      printPaneOpsList(loaded);
      return;
    }
    console.error("usage: ops list");
    process.exit(2);
  }

  if (cmd === "inbox") {
    const loaded = meshLoaded(profileArg);
    const json = rest.includes("--json");
    if (sub === "stop") {
      stopMeshInbox(loaded);
      return;
    }
    if (sub === "restart") {
      restartMeshInbox(loaded);
      return;
    }
    if (sub === "start") {
      startMeshInbox(loaded);
      return;
    }
    // status (default): engine auto-starts, then one-line status
    ensureMeshInbox(loaded, { quiet: true });
    const ok = printMeshInboxStatus(loaded, { json });
    process.exit(ok ? 0 : 1);
  }

  if (cmd === "to-master") {
    const loaded = meshLoaded(profileArg);
    let from: string | undefined;
    let slot: string | undefined;
    const parts: string[] = [];
    const args = [sub, ...tail].filter((a): a is string => a != null && a !== "");
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "--from" && args[i + 1]) from = args[++i];
      else if (a === "--slot" && args[i + 1]) slot = args[++i];
      else parts.push(a);
    }
    const msg = parts.join(" ").trim();
    if (!msg) {
      console.error("usage: to-master [--from <who>] [--slot <N|label>] <msg...>");
      process.exit(2);
    }
    const entry = sendToMaster(loaded, msg, { from, slot });
    if (!entry || entry.ok !== true) {
      console.error("FAIL: to-master enqueue (inbox down?) — run: ./sm.sh inbox");
      process.exit(1);
    }
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  if (cmd === "to-slot") {
    const loaded = meshLoaded(profileArg);
    const dest = sub;
    const msg = tail.join(" ").trim();
    try {
      runToSlot(loaded, dest ?? "", msg);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "to-mini") {
    const loaded = meshLoaded(profileArg);
    const mid = sub;
    const msg = tail.join(" ").trim();
    try {
      runToMini(loaded, mid ?? "", msg);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "mini") {
    const loaded = meshLoaded(profileArg);
    const reg = createBuiltinRegistry(loaded.profile.providers);
    if (sub === "list" || !sub) {
      printMiniList(loaded);
      return;
    }
    if (sub === "dispatch-all") {
      miniSpawnAll(loaded, reg);
      return;
    }
    if (sub === "spawn") {
      const args = tail.filter((a) => a !== "--");
      let role = "helper";
      const ids: number[] = [];
      const taskParts: string[] = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--role" && args[i + 1]) {
          role = args[++i];
          continue;
        }
        if (a === "all") {
          for (let n = 1; n <= loaded.profile.session.miniMax; n++) ids.push(n);
          continue;
        }
        const m = a.match(/^mini-?(\d+)$/);
        if (m) {
          ids.push(Number(m[1]));
          continue;
        }
        if (/^\d+$/.test(a)) {
          ids.push(Number(a));
          continue;
        }
        taskParts.push(a);
      }
      const task = taskParts.join(" ").trim();
      if (!ids.length || !task) {
        console.error("usage: mini spawn <1-8|all|mini-N> [--role helper] <task...>");
        process.exit(2);
      }
      for (const n of ids) {
        submitPaneOp(
          loaded,
          "mini-spawn",
          { n, role, task, viaSecretary: false },
          `mini spawn ${n} role=${role}`,
          () => miniSpawn(loaded, reg, n, role, task, { viaSecretary: false }),
        );
      }
      return;
    }
    if (sub === "prompt") {
      const n = Number(tail[0]);
      const text = tail.slice(1).join(" ");
      if (!n || !text) {
        console.error("usage: mini prompt <N> <text...>");
        process.exit(2);
      }
      miniPrompt(loaded, reg, n, text);
      return;
    }
    if (sub === "done") {
      const n = Number(tail[0]);
      const report = tail.slice(1).join(" ");
      if (!n || !report) {
        console.error("usage: mini done <N> PASS|FAIL: <evidence>");
        process.exit(2);
      }
      miniDone(loaded, n, report);
      return;
    }
    console.error("usage: mini list|spawn|prompt|done|dispatch-all");
    process.exit(2);
  }

  if (cmd === "secretary") {
    const loaded = meshLoaded(profileArg);
    if (sub === "start") {
      secretaryLaunch(loaded);
      return;
    }
    if (sub === "restart") {
      const reg = createBuiltinRegistry(loaded.profile.providers);
      secretaryRestart(loaded, reg);
      saveMeshSession(loaded, reg);
      return;
    }
    if (sub === "dispatch") {
      const reg = createBuiltinRegistry(loaded.profile.providers);
      secretaryDispatch(loaded, reg);
      return;
    }
    if (sub === "collect") {
      const reg = createBuiltinRegistry(loaded.profile.providers);
      const send = rest.includes("--send");
      const nudge = rest.includes("--nudge");
      const digest = secretaryCollect(loaded, reg, { sendManager: send, nudgeOpen: nudge });
      process.exit(digest.allDone ? 0 : 1);
    }
    if (sub === "status" || !sub) {
      secretaryStatus(loaded);
      return;
    }
    if (sub === "watch") {
      const action = (tail[0] ?? "status").toLowerCase();
      if (action === "on") {
        secretaryMeshWatch(loaded, "on", tail[1] ?? "5m");
        return;
      }
      if (action === "off") {
        secretaryMeshWatch(loaded, "off");
        return;
      }
      secretaryMeshWatch(loaded, "status");
      return;
    }
    if (sub === "supervise") {
      const reg = createBuiltinRegistry(loaded.profile.providers);
      const action = (tail[0] ?? "status").toLowerCase();
      if (action === "on") {
        secretarySupervise(loaded, reg, "on", tail[1] ?? "5m");
        return;
      }
      if (action === "off") {
        secretarySupervise(loaded, reg, "off");
        return;
      }
      secretarySupervise(loaded, reg, "status");
      return;
    }
    console.error(
      "usage: secretary start|restart|status|supervise on [5m]|supervise off|watch on [5m]|watch off",
    );
    process.exit(2);
  }

  if (cmd === "contexts" || cmd === "seats") {
    const loaded = meshLoaded(profileArg);
    printSeatContexts(loaded, rest.includes("--json"));
    return;
  }

  if (cmd === "test") {
    const loaded = meshLoaded(profileArg);
    ensureMeshInbox(loaded, { quiet: true });
    const results = await runMeshSmoke(loaded);
    const ok = printSmokeResults(results);
    process.exit(ok ? 0 : 1);
  }

  if (cmd === "labels") {
    const loaded = meshLoaded(profileArg);
    const session = loaded.profile.session.name;
    const layout = loaded.profile.layout;
    if (!layout) {
      console.error("profile missing layout");
      process.exit(1);
    }
    labelMeshSession(loaded, session);
    applyMeshSessionBorders(session, [
      layout.nvim.window,
      layout.base.window,
      layout.workers.window,
      layout.minis.window,
    ]);
    console.log(`OK: labels + borders on session ${session}`);
    return;
  }

  if (cmd === "launch") {
    const loaded = meshLoaded(profileArg);
    const targets = rest.filter((a) => a !== "--");
    const label = targets.length ? targets.join(",") : "all";
    submitPaneOp(
      loaded,
      "launch",
      { targets: targets.length ? targets : undefined },
      `launch ${label}`,
      () => {
        const results = launchSession(loaded, {
          targets: targets.length ? targets : undefined,
        });
        printLaunchResults(results);
        if (results.some((r) => r.status === "failed")) process.exit(1);
      },
    );
    return;
  }

  if (cmd === "prompt") {
    const loaded = meshLoaded(profileArg);
    let manager = false;
    const args: string[] = [];
    for (const a of [sub, ...tail].filter((x): x is string => x != null && x !== "")) {
      if (a === "--manager" || a === "-m") manager = true;
      else args.push(a);
    }
    const [target, ...textParts] = args;
    if (!target || !textParts.length) {
      console.error("usage: prompt [--manager] <target> <text...>");
      process.exit(2);
    }
    const text = textParts.join(" ");
    const { paneId, targetLabel } = enqueuePrompt(loaded, target, text, { manager });
    console.log(`OK: queued -> ${targetLabel} pane=${paneId} (daemon inject when idle)`);
    return;
  }

  if (cmd === "remind") {
    const loaded = meshLoaded(profileArg);
    const workerCount = loaded.profile.session.workerCount;
    const [target, ...noteParts] = [sub, ...tail].filter(Boolean) as string[];
    if (!target) {
      console.error(`usage: remind <slot|all> [note...]   (manager-only, workers 1-${workerCount})`);
      process.exit(2);
    }
    const parsed = /^(?:slot-)?(\d+)$/.exec(target);
    if (target !== "all" && !parsed) {
      console.error(`usage: remind <slot|all> [note...]   (manager-only, workers 1-${workerCount})`);
      process.exit(2);
    }
    if (parsed) {
      const n = Number(parsed[1]);
      if (n < 1 || n > workerCount) {
        console.error(
          `refused: remind targets worker slots 1-${workerCount} only (got ${n})`,
        );
        process.exit(2);
      }
    }
    const results = runRemind(loaded, target, {
      note: noteParts.length ? noteParts.join(" ") : undefined,
    });
    printRemindResults(results);
    return;
  }

  if (cmd === "flush") {
    const loaded = meshLoaded(profileArg);
    const reg = createBuiltinRegistry(loaded.profile.providers);
    const target = sub ?? "all";
    if (!sub) {
      console.error("usage: flush <slot|all|manager|mini-N>");
      process.exit(2);
    }
    const results = runFlush(loaded, reg, target);
    printFlushResults(results);
    return;
  }

  if (cmd === "switch" || cmd === "handoff") {
    const loaded = meshLoaded(profileArg);
    const reg = createBuiltinRegistry(loaded.profile.providers);
    const args = [sub, ...tail].filter(Boolean);
    if (args.length < 2) {
      console.error(
        "usage: switch <target> <agent|kiro|claude|opencode|empty> [--fresh|--resume ID] [reason...]",
      );
      process.exit(2);
    }
    const target = args[0]!;
    const newType = args[1]!;
    let fresh = false;
    let resumeId: string | undefined;
    const reasonParts: string[] = [];
    for (let i = 2; i < args.length; i++) {
      const a = args[i]!;
      if (a === "--fresh") fresh = true;
      else if (a === "--resume" && args[i + 1]) resumeId = args[++i];
      else if (a.startsWith("--resume=")) resumeId = a.slice("--resume=".length);
      else reasonParts.push(a);
    }
    const reason = reasonParts.join(" ") || undefined;
    submitPaneOp(
      loaded,
      "switch",
      { target, newType, fresh, resumeId, reason },
      `switch ${target} -> ${newType}`,
      () =>
        runSwitch(loaded, reg, target, newType, {
          fresh,
          resumeId,
          reason,
        }),
    );
    return;
  }

  if (cmd === "title") {
    const loaded = meshLoaded(profileArg);
    const [target, ...parts] = [sub, ...tail].filter(Boolean) as string[];
    if (!target || !parts.length) {
      console.error("usage: title <target> <text...>");
      process.exit(2);
    }
    setPaneTitle(loaded, target, parts.join(" "));
    console.log(`OK: title ${target}`);
    return;
  }

  if (cmd === "status") {
    const loaded = meshLoaded(profileArg);
    const [target, ...parts] = [sub, ...tail].filter(Boolean) as string[];
    if (!target || !parts.length) {
      console.error("usage: status <target> <text...>");
      process.exit(2);
    }
    setPaneStatus(loaded, target, parts.join(" "));
    console.log(`OK: status ${target}`);
    return;
  }

  if (cmd === "whoami" || cmd === "where") {
    if (cmd === "where") {
      console.error("note: where is deprecated — use ./sm.sh whoami");
    }
    const loaded = meshLoaded(profileArg);
    printWhoami(loaded, sub || tail[0]);
    return;
  }

  if (cmd === "index") {
    const loaded = meshLoaded(profileArg);
    const paths = profilePaths(loaded);
    if (sub === "show") {
      let role = "worker";
      for (let i = 0; i < tail.length; i++) {
        if (tail[i] === "--role" && tail[i + 1]) role = tail[++i];
      }
      const index = loadRoleIndex(paths.rolesDir, role);
      if (tail.includes("--json")) {
        console.log(JSON.stringify(index, null, 2));
      } else {
        console.log(renderRoleIndex(index));
      }
      return;
    }
    if (sub === "validate") {
      let role = "worker";
      for (let i = 0; i < tail.length; i++) {
        if (tail[i] === "--role" && tail[i + 1]) role = tail[++i];
      }
      const index = loadRoleIndex(paths.rolesDir, role);
      const result = validateRoleIndex(index, loaded.workspace);
      if (!result.ok) {
        console.error(`FAIL: missing paths:\n${result.missing.map((m) => `  - ${m}`).join("\n")}`);
        process.exit(1);
      }
      console.log(`OK: role=${role} paths exist under ${loaded.workspace}`);
      return;
    }
    console.error("usage: index show|validate");
    process.exit(2);
  }

  if (cmd === "proxy") {
    const loaded = meshLoaded(profileArg);
    const snap = await snapshotConnectivity(loaded.profile);
    if (sub === "status" || sub === "check" || !sub) {
      console.log(formatStatus(snap));
      if (sub === "check" && snap.pendingTriggers.length) process.exit(1);
      return;
    }
    if (sub === "reset") {
      console.log("proxy reset: not implemented yet (phase 2b)");
      process.exit(2);
    }
    console.error("usage: proxy status|check|reset");
    process.exit(2);
  }

  if (cmd === "providers") {
    const loaded = meshLoaded(profileArg);
    const reg = createBuiltinRegistry(loaded.profile.providers);
    if (sub === "list") {
      for (const p of reg.all()) console.log(p.id);
      return;
    }
    if (sub === "scan") {
      const session = tail[0] ?? loaded.profile.session.name;
      const panes = listSessionPanes(session);
      if (!panes.length) {
        console.error(`no panes in session ${session} (tmux running?)`);
        process.exit(1);
      }
      for (const paneId of panes) {
        const snap = capturePaneSnapshot(paneId);
        if (!snap) continue;
        const prov = reg.detect(snap);
        const det = prov?.detect(snap);
        const state = prov?.composerState(snap) ?? { phase: "plain_shell" };
        const slot = snap.options.mesh_slot || snap.options.zsign_slot || "-";
        const ports = snap.options.mesh_ports || snap.options.zsign_ports || "-";
        console.log(
          `${paneId}\t${prov?.id ?? "?"}\t${det?.resumeId ?? "-"}\t${state.phase}${state.limitKind ? `:${state.limitKind}` : ""}\tslot=${slot}\tports=${ports}\t${snap.windowName}`,
        );
      }
      return;
    }
    console.error("usage: providers list|scan [session]");
    process.exit(2);
  }

  if (cmd === "manager") {
    const loaded = meshLoaded(profileArg);
    const w = runWhoami(loaded);
    const isManager = w.role === "manager";
    console.log(isManager ? "yes: master" : `no: role=${w.role}`);
    process.exit(isManager ? 0 : 1);
  }

  if (cmd === "stack" || cmd === "dc") {
    const loaded = meshLoaded(profileArg);
    const args = [sub, ...tail].filter((a): a is string => a != null && a !== "");
    process.exit(runStackPassthrough(loaded, args));
  }

  if (cmd === "room" || cmd === "contract" || cmd === "chat") {
    const loaded = meshLoaded(profileArg);
    const getLoaded = () => loaded;
    const branch =
      cmd === "room"
        ? buildRoomCommands(getLoaded)
        : cmd === "contract"
          ? buildContractCommands(getLoaded)
          : buildChatCommands(getLoaded);
    if (!sub) {
      branch.outputHelp();
      return;
    }
    try {
      await branch.parseAsync([sub, ...tail], { from: "user" });
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version") return;
      throw e;
    }
    return;
  }

  if (cmd === "save" || cmd === "auto") {
    const loaded = meshLoaded(profileArg);
    const reg = createBuiltinRegistry(loaded.profile.providers);
    const file = saveMeshSession(loaded, reg);
    const m = loaded.profile.layout?.minis;
    const layoutNote = m
      ? ` minis=${m.grid} max=${m.max} leads=[${Array.isArray(m.leads) ? m.leads.join(",") : "?"}]`
      : "";
    console.log(`OK: saved ${file}${layoutNote}`);
    return;
  }

  if (cmd === "checkback" || cmd === "patience") {
    const loaded = meshLoaded(profileArg);
    const getLoaded = () => loaded;
    const branch = buildCheckbackCommands(getLoaded);
    if (!sub) {
      branch.outputHelp();
      return;
    }
    try {
      await branch.parseAsync([sub, ...tail], { from: "user" });
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version") return;
      throw e;
    }
    return;
  }

  console.error(`unknown command: ${cmd}`);
  usage();
  process.exit(2);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
