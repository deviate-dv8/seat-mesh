import fs from "node:fs";
import path from "node:path";
import type { PaneOpRow } from "@seat-mesh/core";

export interface CheckbackRow {
  id: string;
  kind: string;
  status: "active" | "cancelled";
  renewSec?: number;
  expect?: string;
  ownerPane?: string;
  expiresAt?: string;
  senderLabel?: string;
  recipientLabel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToMasterRow {
  id: string;
  at: string;
  from: string;
  slot: string | null;
  ports: string | null;
  msg: string;
  sent: boolean;
  resolved: boolean;
  read: boolean;
}

export type PeerKind = "to-slot" | "to-mini" | "prompt" | "remind";

export interface PeerRow {
  id: string;
  at: string;
  kind: PeerKind;
  fromSlot: string;
  fromPorts: string | null;
  targetPane: string;
  targetLabel: string;
  msg: string;
  sent: boolean;
}

export class JsonlStore {
  constructor(
    readonly stateDir: string,
    readonly log: (line: string) => void = () => {},
  ) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  get checkbackPath(): string {
    return path.join(this.stateDir, "CHECKBACK.jsonl");
  }
  get inboxPath(): string {
    return path.join(this.stateDir, "INBOX.jsonl");
  }
  get peerPath(): string {
    return path.join(this.stateDir, "PEER.jsonl");
  }
  get paneOpsPath(): string {
    return path.join(this.stateDir, "PANE_OPS.jsonl");
  }

  readCheckbacks(): CheckbackRow[] {
    return this.readJsonl<CheckbackRow>(this.checkbackPath);
  }

  writeCheckbacks(rows: CheckbackRow[]): void {
    this.writeJsonl(this.checkbackPath, rows);
  }

  upsertCheckback(row: CheckbackRow): CheckbackRow {
    const rows = this.readCheckbacks().filter((r) => r.id !== row.id);
    rows.push(row);
    this.writeCheckbacks(rows);
    return row;
  }

  cancelCheckback(id: string): boolean {
    const rows = this.readCheckbacks();
    let hit = false;
    for (const r of rows) {
      if (r.id === id || r.id.startsWith(id)) {
        r.status = "cancelled";
        r.updatedAt = new Date().toISOString();
        hit = true;
      }
    }
    if (hit) this.writeCheckbacks(rows);
    return hit;
  }

  readInbox(): ToMasterRow[] {
    return this.readJsonl<ToMasterRow>(this.inboxPath);
  }

  writeInbox(rows: ToMasterRow[]): void {
    this.writeJsonl(this.inboxPath, rows);
  }

  appendInbox(row: ToMasterRow): void {
    fs.appendFileSync(this.inboxPath, JSON.stringify(row) + "\n", { encoding: "utf8", flag: "a" });
  }

  readPeer(): PeerRow[] {
    return this.readJsonl<PeerRow>(this.peerPath);
  }

  writePeer(rows: PeerRow[]): void {
    this.writeJsonl(this.peerPath, rows);
  }

  appendPeer(row: PeerRow): void {
    fs.appendFileSync(this.peerPath, JSON.stringify(row) + "\n", { encoding: "utf8", flag: "a" });
  }

  readPaneOps(): PaneOpRow[] {
    return this.readJsonl<PaneOpRow>(this.paneOpsPath);
  }

  writePaneOps(rows: PaneOpRow[]): void {
    this.writeJsonl(this.paneOpsPath, rows);
  }

  appendPaneOp(row: PaneOpRow): void {
    fs.appendFileSync(this.paneOpsPath, JSON.stringify(row) + "\n", {
      encoding: "utf8",
      flag: "a",
    });
  }

  updatePaneOp(row: PaneOpRow): void {
    const rows = this.readPaneOps();
    const i = rows.findIndex((r) => r.id === row.id);
    if (i >= 0) {
      rows[i] = row;
      this.writePaneOps(rows);
    }
  }

  countPaneOpsPending(): number {
    return this.readPaneOps().filter((r) => r.status === "pending" || r.status === "running").length;
  }

  formatInboxInject(row: ToMasterRow): string {
    const who =
      row.slot != null
        ? `slot-${row.slot}${row.ports ? ` (${row.ports})` : ""}`
        : row.from || "unknown";
    const body = String(row.msg || "").trim().slice(0, 400);
    return `[INBOX ${who}]: ${body}`;
  }

  private readJsonl<T>(file: string): T[] {
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as T;
        } catch {
          return null;
        }
      })
      .filter((r): r is T => r !== null);
  }

  private writeJsonl(file: string, rows: unknown[]): void {
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  }
}
