import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export interface RoleIndexEntry {
  path: string;
  note?: string;
}

export interface RolePolicy {
  id: string;
  text?: string;
  path?: string;
  rule?: string;
  cmd?: string;
}

export interface RoleIndex {
  kind: string;
  read_first?: RoleIndexEntry[];
  policies?: RolePolicy[];
  files?: string[];
  inject?: string[];
  vars?: Record<string, string>;
}

export function loadRoleIndex(rolesDir: string, kind: string): RoleIndex {
  const file = path.join(rolesDir, `${kind}.yaml`);
  if (!fs.existsSync(file)) {
    throw new Error(`role index missing: ${file}`);
  }
  const data = YAML.parse(fs.readFileSync(file, "utf8")) as RoleIndex;
  if (!data.kind) data.kind = kind;
  return data;
}

function substituteVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function renderRoleIndex(
  index: RoleIndex,
  vars: Record<string, string> = {},
): string {
  const lines: string[] = [];

  for (const item of index.read_first ?? []) {
    const p = substituteVars(item.path, vars);
    const note = item.note ? substituteVars(item.note, vars) : "";
    lines.push(`file=${p}${note ? ` | ${note}` : ""}`);
  }

  for (const pol of index.policies ?? []) {
    if (pol.path) {
      lines.push(
        `policy_${pol.id}=${substituteVars(pol.path, vars)}${pol.rule ? ` | ${substituteVars(pol.rule, vars)}` : ""}`,
      );
    } else if (pol.text) {
      lines.push(`policy_${pol.id}=${substituteVars(pol.text, vars)}`);
    } else if (pol.cmd) {
      lines.push(`policy_${pol.id}=${substituteVars(pol.cmd, vars)}`);
    }
  }

  for (const f of index.files ?? []) {
    lines.push(`file=${substituteVars(f, vars)}`);
  }

  for (const [k, v] of Object.entries(index.vars ?? {})) {
    lines.push(`${k}=${substituteVars(v, vars)}`);
  }

  for (const line of index.inject ?? []) {
    lines.push(`inject=${substituteVars(line, vars)}`);
  }

  return lines.join("\n");
}

export function validateRoleIndex(
  index: RoleIndex,
  workspace: string,
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  const check = (rel: string) => {
    const p = path.isAbsolute(rel) ? rel : path.resolve(workspace, rel);
    if (!fs.existsSync(p)) missing.push(rel);
  };

  for (const item of index.read_first ?? []) check(item.path);
  for (const pol of index.policies ?? []) {
    if (pol.path) check(pol.path);
  }
  for (const f of index.files ?? []) check(f);

  return { ok: missing.length === 0, missing };
}
