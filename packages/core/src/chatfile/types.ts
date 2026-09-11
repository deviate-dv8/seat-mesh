import { z } from "zod";

export const SlotPromptRecordSchema = z.object({
  id: z.string().uuid(),
  ts: z.string().datetime(),
  /** worker-1, mini-3, manager, secretary */
  slot: z.string().min(1),
  paneId: z.string().optional(),
  providerId: z.string().min(1),
  sessionId: z.string().optional(),
  model: z.string().optional(),
  humanPrompt: z.string().min(1),
  agentResponse: z.string().optional(),
  /** sha256 prefix for dedupe on record/scrape */
  turnHash: z.string().optional(),
});

export type SlotPromptRecord = z.infer<typeof SlotPromptRecordSchema>;

export interface PromptQuery {
  slot?: string;
  providerId?: string;
  sessionId?: string;
  model?: string;
  since?: string;
  limit?: number;
}
