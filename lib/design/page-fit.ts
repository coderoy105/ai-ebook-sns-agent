export type FittablePageRow = {
  page_number: number;
  layout_type: string;
  content: Record<string, unknown>;
};

const structuralLayouts = new Set(["Cover", "TableOfContents", "ChapterOpening"]);

function markdownOf(row: FittablePageRow) {
  return typeof row.content.markdown === "string" ? row.content.markdown.trim() : "";
}

function wordCount(value: string) {
  return value.split(/\s+/u).filter(Boolean).length;
}

function isContent(row: FittablePageRow) {
  return !structuralLayouts.has(row.layout_type) && markdownOf(row).length > 0;
}

function mergedSectionIds(left: FittablePageRow, right: FittablePageRow) {
  const values = [
    ...(Array.isArray(left.content.sectionIds) ? left.content.sectionIds : []),
    left.content.sectionId,
    ...(Array.isArray(right.content.sectionIds) ? right.content.sectionIds : []),
    right.content.sectionId
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  return [...new Set(values)];
}

function nearestNaturalBreak(markdown: string) {
  const half = Math.floor(markdown.length / 2);
  const minimum = Math.floor(markdown.length * 0.28);
  const maximum = Math.ceil(markdown.length * 0.72);
  const candidates: number[] = [];

  for (const match of markdown.matchAll(/\n\s*\n/g)) {
    const index = match.index ?? -1;
    if (index >= minimum && index <= maximum) candidates.push(index + match[0].length);
  }
  for (const match of markdown.matchAll(/[.!?。！？](?:["'”’)]*)?\s+/g)) {
    const index = (match.index ?? -1) + match[0].length;
    if (index >= minimum && index <= maximum) candidates.push(index);
  }

  if (candidates.length) return candidates.sort((a, b) => Math.abs(a - half) - Math.abs(b - half))[0];

  let before = markdown.lastIndexOf(" ", half);
  let after = markdown.indexOf(" ", half);
  if (before < minimum) before = -1;
  if (after > maximum) after = -1;
  if (before > 0 && after > 0) return half - before <= after - half ? before + 1 : after + 1;
  if (before > 0) return before + 1;
  if (after > 0) return after + 1;
  return -1;
}

function renumber<T extends FittablePageRow>(rows: T[]) {
  return rows.map((row, index) => ({ ...row, page_number: index + 1 }));
}

/**
 * Makes the canonical composed-page list respect the user's FINAL page target.
 * It only changes page boundaries: manuscript text is never discarded.
 */
export function fitComposedPagesToTarget<T extends FittablePageRow>(inputRows: readonly T[], targetPages: number): T[] {
  const target = Math.max(1, Math.round(targetPages));
  const rows = inputRows.map((row) => ({ ...row, content: { ...row.content } })) as T[];
  let guard = 0;

  while (rows.length > target && guard++ < 4000) {
    let bestIndex = -1;
    let bestWords = Number.POSITIVE_INFINITY;
    for (let index = 0; index < rows.length - 1; index += 1) {
      if (!isContent(rows[index]) || !isContent(rows[index + 1])) continue;
      const combined = wordCount(markdownOf(rows[index])) + wordCount(markdownOf(rows[index + 1]));
      if (combined < bestWords) {
        bestWords = combined;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0) {
      const left = rows[bestIndex];
      const right = rows[bestIndex + 1];
      const markdown = [markdownOf(left), markdownOf(right)].filter(Boolean).join("\n\n");
      rows.splice(bestIndex, 2, {
        ...left,
        content: {
          ...left.content,
          markdown,
          sectionIds: mergedSectionIds(left, right)
        }
      } as T);
      continue;
    }

    // A short book may have so many ChapterOpening rows that there are no
    // adjacent content rows left to merge. Remove the decorative opening page;
    // the chapter heading remains in the manuscript/PDF content itself.
    const removableOpening = rows.findIndex((row, index) => index > 1 && row.layout_type === "ChapterOpening");
    if (removableOpening >= 0) {
      rows.splice(removableOpening, 1);
      continue;
    }
    break;
  }

  guard = 0;
  while (rows.length < target && guard++ < 4000) {
    let bestIndex = -1;
    let largestWords = 0;
    for (let index = 0; index < rows.length; index += 1) {
      if (!isContent(rows[index])) continue;
      const words = wordCount(markdownOf(rows[index]));
      if (words > largestWords) {
        largestWords = words;
        bestIndex = index;
      }
    }
    if (bestIndex < 0 || largestWords < 24) break;

    const row = rows[bestIndex];
    const markdown = markdownOf(row);
    const boundary = nearestNaturalBreak(markdown);
    if (boundary <= 0 || boundary >= markdown.length) break;
    const first = markdown.slice(0, boundary).trim();
    const second = markdown.slice(boundary).trim();
    if (!first || !second) break;

    rows.splice(bestIndex, 1,
      { ...row, content: { ...row.content, markdown: first } } as T,
      { ...row, content: { ...row.content, markdown: second } } as T
    );
  }

  return renumber(rows) as T[];
}
