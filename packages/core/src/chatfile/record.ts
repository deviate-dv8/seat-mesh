import type { AgentProvider, Detection, PaneSnapshot, ProviderRegistry } from "../providers/types.js";
import type { ChatFileConfig } from "./store.js";
import { appendSlotPrompt } from "./store.js";
import { resolveSlotKeyFromPane } from "./slot.js";

export interface RecordFromPaneResult {
  recorded: boolean;
  reason?: string;
  record?: Awaited<ReturnType<typeof appendSlotPrompt>>;
}

/** Scrape pane via provider PromptRecording hooks and append when new. */
export async function recordPromptFromPane(
  workspace: string,
  cfg: ChatFileConfig,
  provider: AgentProvider,
  pane: PaneSnapshot,
  detection: Detection,
): Promise<RecordFromPaneResult> {
  const turn = provider.scrapePromptTurn(pane);
  if (!turn) {
    return { recorded: false, reason: "provider scrapePromptTurn returned null" };
  }
  const human = turn.humanPrompt.trim();
  const response = turn.agentResponse.trim();
  if (!human || !response) {
    return { recorded: false, reason: "empty human or agent text" };
  }

  const record = await appendSlotPrompt(workspace, cfg, {
    slot: resolveSlotKeyFromPane(pane),
    paneId: pane.paneId,
    providerId: provider.id,
    sessionId: provider.sessionId(pane, detection),
    model: provider.modelId(pane),
    humanPrompt: human,
    agentResponse: response,
  });

  return { recorded: true, record };
}

export async function recordAllPanes(
  workspace: string,
  cfg: ChatFileConfig,
  registry: ProviderRegistry,
  panes: PaneSnapshot[],
): Promise<RecordFromPaneResult[]> {
  const out: RecordFromPaneResult[] = [];
  for (const pane of panes) {
    const provider = registry.detect(pane);
    if (!provider || provider.id === "empty") continue;
    const detection = provider.detect(pane);
    if (!detection) continue;
    out.push(await recordPromptFromPane(workspace, cfg, provider, pane, detection));
  }
  return out;
}
