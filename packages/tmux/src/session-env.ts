import { tmux } from "./tmux-run.js";

/**
 * Scrub tmux server globals that wash out TUIs (NO_COLOR, TERM=dumb).
 * Port of harness ensure_tmux_color_env — run before launching agents.
 */
export function ensureMeshSessionEnv(session: string): void {
  tmux(["set-environment", "-gu", "NO_COLOR"]);
  tmux(["set-environment", "-gu", "FORCE_COLOR"]);
  const gterm = tmux(["show-environment", "-g", "TERM"]).out;
  if (gterm === "TERM=dumb" || gterm === "TERM=") {
    tmux(["set-environment", "-gu", "TERM"]);
  }
  tmux(["set-environment", "-g", "COLORTERM", "truecolor"]);
}
