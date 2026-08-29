export type FitsPage = (content: string) => boolean;

export type PaginationOptions = {
  minimumNaturalBreakRatio?: number;
  maxPages?: number;
};

function lastMatchEnd(text: string, regex: RegExp, minIndex: number) {
  let result = -1;
  for (const match of text.matchAll(regex)) {
    const end = (match.index ?? -1) + match[0].length;
    if (end >= minIndex) result = end;
  }
  return result;
}

export function preferredNaturalBreak(chunk: string, minimumRatio = 0.58) {
  if (!chunk) return 0;
  const minIndex = Math.max(1, Math.floor(chunk.length * minimumRatio));
  const paragraph = lastMatchEnd(chunk, /\n\s*\n/g, minIndex);
  if (paragraph > 0) return paragraph;

  const sentence = lastMatchEnd(chunk, /[.!?。！？](?:["'”’)]*)?(?:\s+|$)/g, minIndex);
  if (sentence > 0) return sentence;

  const line = lastMatchEnd(chunk, /\n/g, minIndex);
  if (line > 0) return line;

  const word = lastMatchEnd(chunk, /\s+/g, minIndex);
  if (word > 0) return word;

  return chunk.length;
}

function largestFittingEnd(value: string, start: number, fits: FitsPage) {
  let low = start + 1;
  let high = value.length;
  let best = start;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (fits(value.slice(start, middle))) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return best > start ? best : Math.min(value.length, start + 1);
}

export function paginateMeasuredManuscript(value: string, fits: FitsPage, options: PaginationOptions = {}) {
  if (!value) return [""];
  const minimumNaturalBreakRatio = options.minimumNaturalBreakRatio ?? 0.58;
  const maxPages = options.maxPages ?? 2000;
  const pages: string[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    if (pages.length >= maxPages) {
      pages.push(value.slice(cursor));
      break;
    }

    const hardEnd = largestFittingEnd(value, cursor, fits);
    if (hardEnd >= value.length) {
      pages.push(value.slice(cursor));
      break;
    }

    const hardChunk = value.slice(cursor, hardEnd);
    const naturalOffset = preferredNaturalBreak(hardChunk, minimumNaturalBreakRatio);
    const end = naturalOffset > 0 ? cursor + naturalOffset : hardEnd;
    pages.push(value.slice(cursor, end));
    cursor = Math.max(end, cursor + 1);
  }

  return pages.length ? pages : [""];
}

export function paginationIsLossless(source: string, pages: readonly string[]) {
  return pages.join("") === source;
}
