import { spawnSync } from "node:child_process";

export function tmux(args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync("tmux", args, { encoding: "utf8" });
  return {
    ok: r.status === 0,
    out: (r.stdout ?? "").trim(),
    err: (r.stderr ?? "").trim(),
  };
}

export function tmuxHasSession(name: string): boolean {
  return tmux(["has-session", "-t", name]).ok;
}
