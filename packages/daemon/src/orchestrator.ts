/**
 * Inbox orchestrator — only component allowed to inject into tmux panes.
 * Producers enqueue; BullMQ workers drain (see workers.ts).
 */

import type { QueueDrainPolicy, InjectJob, ProviderRegistry } from "@seat-mesh/core";

export interface OrchestratorDeps {
  registry: ProviderRegistry;
  policy: QueueDrainPolicy;
  /** Append-only queue writers (jsonl + Redis). */
  enqueue(job: InjectJob): Promise<void>;
}

export class InboxOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  /**
   * Tick goal: best-effort empty pending inject jobs without stomping composers.
   * Implementation: phase 3 — port from inbox-server.mjs poll loop + BullMQ.
   */
  async drainTick(): Promise<{ attempted: number; delivered: number; held: number }> {
    return { attempted: 0, delivered: 0, held: 0 };
  }
}
