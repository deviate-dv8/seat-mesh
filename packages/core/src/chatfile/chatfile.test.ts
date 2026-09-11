import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendSlotPrompt, querySlotPrompts, tailSlotPrompts, turnHash } from "./store.js";
import { resolveSlotKeyFromPane } from "./slot.js";
import type { PaneSnapshot } from "../providers/types.js";

describe("chatfile store", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  it("appends and dedupes by turnHash", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chatfile-"));
    const cfg = { root: "tasks/chat-files", filename: "CHAT.jsonl" };
    const ws = tmp;
    const base = path.join(ws, cfg.root);
    fs.mkdirSync(base, { recursive: true });

    const a = await appendSlotPrompt(ws, cfg, {
      slot: "worker-1",
      providerId: "cursor-agent",
      sessionId: "sess-1",
      model: "composer",
      humanPrompt: "fix the bug",
      agentResponse: "done",
    });
    const b = await appendSlotPrompt(ws, cfg, {
      slot: "worker-1",
      providerId: "cursor-agent",
      sessionId: "sess-1",
      model: "composer",
      humanPrompt: "fix the bug",
      agentResponse: "done",
    });
    expect(a.id).toBe(b.id);
    const tail = await tailSlotPrompts(ws, cfg, "worker-1", 10);
    expect(tail).toHaveLength(1);
  });

  it("queries by session and provider", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chatfile-"));
    const cfg = { root: "tasks/chat-files", filename: "CHAT.jsonl" };
    const ws = tmp;
    fs.mkdirSync(path.join(ws, cfg.root), { recursive: true });

    await appendSlotPrompt(ws, cfg, {
      slot: "worker-2",
      providerId: "claude",
      sessionId: "abc",
      humanPrompt: "hello",
      agentResponse: "hi",
    });
    await appendSlotPrompt(ws, cfg, {
      slot: "worker-3",
      providerId: "opencode",
      sessionId: "xyz",
      humanPrompt: "ping",
      agentResponse: "pong",
    });

    const bySession = await querySlotPrompts(ws, cfg, { sessionId: "abc" });
    expect(bySession).toHaveLength(1);
    expect(bySession[0]?.providerId).toBe("claude");

    const byProvider = await querySlotPrompts(ws, cfg, { providerId: "opencode" });
    expect(byProvider).toHaveLength(1);
    expect(byProvider[0]?.slot).toBe("worker-3");
  });
});

describe("turnHash", () => {
  it("is stable for same input", () => {
    const h = turnHash({ sessionId: "s", humanPrompt: "a", agentResponse: "b" });
    expect(h).toBe(turnHash({ sessionId: "s", humanPrompt: "a", agentResponse: "b" }));
  });
});

describe("resolveSlotKeyFromPane", () => {
  it("maps pane options", () => {
    const pane: PaneSnapshot = {
      paneId: "%1",
      windowName: "workers",
      cwd: "/tmp",
      currentCommand: "agent",
      captureTail: "",
      options: { mesh_role: "worker", mesh_slot: "3" },
    };
    expect(resolveSlotKeyFromPane(pane)).toBe("worker-3");
  });
});
