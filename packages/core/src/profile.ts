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

  const bundled = path.resolve(
    import.meta.dirname,
    "../../../profiles/minimal/mesh.config.yaml",
  );
  if (fs.existsSync(bundled)) return bundled;

  throw new Error(
    "no profile: pass --profile <path|dir>",
  );
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
    agentsJson: resolveFromWorkspace(workspace, profile.state.agentsJson),
    rolesDir: resolveFromProfile(profileDir, profile.roles.dir),
    managerDir: resolveFromWorkspace(workspace, path.join(profile.seats.root, "manager")),
  };
}
