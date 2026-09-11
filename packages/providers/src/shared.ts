import type { Detection, PaneSnapshot, ComposerState, PromptCapture } from "@seat-mesh/core";

/** Process cmdlines attached to snapshot (from pane tree walk). */
export function cmdlines(pane: PaneSnapshot): string[] {
  const raw = pane.options.processCmdlines ?? "";
  if (!raw) return [];
  return raw.split("\0").filter(Boolean);
}

export function matchAny(cmdlines: string[], patterns: RegExp[]): boolean {
  for (const line of cmdlines) {
    for (const re of patterns) {
      if (re.test(line)) return true;
    }
  }
  return false;
}

export function extractUuid(cmd: string, flags: string[]): string | undefined {
  for (const flag of flags) {
    const re = new RegExp(`${flag}[= ]([0-9a-fA-F-]{36})`);
    const m = cmd.match(re);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

const OC_LIMIT_RE =
  /rate limit|usage limit|limit reached|too many requests/i;
const OC_CONNECT_RE =
  /cannot connect to api|unable to connect|connection error|ECONNREFUSED/i;
const CC_LIMIT_RE =
  /rate limit|usage limit|try again|quota/i;

export function composerFromCapture(
  pane: PaneSnapshot,
  providerId: string,
): ComposerState {
  const tail = pane.captureTail;
  if (!tail.trim()) {
    return { phase: "plain_shell" };
  }

  if (providerId === "opencode" && OC_CONNECT_RE.test(tail)) {
    return { phase: "limit", limitKind: "oc-connect" };
  }
  if (
    (providerId === "opencode" || providerId === "claude") &&
    OC_LIMIT_RE.test(tail)
  ) {
    return { phase: "limit", limitKind: "oc-limit" };
  }
  if (providerId === "claude" && CC_LIMIT_RE.test(tail)) {
    return { phase: "limit", limitKind: "cc-limit" };
  }

  if (/Working|Running|Thinking/.test(tail)) {
    const m = tail.match(/(Working|Running|Thinking[^\n]*)/);
    return { phase: "busy", busyLabel: m?.[1] ?? "busy" };
  }

  if (/AFK|Stuck|draft/.test(tail)) {
    return { phase: "afk" };
  }

  // Composer draft heuristic: non-empty last lines without prompt submit
  const lines = tail.split("\n").filter((l) => l.trim());
  const last = lines.at(-1) ?? "";
  if (last.length > 2 && !/^[❯›]/.test(last)) {
    return { phase: "typing", draftFingerprint: last.slice(0, 80) };
  }

  return { phase: "empty" };
}

const MANAGER_PREFIX_RE = /^\[agent-manager[^\]]*\]\s*/;
const PROMPT_LINE_RE = /^[❯›>]\s/;
const NOISE_LINE_RE =
  /^(Working|Running|Thinking|AFK|Stuck|typing|empty|plain_shell|\s*$)/i;

function isNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (NOISE_LINE_RE.test(t)) return true;
  if (/^(esc|ctrl|enter)\b/i.test(t)) return true;
  return false;
}

function isNoiseBlock(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 3) return true;
  if (/^(Working|Running|Thinking)/.test(t)) return true;
  return false;
}

/** Shared scrape heuristic for all CLI providers (pane capture, not chat UI). */
export function scrapePromptTurnGeneric(pane: PaneSnapshot): PromptCapture | null {
  const raw = pane.captureTail;
  if (!raw?.trim()) return null;

  const lines = [...raw.split("\n")];
  while (lines.length && isNoiseLine(lines[lines.length - 1]!)) {
    lines.pop();
  }
  if (!lines.length) return null;

  let humanStart = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line || isNoiseLine(line)) continue;
    if (MANAGER_PREFIX_RE.test(line) || PROMPT_LINE_RE.test(line)) {
      humanStart = i;
      break;
    }
  }

  if (humanStart < 0) {
    const blocks = raw
      .split(/\n\n+/)
      .map((b) => b.trim())
      .filter((b) => b && !isNoiseBlock(b));
    if (blocks.length < 2) return null;
    const human = blocks[blocks.length - 2]!;
    const response = blocks[blocks.length - 1]!;
    return { humanPrompt: human, agentResponse: response };
  }

  const firstHuman = lines[humanStart]!
    .replace(MANAGER_PREFIX_RE, "")
    .replace(PROMPT_LINE_RE, "")
    .trim();
  const humanLines = [firstHuman];
  let i = humanStart + 1;
  for (; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (!l) break;
    if (PROMPT_LINE_RE.test(l) || MANAGER_PREFIX_RE.test(l)) break;
    humanLines.push(l);
  }
  let rs = i;
  while (rs < lines.length && !lines[rs]!.trim()) rs++;
  const response = lines
    .slice(rs)
    .filter((l) => !isNoiseLine(l))
    .join("\n")
    .trim();
  const human = humanLines.join("\n").trim();

  if (!human || !response || human.length < 2 || response.length < 2) return null;
  if (isNoiseBlock(response)) return null;
  return { humanPrompt: human, agentResponse: response };
}

export function sessionIdFromDetection(detection: Detection): string | undefined {
  return detection.resumeId;
}

export function extractFlagValue(cmd: string, flag: string): string | undefined {
  const re = new RegExp(`${flag}=([^\\s]+)|${flag}\\s+([^\\s]+)`);
  const m = cmd.match(re);
  return m?.[1] ?? m?.[2];
}

export function modelFromCmdlines(
  lines: string[],
  fallback?: string,
): string | undefined {
  for (const line of lines) {
    const m = extractFlagValue(line, "--model");
    if (m) return m;
  }
  return fallback;
}
