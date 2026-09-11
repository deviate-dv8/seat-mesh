import { createProviderRegistry, type ProviderRegistry } from "@seat-mesh/core";
import { cursorAgentProvider } from "./cursor-agent.js";
import { kiroProvider } from "./kiro.js";
import { claudeProvider } from "./claude.js";
import { opencodeProvider } from "./opencode.js";
import { emptyProvider } from "./empty.js";

const BUILTIN = [
  cursorAgentProvider,
  kiroProvider,
  claudeProvider,
  opencodeProvider,
  emptyProvider,
];

export function createBuiltinRegistry(
  enabledIds?: string[],
): ProviderRegistry {
  const reg = createProviderRegistry();
  const allow = enabledIds ? new Set(enabledIds) : null;
  for (const p of BUILTIN) {
    if (allow && !allow.has(p.id)) continue;
    reg.register(p);
  }
  return reg;
}

export {
  cursorAgentProvider,
  kiroProvider,
  claudeProvider,
  opencodeProvider,
  emptyProvider,
};
