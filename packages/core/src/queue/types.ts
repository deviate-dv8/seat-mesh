/**
 * Durable queue rows — producers append; inbox daemon (BullMQ workers) drains.
 */

export type QueueChannel =
  | "inbox"
  | "peer"
  | "checkback"
  | "schedule"
  | "limits"
  | "connectivity"
  | "inject";

export type QueueJobStatus =
  | "pending"
  | "active"
  | "done"
  | "failed"
  | "held";

export interface QueueJobBase {
  id: string;
  channel: QueueChannel;
  status: QueueJobStatus;
  createdAt: string;
  targetPaneId?: string;
  targetSlot?: number;
  priority: number;
}

export interface InjectJob extends QueueJobBase {
  channel: "inject" | "inbox" | "peer";
  body: string;
  prefix?: string;
  meta?: {
    from?: string;
    expectReply?: boolean;
    checkbackId?: string;
  };
}

export interface LimitQueueJob extends QueueJobBase {
  channel: "limits";
  limitId: string;
  providerId: string;
  handler: string;
}

/** Orchestrator goal: best-effort empty all pending jobs fairly. */
export interface QueueDrainPolicy {
  maxInjectPerTick: number;
  digestCooldownMs: number;
  idleSettleMs: number;
  neverInjectWhileTyping: boolean;
}
