import { spawnSync } from "node:child_process";
import { Command } from "commander";
import {
  type LoadedProfile,
  type RoomMessageKind,
  chatRoomConfig,
  createRoom,
  sayInRoom,
  tailRoom,
  listRooms,
  resolveAgentId,
  resolveRoomSlug,
  ensureGlobalRoom,
  canBroadcastToGlobal,
  isGlobalSlug,
} from "@seat-mesh/core";
import { runWhoami } from "@seat-mesh/tmux";

function tmuxOpt(pane: string, key: string): string {
  const r = spawnSync("tmux", ["display-message", "-t", pane, "-p", key], { encoding: "utf8" });
  if (r.status !== 0) return "";
  return (r.stdout ?? "").trim();
}

function resolveFrom(loaded: LoadedProfile, explicit?: string): string {
  if (explicit) return explicit;
  const w = runWhoami(loaded);
  const mini = tmuxOpt(w.paneId ?? "", "#{@mesh_mini}") || tmuxOpt(w.paneId ?? "", "#{@zsign_mini}");
  return resolveAgentId({ role: w.role, slot: w.slot, mini: mini || null });
}

function resolvePane(explicit?: string): string | undefined {
  return explicit ?? process.env.TMUX_PANE ?? undefined;
}

function paneContext(loaded: LoadedProfile) {
  const w = runWhoami(loaded);
  const mini = tmuxOpt(w.paneId ?? "", "#{@mesh_mini}") || tmuxOpt(w.paneId ?? "", "#{@zsign_mini}");
  return { w, mini };
}

async function runSay(
  loaded: LoadedProfile,
  roomSlug: string,
  body: string,
  opts: {
    kind?: RoomMessageKind;
    checkback?: boolean;
    from?: string;
    pane?: string;
  },
): Promise<void> {
  const cfg = chatRoomConfig(loaded.profile);
  const slug = resolveRoomSlug(cfg, roomSlug);
  const { w, mini } = paneContext(loaded);
  const ownerPane = resolvePane(opts.pane);
  const result = await sayInRoom(loaded.workspace, cfg, slug, resolveFrom(loaded, opts.from), body, {
    kind: opts.kind,
    armCheckback: opts.checkback !== false,
    ownerPane,
    senderPane: ownerPane,
    ownerMini: mini || null,
    ownerSlot: w.slot,
  });
  console.log(`ok room=${slug} id=${result.message.id} kind=${result.message.kind}`);
  if (result.checkback?.skipped) {
    console.log(`checkback: skipped (${result.checkback.reason ?? "?"})`);
  } else if (result.checkback && !result.checkback.ok) {
    console.log(`checkback: failed (${result.checkback.reason ?? "?"})`);
  } else if (result.checkback?.ok) {
    console.log("checkback: armed");
  }
}

export function buildRoomCommands(getLoaded: () => LoadedProfile): Command {
  const room = new Command("room").description(
    "ChatRoom ledger — default room is global (all tmux agents)",
  );

  room
    .command("list")
    .description("List chat room slugs (global always present)")
    .action(() => {
      const loaded = getLoaded();
      const cfg = chatRoomConfig(loaded.profile);
      ensureGlobalRoom(loaded.workspace, cfg);
      const slugs = new Set(listRooms(loaded.workspace, cfg));
      slugs.add(cfg.globalSlug);
      for (const slug of [...slugs].sort()) {
        const tag = isGlobalSlug(cfg, slug) ? "\t(global — all agents)" : "";
        console.log(`${slug}${tag}`);
      }
    });

  room
    .command("create")
    .alias("open")
    .description("Open a named chat contract (not global)")
    .argument("<slug>", "room slug (cannot be global slug)")
    .option("--scope <text>", "contract scope")
    .option("--lead <id>", "lead agent id (e.g. mini-1)")
    .option("--supervisor <id>", "supervisor agent id (often secretary)")
    .option("--members <ids>", "comma-separated member ids")
    .option("--from <id>", "creator agent id (default: tmux pane)")
    .action((slug, opts) => {
      const loaded = getLoaded();
      const cfg = chatRoomConfig(loaded.profile);
      if (isGlobalSlug(cfg, slug)) {
        console.error(`slug "${slug}" is reserved for the global room`);
        process.exit(2);
      }
      const profile = createRoom({
        workspace: loaded.workspace,
        cfg,
        slug,
        createdBy: resolveFrom(loaded, opts.from),
        kind: "contract",
        scope: opts.scope,
        lead: opts.lead,
        supervisor: opts.supervisor,
        members: opts.members?.split(",").map((s: string) => s.trim()),
      });
      console.log(`room=${profile.slug} path=${loaded.workspace}/${cfg.root}/${slug}`);
      console.log(`createdBy=${profile.createdBy}`);
    });

  room
    .command("say")
    .description("Append a line (default room: global)")
    .argument("<message...>", "ledger line — omit slug to use global")
    .option("-r, --room <slug>", "target room (default: global)")
    .option("--kind <kind>", "claim|done|blocked|fyi|broadcast|status|msg")
    .option("--no-checkback", "skip inbox checkback arm")
    .option("--from <id>", "sender agent id")
    .option("--pane <id>", "tmux pane for checkback target")
    .action(async (messageParts: string[], opts) => {
      const loaded = getLoaded();
      const body = messageParts.join(" ").trim();
      if (!body) {
        console.error("room say: message required");
        process.exit(2);
      }
      const cfg = chatRoomConfig(loaded.profile);
      const slug = resolveRoomSlug(cfg, opts.room);
      await runSay(loaded, slug, body, opts);
    });

  room
    .command("broadcast")
    .description("Manager/secretary: fan-out line to global (all agents)")
    .argument("<message...>", "BROADCAST line to every agent")
    .option("--no-checkback", "skip inbox checkback arm")
    .option("--from <id>", "sender agent id")
    .option("--pane <id>", "tmux pane for checkback target")
    .action(async (messageParts: string[], opts) => {
      const loaded = getLoaded();
      const { w } = paneContext(loaded);
      if (!canBroadcastToGlobal(w.role)) {
        console.error(`room broadcast: manager/secretary only (you_are=${w.role})`);
        process.exit(2);
      }
      const body = messageParts.join(" ").trim();
      if (!body) {
        console.error("room broadcast: message required");
        process.exit(2);
      }
      const cfg = chatRoomConfig(loaded.profile);
      await runSay(loaded, cfg.globalSlug, body, { ...opts, kind: "broadcast" });
    });

  room
    .command("tail")
    .description("Show last N lines (default room: global)")
    .option("-r, --room <slug>", "room slug (default: global)")
    .option("-n, --lines <n>", "line count", "50")
    .action(async (opts) => {
      const loaded = getLoaded();
      const cfg = chatRoomConfig(loaded.profile);
      const slug = resolveRoomSlug(cfg, opts.room);
      const n = Number.parseInt(String(opts.lines), 10) || 50;
      const lines = await tailRoom(loaded.workspace, cfg, slug, n);
      for (const row of lines) {
        console.log(`${row.ts}\t${row.from}\t${row.kind}\t${row.body}`);
      }
    });

  return room;
}

export function buildContractCommands(getLoaded: () => LoadedProfile): Command {
  const contract = new Command("contract").description("Alias: open a parallel chat contract");

  contract
    .command("create")
    .alias("open")
    .description("Same as room create (not global)")
    .argument("<slug>", "room slug")
    .option("--scope <text>", "contract scope")
    .option("--lead <id>", "lead agent id")
    .option("--supervisor <id>", "supervisor agent id")
    .option("--members <ids>", "comma-separated member ids")
    .option("--from <id>", "creator agent id")
    .action((slug, opts) => {
      const loaded = getLoaded();
      const cfg = chatRoomConfig(loaded.profile);
      if (isGlobalSlug(cfg, slug)) {
        console.error(`slug "${slug}" is reserved for the global room`);
        process.exit(2);
      }
      const profile = createRoom({
        workspace: loaded.workspace,
        cfg,
        slug,
        createdBy: resolveFrom(loaded, opts.from),
        kind: "contract",
        scope: opts.scope,
        lead: opts.lead,
        supervisor: opts.supervisor,
        members: opts.members?.split(",").map((s: string) => s.trim()),
      });
      console.log(`room=${profile.slug} path=${loaded.workspace}/${cfg.root}/${slug}`);
      console.log(`createdBy=${profile.createdBy}`);
    });

  return contract;
}
