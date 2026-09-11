import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { MeshProfileSchema, type MeshProfile } from "./schema/profile.js";
import { resolveWorkspace, resolveFromWorkspace, resolveFromProfile } from "./paths.js";

export interface LoadedProfile {
  profile: MeshProfile;
  profileDir: string;
  profilePath: string;
  workspace: string;
}

/** seat-mesh package root (profiles/ lives here). */
export function seatMeshPackageRoot(): string {
  return path.resolve(import.meta.dirname, "../../..");
}

/** Default profile: zsign consumer checkout, else minimal demo. No flags required. */
export function defaultProfilePath(): string {
  const root = seatMeshPackageRoot();
  const candidates = [
    path.join(root, "profiles/zsign/mesh.config.yaml"),
    path.join(root, "profiles/minimal/mesh.config.yaml"),
  ];
  for (const cfg of candidates) {
    if (fs.existsSync(cfg)) return cfg;
  }
  throw new Error(`no default profile under ${root}/profiles/`);
}

export function findProfilePath(explicit?: string): string {
  if (explicit) {
    const p = path.resolve(explicit);
    if (fs.statSync(p).isDirectory()) {
      const cfg = path.join(p, "mesh.config.yaml");
      if (!fs.existsSync(cfg)) {
        throw new Error(`profile directory missing mesh.config.yaml: ${p}`);
      }
      return cfg;
    }
    if (!fs.existsSync(p)) throw new Error(`profile not found: ${p}`);
    return p;
  }

  return defaultProfilePath();
}

export function loadProfile(explicit?: string): LoadedProfile {
  const profilePath = findProfilePath(explicit);
  const profileDir = path.dirname(profilePath);
  const raw = YAML.parse(fs.readFileSync(profilePath, "utf8"));
  const profile = MeshProfileSchema.parse(raw);
  const workspace = resolveWorkspace(profile.workspace, profileDir);

  return { profile, profileDir, profilePath, workspace };
}

export function profilePaths(loaded: LoadedProfile) {
  const { profile, profileDir, workspace } = loaded;
  return {
    seatsRoot: resolveFromWorkspace(workspace, profile.seats.root),
    /** Legacy harness state file path (read-only seed). */
    agentsJson: resolveFromWorkspace(workspace, profile.state.agentsJson),
    /** Mesh-owned slot state file path. */
    meshAgentsJson: resolveFromWorkspace(workspace, profile.state.meshAgentsJson),
    rolesDir: resolveFromProfile(profileDir, profile.roles.dir),
    managerDir: resolveFromWorkspace(workspace, path.join(profile.seats.root, "manager")),
  };
}
