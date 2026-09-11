/**
 * Sole daemon inject path: registry.detect -> provider.injectPlan -> injectToPane.
 */
import type { ComposerState, ProviderRegistry } from "@seat-mesh/core";
import { capturePaneSnapshot, injectToPane } from "@seat-mesh/tmux";

/** When may the daemon paste into this pane? */
export function canDeliverNow(
  state: ComposerState,
  captureTail: string,
  providerId: string,
): boolean {
  if (state.phase === "plain_shell" || state.phase === "limit") return false;
  if (state.phase === "empty" || state.phase === "afk") return true;

  if (providerId === "cursor-agent" || providerId === "agent") {
    if (state.phase === "busy" && state.busyLabel === "follow-up") return true;
    if (/Add a follow-up|ctrl\+c to stop/.test(captureTail)) return true;
    if (state.phase === "busy") return false;
    if (state.phase === "typing" && /Add a follow-up/.test(captureTail)) return true;
    return false;
  }

  return false;
}

export type DeliverResult =
  | { ok: true; providerId: string; mode: "idle" | "steer" }
  | { ok: false; reason: string };

export function deliverToPane(
  paneId: string,
  message: string,
  registry: ProviderRegistry,
): DeliverResult {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return { ok: false, reason: "no_snapshot" };

  const prov = registry.detect(snap);
  if (!prov) return { ok: false, reason: "no_provider" };

  const state = prov.composerState(snap);
  if (!canDeliverNow(state, snap.captureTail, prov.id)) {
    return { ok: false, reason: `held:${state.phase}${state.busyLabel ? `:${state.busyLabel}` : ""}` };
  }

  const steer =
    state.phase === "busy" ||
    (state.phase === "typing" && /Add a follow-up/.test(snap.captureTail));

  const plan = prov.injectPlan(snap);
  injectToPane(paneId, message, plan, prov.id, snap.captureTail);
  return { ok: true, providerId: prov.id, mode: steer ? "steer" : "idle" };
}
