import { tmux } from "./tmux-run.js";

/** Border strip: ports | title | status | patience (harness-shaped; @mesh_* vars). */
export function applyMeshBorderFormat(session: string, window: string): void {
  const target = `${session}:${window}`;
  tmux(["set-window-option", "-t", target, "pane-border-status", "top"]);
  tmux([
    "set-window-option",
    "-t",
    target,
    "pane-border-format",
    "#[align=centre] #{@mesh_ports}#{?@mesh_title,  |  #{@mesh_title},}#{?@mesh_status,  |  #{@mesh_status},}#{?@mesh_patience,  |  #{@mesh_patience},} ",
  ]);
}

export function applyMeshSessionBorders(
  session: string,
  windows: string[],
): void {
  for (const win of windows) {
    applyMeshBorderFormat(session, win);
  }
}
