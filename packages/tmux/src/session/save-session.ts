import fs from "node:fs";
import path from "node:path";
import {
  MeshAgentsSchema,
  type CliType,
  type LoadedProfile,
  type MeshAgents,
  type MiniSlot,
  type WorkerSlot,
  mergeMeshAgentsIntoProfile,
  normalizeMinisLeads,
  portsForSlot,
} from "@seat-mesh/core";
import type { ProviderRegistry } from "@seat-mesh/core";
import { buildAgentLaunchCmd } from "../agents/agent-builder.js";
import { loadMeshAgents } from "../agents/agents-state.js";
import { loadMinisState } from "../roles/minis.js";
import {
  listMeshMinis,
  listMeshWorkers,
  meshManagerPane,
  meshSecretaryPane,
} from "../lib/pane-meta.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { tmuxHasSession } from "../lib/tmux-run.js";
import { listWindowPaneIds } from "./window-panes.js";

function cliTypeFromProvider(providerId: string | undefined): CliType {
  if (!providerId) return "empty";
  if (providerId === "cursor-agent") return "agent";
  if (
    providerId === "opencode" ||
    providerId === "claude" ||
    providerId === "kiro" ||
    providerId === "empty"
  ) {
    return providerId;
  }
  return "empty";
}

function detectPane(
  paneId: string,
  registry: ProviderRegistry,
  workspace: string,
): { type: CliType; resumeId: string | null; resumeCmd: string | null } {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) {
    return { type: "empty", resumeId: null, resumeCmd: null };
  }
  const prov = registry.detect(snap);
  if (!prov) {
    return { type: "empty", resumeId: null, resumeCmd: null };
  }
  const det = prov.detect(snap);
  const type = cliTypeFromProvider(prov.id);
  const resumeId = det?.resumeId ?? null;
  const harnessType = type === "agent" ? "agent" : type;
  const resumeCmd =
    type === "empty" ? null : buildAgentLaunchCmd(harnessType, workspace, resumeId);
  return { type, resumeId, resumeCmd };
}

/** Apply mesh-agents.json layout overrides onto a loaded profile. */
export function applyMeshState(loaded: LoadedProfile): LoadedProfile {
  const rel = loaded.profile.state.meshAgentsJson;
  const mesh = loadMeshAgents(loaded.workspace, rel);
  return {
    ...loaded,
    profile: mergeMeshAgentsIntoProfile(loaded.profile, mesh),
  };
}

export function scrapeMeshAgents(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
): MeshAgents {
  const session = loaded.profile.session.name;
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");
  if (!tmuxHasSession(session)) {
    throw new Error(`session '${session}' does not exist — ./sm.sh session up`);
  }

  const minisCfg = layout.minis;
  const minisLayout = {
    grid: minisCfg.grid,
    max: minisCfg.max,
    leads: normalizeMinisLeads(minisCfg.leads),
  };

  const workerPanes = listWindowPaneIds(session, layout.workers.window);
  const miniPanes = listWindowPaneIds(session, layout.minis.window);
  const miniState = loadMinisState(loaded.workspace);

  const workers: WorkerSlot[] = [];
  for (let slot = 1; slot <= loaded.profile.session.workerCount; slot++) {
    const paneId = workerPanes[slot - 1];
    if (!paneId) continue;
    const det = detectPane(paneId, registry, loaded.workspace);
    workers.push({
      type: det.type,
      slot,
      name: `worker-${slot}`,
      ports: portsForSlot(loaded.profile.ports.worker, slot),
      resumeId: det.resumeId,
      resumeCmd: det.resumeCmd,
      paneIndex: slot - 1,
    });
  }

  const minis: MiniSlot[] = [];
  for (let n = 1; n <= minisLayout.max; n++) {
    const paneId = miniPanes[n - 1];
    if (!paneId) continue;
    const det = detectPane(paneId, registry, loaded.workspace);
    const row = miniState.minis[String(n)];
    minis.push({
      type: det.type,
      mini: n,
      name: `mini-${n}`,
      role: row?.job_role,
      task: row?.task,
      resumeId: det.resumeId,
      resumeCmd: det.resumeCmd,
      paneIndex: n - 1,
    });
  }

  const mgrPane = meshManagerPane(session, layout.base.window);
  const secPane = meshSecretaryPane(session, layout.base.window);
  const manager = mgrPane
    ? (() => {
        const det = detectPane(mgrPane, registry, loaded.workspace);
        return {
          type: det.type,
          name: "manager",
          resumeId: det.resumeId,
          resumeCmd: det.resumeCmd,
        };
      })()
    : undefined;

  const secretary = secPane
    ? (() => {
        const det = detectPane(secPane, registry, loaded.workspace);
        return {
          type: det.type === "empty" ? "opencode" : det.type,
          wanted: true,
          resumeId: det.resumeId,
          resumeCmd: det.resumeCmd,
          ports: "secretary",
          paneIndex: 1,
        };
      })()
    : undefined;

  const existing = loadMeshAgents(loaded.workspace, loaded.profile.state.meshAgentsJson);

  return MeshAgentsSchema.parse({
    schemaVersion: 1,
    session,
    workdir: loaded.workspace,
    manager,
    secretary,
    workers,
    minis,
    layout: {
      minis: {
        grid: minisLayout.grid,
        max: minisLayout.max,
        leads: minisLayout.leads,
      },
    },
    conventions: existing?.conventions ?? {
      secretaryDefaultCli: "opencode",
      miniDefaultCli: "opencode",
      launchSkipsEmpty: true,
    },
    updatedAt: new Date().toISOString(),
  });
}

export function saveMeshAgentsFile(workspace: string, relPath: string, data: MeshAgents): string {
  const file = path.join(workspace, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  return file;
}

/** Scrape live mesh session -> mesh-agents.json (layout + slot CLI state). */
export function saveMeshSession(loaded: LoadedProfile, registry: ProviderRegistry): string {
  const rel = loaded.profile.state.meshAgentsJson;
  const data = scrapeMeshAgents(loaded, registry);
  return saveMeshAgentsFile(loaded.workspace, rel, data);
}
