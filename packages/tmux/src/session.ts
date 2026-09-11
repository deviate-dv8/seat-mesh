import { spawnSync } from "node:child_process";
import type { LoadedProfile } from "@seat-mesh/core";
import { runHarness } from "./harness.js";

function tmux(args: string[]) {
  return spawnSync("tmux", args, { encoding: "utf8" });
}

function tmuxHasSession(name: string): boolean {
  return tmux(["has-session", "-t", name]).status === 0;
}

function currentTmuxSession(): string | null {
  if (!process.env.TMUX) return null;
  const r = tmux(["display-message", "-p", "#{session_name}"]);
  if (r.status !== 0) return null;
  return (r.stdout ?? "").trim() || null;
}

function printInsideTmuxHelp(): void {
  console.error(`This is a tmux pane — nested session start is not allowed.

You are already inside tmux. Do not run bare ./sm.sh from here.

Useful instead:
  ./sm.sh whoami
  ./sm.sh prompt slot-3 "..."
  ./sm.sh manager
  ./sm.sh contexts
  ./sm.sh save
`);
}

/** Attach to an existing session (or switch client if already in tmux). */
export function attachSession(sessionName: string): number {
  const current = currentTmuxSession();
  if (current) {
    if (current === sessionName) {
      console.log(`already inside session '${sessionName}'`);
      return 0;
    }
    const r = spawnSync("tmux", ["switch-client", "-t", sessionName], {
      stdio: "inherit",
    });
    return r.status ?? 1;
  }

  const r = spawnSync("tmux", ["attach-session", "-t", sessionName], {
    stdio: "inherit",
  });
  return r.status ?? 1;
}

/**
 * Start or attach the dev tmux session (seat-mesh entry).
 * Create path still uses legacy harness until layout is ported to TypeScript.
 */
export function startSession(loaded: LoadedProfile): number {
  if (process.env.TMUX) {
    printInsideTmuxHelp();
    return 1;
  }

  const session = loaded.profile.session.name;

  if (tmuxHasSession(session)) {
    return attachSession(session);
  }

  // Layout create + pane launch: legacy harness (migration bridge).
  return runHarness(loaded.workspace, []);
}
