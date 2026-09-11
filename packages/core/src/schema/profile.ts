import { z } from "zod";
import { LayoutSchema } from "./layout.js";

const ConnectivityPolicySchema = z.object({
  rebootWifiBounce: z.boolean().default(false),
  smartRestart: z.boolean().default(false),
  rotateMaxAttempts: z.number().int().min(0).default(3),
  cooldownMs: z.number().int().min(0).default(1_800_000),
});

const ConnectivityDriversSchema = z
  .object({
    cpe: z
      .object({
        host: z.string().default("192.168.100.1"),
        rebootPath: z.string().default("/api/system/fun"),
      })
      .optional(),
    gost: z
      .object({
        container: z.string().optional(),
      })
      .optional(),
  })
  .optional();

export const MeshProfileSchema = z.object({
  name: z.string().min(1),
  workspace: z.string().min(1),
  layout: LayoutSchema.optional(),
  session: z.object({
    name: z.string().default("dev"),
    workerCount: z.number().int().min(1).max(32).default(6),
    miniMax: z.number().int().min(1).max(16).default(8),
  }),
  orchestrator: z
    .object({
      redisUrl: z.string().default("redis://127.0.0.1:6379"),
      drain: z
        .object({
          maxInjectPerTick: z.number().int().default(1),
          digestCooldownMs: z.number().int().default(5000),
          idleSettleMs: z.number().int().default(5000),
        })
        .default({}),
    })
    .optional(),
  providers: z
    .array(z.enum(["cursor-agent", "kiro", "claude", "opencode", "empty"]))
    .default(["cursor-agent", "kiro", "claude", "opencode", "empty"]),
  seats: z.object({
    root: z.string().default("tasks/agent-seats"),
    templates: z.array(z.string()).default(["FOCUS", "TASKS", "REMINDER"]),
    dirs: z
      .object({
        manager: z.string().default("manager"),
        secretary: z.string().default("secretary"),
        worker: z.string().default("slot-{n}"),
        mini: z.string().default("minis.json"),
      })
      .optional(),
  }),
  state: z.object({
    agentsJson: z.string().default("tmux-main-agents.json"),
  }),
  daemon: z
    .object({
      port: z.number().int().default(3099),
      pollMs: z.number().int().default(4000),
      idleSettleSec: z.number().int().default(5),
      managerPromptPrefix: z
        .string()
        .default("[agent-manager-kiro-cursor-claude]"),
    })
    .default({}),
  ports: z
    .object({
      worker: z.string().default("30{n}0/30{n}1"),
    })
    .default({}),
  roles: z.object({
    dir: z.string().default("roles"),
  }),
  connectivity: z
    .object({
      enabled: z.boolean().default(false),
      proxyPort: z.number().int().default(18887),
      drivers: ConnectivityDriversSchema,
      policy: ConnectivityPolicySchema.default({}),
    })
    .optional(),
  chatRooms: z
    .object({
      root: z.string().default("tasks/chat-rooms"),
      /** Default room for every tmux agent; manager/secretary broadcast here. */
      globalSlug: z.string().default("global"),
      checkback: z
        .object({
          duration: z.string().default("5m"),
          renew: z.string().default("3m"),
        })
        .default({}),
    })
    .optional(),
  chatFiles: z
    .object({
      root: z.string().default("tasks/chat-files"),
      filename: z.string().default("CHAT.jsonl"),
    })
    .optional(),
  /** Local dev stack driver (pseudo-attach: exec dc.sh until @seat-mesh/stack replaces it). */
  stack: z
    .object({
      command: z.string().default("./dc.sh"),
      summary: z.string().optional(),
    })
    .optional(),
});

export type MeshProfile = z.infer<typeof MeshProfileSchema>;
export type ConnectivityPolicy = z.infer<typeof ConnectivityPolicySchema>;
