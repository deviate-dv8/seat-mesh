import { z } from "zod";

export const LayoutSchema = z.object({
  nvim: z.object({ window: z.string().default("nvim") }).default({}),
  base: z
    .object({
      window: z.string().default("base"),
      columns: z.tuple([z.literal("manager"), z.literal("secretary")]),
    })
    .default({ window: "base", columns: ["manager", "secretary"] }),
  workers: z
    .object({
      window: z.string().default("workers"),
      grid: z.literal("3x2"),
      slots: z.number().int().min(1).max(12).default(6),
    })
    .default({ window: "workers", grid: "3x2", slots: 6 }),
  minis: z
    .object({
      window: z.string().default("minis"),
      grid: z.literal("4x2"),
      max: z.number().int().min(1).max(16).default(8),
      leads: z
        .object({
          top: z.number().int().default(1),
          bottom: z.number().int().default(2),
        })
        .default({ top: 1, bottom: 2 }),
    })
    .default({
      window: "minis",
      grid: "4x2",
      max: 8,
      leads: { top: 1, bottom: 2 },
    }),
});

export type MeshLayout = z.infer<typeof LayoutSchema>;
