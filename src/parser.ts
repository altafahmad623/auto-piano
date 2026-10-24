import type { Hand, NoteEvent, Song } from './types';

/**
 * Song file format:
 *
 *   Key: A minor
 *   Beat: 3|4
 *   Tempo: 120
 *   R: ED# ED# EB DC | A - - | C E A |
 *   L: | A E A | |
 *
 * - Whitespace separates tokens, '|' is a measure boundary.
 * - A token is one or more glued letters, e.g. "ED#" = E then D# (sequential,
 *   one step each). Chords use brackets: "[CEG]" = C, E, G together (one step).
 * - '-' holds the previous note of that hand for one step.
 * - Optional octave digit after a letter: "E5", "B4". Defaults: R hand = 4, L hand = 3.
 * - Optional fingering suffix `:n` (1–5, thumb=1): "E:1", "[C:1E:3G:5]".
 * - R and L lines pair up by order of appearance; each pair shares the same
 *   measures (a hand missing a line rests).
 * - Each step = one eighth note at Tempo.
 */

const LETTER_RE = /([A-G])([#b]?)(\d?)(?::([1-5]))?/g;
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

interface ParsedNote {
  midi: number;
  finger?: number;
}

interface HandToken {
  kind: 'notes' | 'hold' | 'chord';
  midis: number[];
  fingers: (number | undefined)[];
  steps: number;
}

function noteToMidi(letter: string, accidental: string, octave: number): number {
  const pc = PC[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
  return 12 * (octave + 1) + pc;
}

function parseNoteGroup(text: string, defaultOctave: number): ParsedNote[] {
  const notes: ParsedNote[] = [];
  LETTER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LETTER_RE.exec(text)) !== null) {
    const octave = m[3] ? parseInt(m[3], 10) : defaultOctave;
    notes.push({ midi: noteToMidi(m[1], m[2], octave), finger: m[4] ? parseInt(m[4], 10) : undefined });
  }
  return notes;
}

function parseToken(token: string, defaultOctave: number): HandToken {
  if (token === '-') {
    return { kind: 'hold', midis: [], fingers: [], steps: 1 };
  }
  if (token.startsWith('[') && token.endsWith(']')) {
    const group = parseNoteGroup(token.slice(1, -1), defaultOctave);
    if (group.length === 0) throw new Error(`Empty chord token: ${token}`);
    return {
      kind: 'chord',
      midis: group.map((n) => n.midi),
      fingers: group.map((n) => n.finger),
      steps: 1,
    };
  }
  const notes = parseNoteGroup(token, defaultOctave);
  if (notes.length === 0) throw new Error(`Unrecognized token: ${token}`);
  return {
    kind: 'notes',
    midis: notes.map((n) => n.midi),
    fingers: notes.map((n) => n.finger),
    steps: notes.length,
  };
}

/** Split a line's token stream into measures (array of token arrays). */
function splitMeasures(tokens: string[]): string[][] {
  const measures: string[][] = [[]];
  for (const tok of tokens) {
    if (tok === '|') {
      measures.push([]);
    } else {
      measures[measures.length - 1].push(tok);
    }
  }
  // Drop a trailing empty measure (line ended with '|').
  if (measures.length > 1 && measures[measures.length - 1].length === 0) {
    measures.pop();
  }
  return measures;
}

const OCTAVE_DEFAULT: Record<Hand, number> = { R: 4, L: 3 };

export function parseSong(raw: string, title: string): Song {
  let key = 'unknown';
  let beatsPerMeasure = 4;
  let beatUnit = 4;
  let tempo = 100;

  const rLines: string[][] = [];
  const lLines: string[][] = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const header = /^(Key|Beat|Tempo):\s*(.*)$/.exec(line);
    if (header) {
      if (header[1] === 'Key') key = header[2];
      else if (header[1] === 'Tempo') tempo = parseInt(header[2], 10) || tempo;
      else {
        const beat = /^(\d+)\s*\|\s*(\d+)$/.exec(header[2]);
        if (beat) {
          beatsPerMeasure = parseInt(beat[1], 10);
          beatUnit = parseInt(beat[2], 10);
        }
      }
      continue;
    }

    const handLine = /^([RL]):\s*(.*)$/.exec(line);
    if (handLine) {
      const tokens = handLine[2].trim().split(/\s+/).filter((t) => t.length > 0);
      if (tokens.length > 0) (handLine[1] === 'R' ? rLines : lLines).push(tokens);
      continue;
    }
    // Unknown line: ignore (forward-compatible headers, comments without '#').
  }

  const events: NoteEvent[] = [];
  const measures: { startStep: number }[] = [];
  let stepCursor = 0;
  const lastEvent: Partial<Record<Hand, NoteEvent>> = {};

  const pairs = Math.max(rLines.length, lLines.length);
  for (let p = 0; p < pairs; p++) {
    const rMeasures = rLines[p] ? splitMeasures(rLines[p]) : [];
    const lMeasures = lLines[p] ? splitMeasures(lLines[p]) : [];
    const measureCount = Math.max(rMeasures.length, lMeasures.length);

    for (let m = 0; m < measureCount; m++) {
      measures.push({ startStep: stepCursor });
      let measureSteps = 0;

      for (const hand of ['R', 'L'] as Hand[]) {
        const tokens = (hand === 'R' ? rMeasures[m] : lMeasures[m]) ?? [];
        const parsed = tokens.map((t) => parseToken(t, OCTAVE_DEFAULT[hand]));
        const handSteps = parsed.reduce((sum, t) => sum + t.steps, 0);
        measureSteps = Math.max(measureSteps, handSteps);

        let localStep = 0;
        for (const tok of parsed) {
          if (tok.kind === 'hold') {
            const prev = lastEvent[hand];
            if (prev) prev.steps += 1;
          } else if (tok.kind === 'chord') {
            const ev: NoteEvent = {
              hand,
              midis: tok.midis,
              fingers: tok.fingers,
              startStep: stepCursor + localStep,
              steps: 1,
            };
            events.push(ev);
            lastEvent[hand] = ev;
          } else {
            for (let k = 0; k < tok.midis.length; k++) {
              const ev: NoteEvent = {
                hand,
                midis: [tok.midis[k]],
                fingers: [tok.fingers[k]],
                startStep: stepCursor + localStep,
                steps: 1,
              };
              events.push(ev);
              lastEvent[hand] = ev;
              localStep += 1;
            }
            continue; // localStep already advanced per note
          }
          localStep += tok.steps;
        }
      }
      stepCursor += measureSteps;
    }
  }

  events.sort((a, b) => a.startStep - b.startStep);
  return {
    title,
    key,
    beatsPerMeasure,
    beatUnit,
    tempo,
    events,
    totalSteps: stepCursor,
    measures,
  };
}

export function midiToName(midi: number): string {
  const pc = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return names[pc] + octave;
}
