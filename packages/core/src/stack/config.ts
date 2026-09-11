import type { MeshProfile } from "../schema/profile.js";

export interface StackConfig {
  /** Workspace-relative or absolute path to the stack driver (default ./dc.sh). */
  command: string;
  summary?: string;
}

export function stackConfig(profile: MeshProfile): StackConfig {
  const st = profile.stack;
  return {
    command: st?.command ?? "./dc.sh",
    summary: st?.summary,
  };
}
