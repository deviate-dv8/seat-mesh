import fs from "node:fs";
import path from "node:path";
import type { LoadedProfile } from "@seat-mesh/core";
import type { PaneRow } from "../lib/resolve-pane.js";

const MAX = 6000;

export function focusBriefForPane(loaded: LoadedProfile, row: PaneRow): string {
  const root = path.join(loaded.workspace, loaded.profile.seats.root);
  let file: string;
  if (row.role === "manager") {
    file = path.join(root, loaded.profile.seats.dirs?.manager ?? "manager", "FOCUS.md");
  } else if (row.role === "secretary") {
    file = path.join(root, loaded.profile.seats.dirs?.secretary ?? "secretary", "FOCUS.md");
  } else if (row.slot && /^\d+$/.test(row.slot)) {
    const pat = loaded.profile.seats.dirs?.worker ?? "slot-{n}";
    file = path.join(root, pat.replace("{n}", row.slot), "FOCUS.md");
  } else if (row.mini) {
    return `(mini-${row.mini} — no per-mini FOCUS file; see manager/minis.json)`;
  } else {
    return "(no seat mapping for this pane)";
  }
  try {
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) return `(empty: ${file})`;
    return text.length > MAX ? `${text.slice(0, MAX)}\n…(truncated)` : text;
  } catch {
    return `(missing: ${file})`;
  }
}
