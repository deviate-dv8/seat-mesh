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
import { printWhoami, runWhoami, capturePaneSnapshot, listSessionPanes } from "@seat-mesh/tmux";
import { buildChatCommands } from "./chat-cli.js";
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

function usage(): void {
  console.log(`seat-mesh — profile-driven agent workbench

Usage:
  seat-mesh [--profile <dir|yaml>] help
  seat-mesh [--profile <path>] whoami [target]
  seat-mesh [--profile <path>] index show|validate [--role …]
  seat-mesh [--profile <path>] proxy status|check
  seat-mesh [--profile <path>] providers list|scan [session]
  seat-mesh [--profile <path>] room|contract|chat …
  seat-mesh [--profile <path>] stack up|down|reload|…  (profile stack.command passthrough)
  seat-mesh [--profile <path>] dc …                     alias for stack

Pass --profile <dir|mesh.config.yaml>. Consumer shims (e.g. zsign ./sm.sh) set profile for you.
Only passthrough: profile stack.command (zsign: ./dc.sh). No other host scripts.
`);
}

async function main(): Promise<void> {
  const { profile: profileArg, rest } = parseArgs(process.argv.slice(2));
  const [cmd, sub, ...tail] = rest;

  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    usage();
    process.exit(cmd ? 0 : 0);
  }

  if (cmd === "profile" && sub === "show") {
    const loaded = loadProfile(profileArg);
    const paths = profilePaths(loaded);
    console.log(`name=${loaded.profile.name}`);
    console.log(`path=${loaded.profilePath}`);
    console.log(`workspace=${loaded.workspace}`);
    console.log(`seats_root=${paths.seatsRoot}`);
    console.log(`roles_dir=${paths.rolesDir}`);
    return;
  }

  if (cmd === "whoami" || cmd === "where") {
    if (cmd === "where") {
      console.error("note: where is deprecated — use ./sm.sh whoami");
    }
    const loaded = loadProfile(profileArg);
    printWhoami(loaded, tail[0]);
    return;
  }

  if (cmd === "index") {
    const loaded = loadProfile(profileArg);
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
    const loaded = loadProfile(profileArg);
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
    const loaded = loadProfile(profileArg);
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
    const loaded = loadProfile(profileArg);
    const w = runWhoami(loaded);
    const isManager = w.role === "manager";
    console.log(isManager ? "yes: master" : `no: role=${w.role}`);
    process.exit(isManager ? 0 : 1);
  }

  if (cmd === "stack" || cmd === "dc") {
    const loaded = loadProfile(profileArg);
    const args = [sub, ...tail].filter((a): a is string => a != null && a !== "");
    process.exit(runStackPassthrough(loaded, args));
  }

  if (cmd === "room" || cmd === "contract" || cmd === "chat") {
    const loaded = loadProfile(profileArg);
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

  console.error(`unknown command: ${cmd}`);
  usage();
  process.exit(2);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
