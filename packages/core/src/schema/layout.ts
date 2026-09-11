import { z } from "zod";
import { gridPaneCapacity } from "../layout/minis.js";

const MinisLeadsSchema = z
  .union([
    z.array(z.number().int().min(1).max(16)),
    z.object({
      top: z.number().int().min(1).max(16).default(1),
      bottom: z.number().int().min(1).max(16).default(2),
    }),
  ])
  .transform((v) => (Array.isArray(v) ? v : [v.top, v.bottom]));

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
      /** Equal grid: `2x2`, `4x2`, etc. `max` must equal cols*rows. */
      grid: z
        .string()
        .regex(/^\d+x\d+$/, "grid must be COLSxROWS e.g. 2x2")
        .default("4x2"),
      max: z.number().int().min(1).max(16).default(8),
      /** Lead mini ids per row (column 0). `[1]` = mini-1 top-left only; `[1,2]` = 4x2 harness layout. */
      leads: MinisLeadsSchema.default([1, 2]),
    })
    .default({
      window: "minis",
      grid: "4x2",
      max: 8,
      leads: [1, 2],
    })
    .superRefine((m, ctx) => {
      const cap = gridPaneCapacity(m.grid);
      if (m.max !== cap) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `minis.max (${m.max}) must equal grid capacity (${cap} for ${m.grid})`,
        });
      }
      for (const id of m.leads) {
        if (id < 1 || id > m.max) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `minis.leads contains ${id} outside 1..${m.max}`,
          });
        }
      }
    }),
});

export type MeshLayout = z.infer<typeof LayoutSchema>;
