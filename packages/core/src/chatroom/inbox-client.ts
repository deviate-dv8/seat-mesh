import ky from "ky";
import { expiresAtUtcFromDuration, parseDurationToSeconds } from "./duration.js";

export interface ArmCheckbackInput {
  inboxBase: string;
  ownerPane: string;
  expect: string;
  duration: string;
  renew?: string;
  kind?: string;
  senderPane?: string;
  ownerMini?: string | number | null;
  ownerSlot?: string | number | null;
}

export interface ArmCheckbackResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  response?: unknown;
}

function inboxClient(base: string) {
  return ky.create({
    prefix: base.replace(/\/$/, ""),
    timeout: 5_000,
    retry: { limit: 0 },
  });
}

/** Arm inbox checkback (poll-later). Default on comms so agents keep working instead of human POV chat-wait. */
export async function armCheckback(input: ArmCheckbackInput): Promise<ArmCheckbackResult> {
  if (!input.ownerPane) {
    return { ok: false, reason: "no owner pane (--here / tmux pane required)" };
  }

  const expiresAt = expiresAtUtcFromDuration(input.duration);
  if (!expiresAt) {
    return { ok: false, reason: `bad duration: ${input.duration}` };
  }

  let renewSec: number | null = null;
  if (input.renew) {
    renewSec = parseDurationToSeconds(input.renew);
    if (renewSec == null) {
      return { ok: false, reason: `bad renew: ${input.renew}` };
    }
  }

  const payload = {
    expect: input.expect,
    ownerPane: input.ownerPane,
    expiresAt,
    kind: input.kind ?? "comms",
    renewSec,
    ownerMini: input.ownerMini != null && String(input.ownerMini) !== "" ? input.ownerMini : null,
    ownerSlot: input.ownerSlot != null && String(input.ownerSlot) !== "" ? input.ownerSlot : null,
    senderPane: input.senderPane ?? null,
  };

  try {
    const json = await inboxClient(input.inboxBase).post("patience", { json: payload }).json();
    return { ok: true, response: json };
  } catch (e) {
    const err = e as { response?: Response; message?: string };
    if (err.response) {
      const text = await err.response.text().catch(() => "");
      return { ok: false, reason: `inbox POST ${err.response.status}: ${text.slice(0, 200)}` };
    }
    return { ok: false, reason: err.message ?? String(e) };
  }
}

export async function inboxHealthy(inboxBase: string): Promise<boolean> {
  try {
    await inboxClient(inboxBase).get("health");
    return true;
  } catch {
    return false;
  }
}
