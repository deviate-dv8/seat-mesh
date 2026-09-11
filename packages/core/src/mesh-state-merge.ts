import type { MeshProfile } from "./schema/profile.js";
import type { MeshAgents, SavedMinisLayout } from "./schema/agents.js";

/** Effective minis layout: saved mesh-agents.json wins over profile yaml defaults. */
export function effectiveMinisLayout(
  profile: MeshProfile,
  saved?: SavedMinisLayout | null,
): SavedMinisLayout {
  const base = profile.layout?.minis;
  if (!base) {
    throw new Error("profile missing layout.minis");
  }
  if (!saved) {
    return {
      grid: base.grid,
      max: base.max,
      leads: Array.isArray(base.leads) ? base.leads : [1, 2],
    };
  }
  return {
    grid: saved.grid,
    max: saved.max,
    leads: saved.leads,
  };
}

/** Merge saved mesh-agents layout into a loaded profile (session.miniMax synced). */
export function mergeMeshAgentsIntoProfile(
  profile: MeshProfile,
  mesh: Pick<MeshAgents, "layout"> | null,
): MeshProfile {
  const saved = mesh?.layout?.minis;
  if (!saved || !profile.layout) return profile;
  const minis = { ...profile.layout.minis, ...saved };
  return {
    ...profile,
    layout: { ...profile.layout, minis },
    session: { ...profile.session, miniMax: minis.max },
  };
}
