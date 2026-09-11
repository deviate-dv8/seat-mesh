import type { LoadedProfile } from "@seat-mesh/core";
import { tmuxHasSession } from "../lib/tmux-run.js";
import { listWindowPaneIds } from "./window-panes.js";

export interface VerifyIssue {
  level: "error" | "warn";
  message: string;
}

export function verifyMeshSession(loaded: LoadedProfile): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  const session = loaded.profile.session.name;
  const layout = loaded.profile.layout;
  if (!layout) {
    issues.push({ level: "error", message: "profile missing layout" });
    return issues;
  }

  if (!tmuxHasSession(session)) {
    issues.push({ level: "error", message: `session '${session}' does not exist` });
    return issues;
  }

  const nvimN = listWindowPaneIds(session, layout.nvim.window).length;
  if (nvimN !== 1) {
    issues.push({ level: "error", message: `nvim: want 1 pane, have ${nvimN}` });
  }

  const baseN = listWindowPaneIds(session, layout.base.window).length;
  if (baseN !== 2) {
    issues.push({ level: "error", message: `base: want 2 panes (manager|secretary), have ${baseN}` });
  }

  const workersN = listWindowPaneIds(session, layout.workers.window).length;
  const wantWorkers = loaded.profile.session.workerCount;
  if (workersN !== wantWorkers) {
    issues.push({
      level: "error",
      message: `workers: want ${wantWorkers} panes (3x2), have ${workersN}`,
    });
  }

  const minisN = listWindowPaneIds(session, layout.minis.window).length;
  const wantMinis = layout.minis.max;
  if (minisN !== wantMinis) {
    issues.push({
      level: "error",
      message: `minis: want ${wantMinis} panes (${layout.minis.grid}), have ${minisN}`,
    });
  }

  return issues;
}

export function printVerify(issues: VerifyIssue[]): boolean {
  if (!issues.length) {
    console.log("OK: mesh layout matches profile");
    return true;
  }
  for (const i of issues) {
    console.log(`${i.level === "error" ? "FAIL" : "WARN"}: ${i.message}`);
  }
  return !issues.some((i) => i.level === "error");
}
