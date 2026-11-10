// Minimal SRT subtitle parser + cue lookup.
// SRT files in CourseVault libraries sit next to a video with the same stem,
// e.g. "01 - Intro.srt" next to "01 - Intro.mp4".

export interface SubtitleCue {
  start: number; // seconds
  end: number; // seconds
  text: string;
}

function parseTimecode(tc: string): number {
  // "00:01:23,456" (comma) or "00:01:23.456" (dot)
  const m = tc.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!m) return 0;
  const hours = parseInt(m[1] || '0', 10);
  const minutes = parseInt(m[2], 10);
  const seconds = parseInt(m[3], 10);
  const millis = parseInt(m[4], 10);
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

export function parseSrt(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  // Split on blank lines; each block is: index, timecode line, text lines.
  const blocks = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    // First line may be the numeric index — skip it if so.
    const timeLine = /^\d+$/.test(lines[0]) ? lines[1] : lines[0];
    if (!timeLine || !timeLine.includes('-->')) continue;
    const [startRaw, endRaw] = timeLine.split('-->');
    const textLines = (/^\d+$/.test(lines[0]) ? lines.slice(2) : lines.slice(1)).filter(
      (l) => !l.includes('-->'),
    );
    const cue: SubtitleCue = {
      start: parseTimecode(startRaw),
      end: parseTimecode(endRaw),
      text: textLines.join('\n'),
    };
    if (cue.text && cue.end > cue.start) cues.push(cue);
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/** The cue active at a given playback position, if any. */
export function cueAt(cues: SubtitleCue[], positionSeconds: number): SubtitleCue | null {
  for (const cue of cues) {
    if (positionSeconds >= cue.start && positionSeconds < cue.end) return cue;
    if (cue.start > positionSeconds) break;
  }
  return null;
}
