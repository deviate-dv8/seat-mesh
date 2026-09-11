import fs from "node:fs";
import path from "node:path";
import { createReadStream } from "node:fs";
import ndjson from "ndjson";
import lockfile from "proper-lockfile";
import readLastLines from "read-last-lines";

/** Append one JSON object as a jsonl row (locked; safe for parallel agents). */
export async function appendJsonlLine(file: string, row: unknown): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "");
  }
  const release = await lockfile.lock(file, { stale: 15_000 });
  try {
    await fs.promises.appendFile(file, `${JSON.stringify(row)}\n`, "utf8");
  } finally {
    await release();
  }
}

/** Stream-parse entire jsonl file (ndjson). */
export async function readJsonlAll<T>(
  file: string,
  parse: (row: unknown) => T | null,
): Promise<T[]> {
  if (!fs.existsSync(file)) return [];
  const out: T[] = [];
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .pipe(ndjson.parse())
      .on("data", (row: unknown) => {
        const parsed = parse(row);
        if (parsed != null) out.push(parsed);
      })
      .on("end", () => resolve())
      .on("error", reject);
  });
  return out;
}

/** Last N physical lines (efficient tail; parse each as JSON). */
export async function readJsonlTail<T>(
  file: string,
  lineCount: number,
  parse: (row: unknown) => T | null,
): Promise<T[]> {
  if (!fs.existsSync(file)) return [];
  const n = Math.max(1, lineCount);
  const chunk = await readLastLines.read(file, n);
  const out: T[] = [];
  for (const line of chunk.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = parse(JSON.parse(trimmed));
      if (parsed != null) out.push(parsed);
    } catch {
      // skip corrupt line
    }
  }
  return out;
}
