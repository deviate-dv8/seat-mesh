/** Parse `2x2` / `4x2` grid spec from profile. */
export function parseGridSpec(grid: string): { cols: number; rows: number } {
  const m = /^(\d+)x(\d+)$/.exec(grid.trim());
  if (!m) {
    throw new Error(`invalid grid spec "${grid}" (expected COLSxROWS e.g. 2x2)`);
  }
  const cols = Number.parseInt(m[1], 10);
  const rows = Number.parseInt(m[2], 10);
  if (cols < 1 || rows < 1 || cols > 8 || rows > 8) {
    throw new Error(`grid out of range: ${grid}`);
  }
  return { cols, rows };
}

export function gridPaneCapacity(grid: string): number {
  const { cols, rows } = parseGridSpec(grid);
  return cols * rows;
}

/** Legacy `{ top, bottom }` or modern `[1]` / `[1, 2]`. */
export function normalizeMinisLeads(
  leads: number[] | { top: number; bottom: number },
): number[] {
  if (Array.isArray(leads)) return leads;
  return [leads.top, leads.bottom];
}

/**
 * Visual row-major order of mini ids after leads-left placement.
 * Each `leads[row]` anchors column 0 of that row; other ids fill left-to-right.
 */
export function computeMinisWantOrder(
  cols: number,
  rows: number,
  max: number,
  leads: number[],
): string[] {
  const total = Math.min(max, cols * rows);
  const allMinis = Array.from({ length: total }, (_, i) => String(i + 1));
  const leadSet = new Set(leads.map(String));
  const nonLeads = allMinis.filter((m) => !leadSet.has(m));

  const want: string[] = [];
  let nonIdx = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (want.length >= total) break;
      if (col === 0 && row < leads.length) {
        want.push(String(leads[row]));
      } else {
        while (nonIdx < nonLeads.length && want.includes(nonLeads[nonIdx])) {
          nonIdx++;
        }
        if (nonIdx >= nonLeads.length) {
          throw new Error(
            `computeMinisWantOrder: not enough minis for ${cols}x${rows} max=${max} leads=${leads.join(",")}`,
          );
        }
        want.push(nonLeads[nonIdx++]);
      }
    }
  }

  return want.slice(0, total);
}
