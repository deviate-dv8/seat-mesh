import { z } from "zod";

export const RoomMessageKindSchema = z.enum([
  "claim",
  "done",
  "blocked",
  "fyi",
  "status",
  "broadcast",
  "msg",
]);

export type RoomMessageKind = z.infer<typeof RoomMessageKindSchema>;

export const RoomMessageSchema = z.object({
  id: z.string().uuid(),
  ts: z.string().datetime(),
  from: z.string().min(1),
  kind: RoomMessageKindSchema.default("msg"),
  body: z.string().min(1),
  pane: z.string().optional(),
  expectReply: z.boolean().default(false),
});

export type RoomMessage = z.infer<typeof RoomMessageSchema>;

export const RoomKindSchema = z.enum(["global", "contract"]);

export type RoomKind = z.infer<typeof RoomKindSchema>;

export const RoomProfileSchema = z.object({
  slug: z.string().min(1),
  kind: RoomKindSchema.default("contract"),
  createdAt: z.string().datetime(),
  createdBy: z.string().min(1),
  scope: z.string().optional(),
  /** Empty = all tmux agents (global default). Contract rooms may list explicit members. */
  members: z.array(z.string()).default([]),
  lead: z.string().optional(),
  supervisor: z.string().optional(),
});

export type RoomProfile = z.infer<typeof RoomProfileSchema>;
