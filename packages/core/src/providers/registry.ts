import type { AgentProvider, PaneSnapshot, ProviderRegistry } from "./types.js";

export function createProviderRegistry(
  providers: AgentProvider[] = [],
): ProviderRegistry {
  const byId = new Map<string, AgentProvider>();
  for (const p of providers) byId.set(p.id, p);

  return {
    register(provider: AgentProvider) {
      byId.set(provider.id, provider);
    },
    detect(pane: PaneSnapshot): AgentProvider | null {
      for (const p of byId.values()) {
        if (p.detect(pane)) return p;
      }
      return null;
    },
    get(id: string) {
      return byId.get(id);
    },
    all() {
      return [...byId.values()];
    },
  };
}
