import { spawnSync } from "node:child_process";
import type { LoadedProfile } from "@seat-mesh/core";
import { createBuiltinRegistry } from "@seat-mesh/providers";
import { snapshotConnectivity } from "@seat-mesh/connectivity";
import { inboxHealth, meshInboxPort } from "./inbox-bridge.js";
import { resolvePaneTarget } from "./resolve-pane.js";
import { capturePaneSnapshot, listSessionPanes } from "./snapshot.js";
import { verifyMeshSession } from "./verify.js";
import { tmuxHasSession } from "./tmux-run.js";
import { listWindowPaneIds } from "./window-panes.js";

export interface SmokeResult {
  name: string;
  pass: boolean;
  detail: string;
}

function row(name: string, pass: boolean, detail: string): SmokeResult {
  return { name, pass, detail };
}

function testOcLimitRegex(): SmokeResult {
  const samples = [
    { text: "rate limit exceeded", want: true },
    { text: "Cannot connect to API", want: true },
    { text: "Working on task", want: false },
  ];
  const ocLimit = /rate limit|usage limit|limit reached|too many requests/i;
  const ocConn = /cannot connect to api|unable to connect/i;
  for (const s of samples) {
    const hit = ocLimit.test(s.text) || ocConn.test(s.text);
    if (hit !== s.want) {
      return row("oc-limit-regex", false, `mismatch on "${s.text}"`);
    }
  }
  return row("oc-limit-regex", true, "limit/connect patterns OK");
}

function testProviderScan(loaded: LoadedProfile): SmokeResult {
  const reg = createBuiltinRegistry(loaded.profile.providers);
  const session = loaded.profile.session.name;
  const panes = listSessionPanes(session);
  if (!panes.length) return row("providers-scan", false, "no panes");
  let live = 0;
  let limits = 0;
  for (const paneId of panes) {
    const snap = capturePaneSnapshot(paneId);
    if (!snap) continue;
    const prov = reg.detect(snap);
    if (!prov) continue;
    live++;
    const st = prov.composerState(snap);
    if (st.phase === "limit") limits++;
  }
  return row(
    "providers-scan",
    live > 0,
    `${live} live CLI panes, ${limits} limit/connect signals`,
  );
}

function testPaneTargets(loaded: LoadedProfile): SmokeResult {
  const session = loaded.profile.session.name;
  const targets = [
    "manager",
    "secretary",
    ...Array.from({ length: loaded.profile.session.workerCount }, (_, i) => String(i + 1)),
    ...Array.from({ length: loaded.profile.session.miniMax }, (_, i) => `mini-${i + 1}`),
  ];
  const missing: string[] = [];
  for (const t of targets) {
    const r = resolvePaneTarget(t, session);
    if ("error" in r) missing.push(`${t}:${r.error}`);
  }
  return row(
    "pane-targets",
    missing.length === 0,
    missing.length ? missing.slice(0, 4).join("; ") : `resolved ${targets.length} targets`,
  );
}

function testMeshInbox(loaded: LoadedProfile): SmokeResult {
  const port = meshInboxPort(loaded);
  const h = inboxHealth(port);
  if (!h) return row("mesh-inbox", false, "mesh-inbox DOWN — ./sm.sh reload or ./sm.sh inbox");
  if (h.engine !== "seat-mesh-daemon") {
    return row(
      "mesh-inbox",
      false,
      `port :${port} is not seat-mesh-daemon (engine=${String(h.engine ?? "?")})`,
    );
  }
  const session = String(h.session ?? "");
  const want = loaded.profile.session.name;
  if (session !== want) {
    return row("mesh-inbox", false, `session=${session} want ${want}`);
  }
  const workerN = Number(h.workerPanes ?? 0);
  const miniN = Number(h.miniPanes ?? 0);
  const ok =
    workerN === loaded.profile.session.workerCount &&
    miniN === loaded.profile.session.miniMax;
  return row(
    "mesh-inbox",
    ok,
    `:${port} workers=${workerN} minis=${miniN} ocLimit=${h.ocLimitActive ?? 0} secretary=${String(h.secretaryPane ?? "none")}`,
  );
}

function testSecretaryPane(loaded: LoadedProfile): SmokeResult {
  const r = resolvePaneTarget("secretary", loaded.profile.session.name);
  if ("error" in r) {
    return row("secretary-pane", false, r.error);
  }
  const snap = capturePaneSnapshot(r.paneId);
  const hasCli = Boolean(snap && createBuiltinRegistry(loaded.profile.providers).detect(snap));
  return row(
    "secretary-pane",
    hasCli,
    hasCli ? `live CLI on ${r.paneId}` : `pane ${r.paneId} is plain shell — ./sm.sh secretary start`,
  );
}

async function testProxy(loaded: LoadedProfile): Promise<SmokeResult> {
  const snap = await snapshotConnectivity(loaded.profile);
  const listen = snap.proxyListen;
  return row(
    "proxy-cpe",
    listen,
    listen
      ? `proxy :${snap.proxyPort} up carrier=${snap.carrierIp ?? "?"}`
      : "CPE proxy not listening — OC limits will not recover",
  );
}

export async function runMeshSmoke(loaded: LoadedProfile): Promise<SmokeResult[]> {
  const results: SmokeResult[] = [];
  if (!tmuxHasSession(loaded.profile.session.name)) {
    results.push(row("session", false, `session ${loaded.profile.session.name} missing`));
    return results;
  }
  results.push(row("session", true, loaded.profile.session.name));

  const verify = verifyMeshSession(loaded);
  results.push(
    row(
      "layout",
      !verify.some((v) => v.level === "error"),
      verify.length ? verify.map((v) => v.message).join("; ") : "OK",
    ),
  );

  results.push(testOcLimitRegex());
  results.push(testPaneTargets(loaded));
  results.push(testProviderScan(loaded));
  results.push(testMeshInbox(loaded));
  results.push(testSecretaryPane(loaded));
  results.push(await testProxy(loaded));
  return results;
}

export function printSmokeResults(results: SmokeResult[]): boolean {
  let fail = 0;
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}: ${r.name} — ${r.detail}`);
    if (!r.pass) fail++;
  }
  console.log(`--- smoke: ${results.length - fail}/${results.length} passed`);
  return fail === 0;
}
