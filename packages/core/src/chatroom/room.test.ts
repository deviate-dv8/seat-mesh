import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProfile } from "../profile.js";
import {
  chatRoomConfig,
  createRoom,
  sayInRoom,
  tailRoom,
  looksLikeExpectsReply,
  ensureGlobalRoom,
} from "./room.js";
import { resolveAgentId } from "./agent-id.js";
import { parseDurationToSeconds } from "./duration.js";
import { canBroadcastToGlobal, isGlobalSlug, resolveRoomSlug } from "./global.js";

describe("resolveAgentId", () => {
  it("maps roles", () => {
    expect(resolveAgentId({ role: "manager-mini", mini: 4 })).toBe("mini-4");
    expect(resolveAgentId({ role: "worker", slot: 2 })).toBe("worker-2");
    expect(resolveAgentId({ role: "secretary" })).toBe("secretary");
  });
});

describe("parseDurationToSeconds (ms package)", () => {
  it("parses units", () => {
    expect(parseDurationToSeconds("30s")).toBe(30);
    expect(parseDurationToSeconds("5m")).toBe(300);
    expect(parseDurationToSeconds("1h")).toBe(3600);
  });
});

describe("global room", () => {
  const cfg = {
    root: "tasks/chat-rooms",
    globalSlug: "global",
    checkbackDuration: "5m",
    checkbackRenew: "3m",
    inboxBase: "http://127.0.0.1:1",
  };

  it("resolveRoomSlug defaults to global", () => {
    expect(resolveRoomSlug(cfg)).toBe("global");
    expect(resolveRoomSlug(cfg, "my-contract")).toBe("my-contract");
  });

  it("canBroadcastToGlobal is manager/secretary only", () => {
    expect(canBroadcastToGlobal("manager")).toBe(true);
    expect(canBroadcastToGlobal("secretary")).toBe(true);
    expect(canBroadcastToGlobal("worker")).toBe(false);
    expect(isGlobalSlug(cfg, "global")).toBe(true);
  });
});

describe("looksLikeExpectsReply", () => {
  it("flags human POV questions", () => {
    expect(looksLikeExpectsReply("Would you like me to continue?")).toBe(true);
    expect(looksLikeExpectsReply("CLAIMED: auth/login.block.ts")).toBe(false);
  });
});

describe("room file ops", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seat-mesh-room-"));
  const workspace = tmp;
  const minimalDir = path.resolve(import.meta.dirname, "../../../../profiles/minimal");
  const loaded = loadProfile(minimalDir);
  const cfg = {
    ...chatRoomConfig(loaded.profile),
    root: "tasks/chat-rooms",
    inboxBase: "http://127.0.0.1:1",
  };

  afterEach(() => {
    const rooms = path.join(tmp, "tasks/chat-rooms");
    if (fs.existsSync(rooms)) fs.rmSync(rooms, { recursive: true, force: true });
  });

  it("ensureGlobalRoom auto-creates global", async () => {
    const profile = ensureGlobalRoom(workspace, cfg);
    expect(profile.kind).toBe("global");
    expect(profile.slug).toBe("global");
    await sayInRoom(workspace, cfg, "global", "worker-2", "FYI: global ping", {
      armCheckback: false,
    });
    const lines = await tailRoom(workspace, cfg, "global", 5);
    expect(lines.some((l) => l.body.includes("global ping"))).toBe(true);
  });

  it("create + say + tail", async () => {
    createRoom({
      workspace,
      cfg,
      slug: "test-contract",
      createdBy: "mini-1",
      scope: "slice auth",
    });
    await sayInRoom(workspace, cfg, "test-contract", "mini-4", "CLAIMED: src/foo.ts", {
      armCheckback: false,
    });
    const lines = await tailRoom(workspace, cfg, "test-contract", 10);
    expect(lines).toHaveLength(1);
    expect(lines[0].from).toBe("mini-4");
    expect(lines[0].kind).toBe("claim");
    expect(lines[0].body).toContain("CLAIMED:");
  });
});
