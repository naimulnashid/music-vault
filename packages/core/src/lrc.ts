import type { LyricLine } from "./types";

const TIME_TAG = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

export function parseLrc(content: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const tags = [...rawLine.matchAll(TIME_TAG)];
    if (tags.length === 0) continue;
    const text = rawLine.replace(TIME_TAG, "").trim();
    for (const tag of tags) {
      const minutes = parseInt(tag[1], 10);
      const seconds = parseInt(tag[2], 10);
      const fraction = tag[3] ? parseInt(tag[3].padEnd(3, "0"), 10) / 1000 : 0;
      const time = minutes * 60 + seconds + fraction;
      lines.push({ time, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

export function findCurrentLineIndex(lines: LyricLine[], currentTime: number): number {
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= currentTime) index = i;
    else break;
  }
  return index;
}

/** Synced lyrics as LRC text (`[mm:ss.xx]line`), the form players read beside a song. */
export function toLrc(lines: LyricLine[]): string {
  return [...lines]
    .sort((a, b) => a.time - b.time)
    .map(({ time, text }) => {
      // Rounded as a whole, so 59.996 s becomes 01:00.00 rather than 00:60.00.
      const cs = Math.max(0, Math.round(time * 100));
      const mm = String(Math.floor(cs / 6000)).padStart(2, "0");
      const ss = String(Math.floor((cs % 6000) / 100)).padStart(2, "0");
      const xx = String(cs % 100).padStart(2, "0");
      return `[${mm}:${ss}.${xx}]${text}\n`;
    })
    .join("");
}
