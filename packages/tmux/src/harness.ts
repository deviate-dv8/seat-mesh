import { spawnSync } from "node:child_process";
import path from "node:path";

/** Legacy bash harness — bridge until commands move into seat-mesh. */
export function runHarness(workspace: string, args: string[]): number {
  const script = path.join(workspace, "tmux-zsign.sh");
  const r = spawnSync(script, args, {
    cwd: workspace,
    stdio: "inherit",
    env: process.env,
  });
  if (r.error) {
    console.error(`harness: ${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}
