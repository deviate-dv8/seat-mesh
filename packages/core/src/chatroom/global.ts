import type { ChatRoomConfig } from "./room.js";

/** Roles that may use `room broadcast` (unrestricted global fan-out). */
export function canBroadcastToGlobal(role: string): boolean {
  const r = role.toLowerCase();
  return r === "manager" || r === "secretary";
}

export function isGlobalSlug(cfg: ChatRoomConfig, slug: string): boolean {
  return slug === cfg.globalSlug;
}

export function resolveRoomSlug(cfg: ChatRoomConfig, slug?: string): string {
  const raw = slug?.trim();
  return raw && raw.length > 0 ? raw : cfg.globalSlug;
}
