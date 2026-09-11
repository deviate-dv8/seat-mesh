import { z } from "zod";

export const CommsFromSchema = z.object({
  kind: z.enum(["worker", "mini", "secretary", "manager", "daemon", "schedule"]),
  slot: z.number().int().optional(),
  mini: z.number().int().optional(),
  paneId: z.string().optional(),
});

export const CommsToSchema = z.object({
  paneId: z.string().optional(),
  slot: z.number().int().optional(),
  mini: z.number().int().optional(),
  role: z.enum(["manager", "secretary"]).optional(),
});

export const CommsEnvelopeSchema = z.object({
  id: z.string().uuid().optional(),
  channel: z.enum(["inbox", "peer", "coord", "inject"]),
  from: CommsFromSchema,
  to: CommsToSchema,
  body: z.string().min(1),
  prefixMode: z
    .enum(["manager", "worker", "mini-peer", "mini-ask", "plain", "none"])
    .optional(),
  priority: z.number().int().default(0),
  expectReply: z.boolean().default(false),
  meta: z
    .object({
      kind: z.enum(["ack", "substance", "prove", "blocked", "fyi"]).optional(),
      scheduleId: z.string().optional(),
    })
    .optional(),
  createdAt: z.string().datetime().optional(),
});

export type CommsEnvelope = z.infer<typeof CommsEnvelopeSchema>;
