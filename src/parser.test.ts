import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { midiToName, parseSong } from './parser';

const FUR_ELISE = readFileSync(join(__dirname, '../songs/fur-elise.txt'), 'utf-8');

const song = parseSong(FUR_ELISE, 'Fur Elise');

const hand = (h: 'R' | 'L') =>
  song.events.filter((e) => e.hand === h).sort((a, b) => a.startStep - b.startStep);

describe('parseSong', () => {
  it('parses headers', () => {
    expect(song.key).toBe('A minor');
    expect(song.beatsPerMeasure).toBe(3);
    expect(song.beatUnit).toBe(4);
    expect(song.tempo).toBe(120);
  });

  it('expands glued letters into sequential notes (ED# = E then D#)', () => {
    const r = hand('R');
    expect(r[0].midis).toEqual([64]); // E4
    expect(r[0].startStep).toBe(0);
    expect(r[1].midis).toEqual([63]); // D#4
    expect(r[1].startStep).toBe(1);
  });

  it('holds previous note with -', () => {
    const r = hand('R');
    // R line 1: [ED# ED# EB DC] 8 steps, then "A - -": A at step 8 held 3 steps.
    const a = r.find((e) => e.midis[0] === 69 && e.startStep === 8);
    expect(a).toBeDefined();
    expect(a!.steps).toBe(3);
  });

  it('aligns R/L lines pairwise by measure', () => {
    const l = hand('L');
    // L line 1 is "| A E A | |": rests in measure 1 (8 steps, R has 8),
    // then A E A (L hand default octave 3) starting at step 8.
    expect(l[0].startStep).toBe(8);
    expect(l[0].midis).toEqual([57]); // A3
    expect(l[1].midis).toEqual([52]); // E3
    expect(l[2].midis).toEqual([57]); // A3
  });

  it('parses explicit octave digits', () => {
    const explicit = parseSong('R: C4 E5 G6 |', 'octaves');
    expect(explicit.events.map((e) => e.midis[0])).toEqual([60, 76, 91]);
  });

  it('parses chord tokens as one simultaneous event', () => {
    const chord = parseSong('R: [CEG] - |', 'chord');
    expect(chord.events).toHaveLength(1);
    expect(chord.events[0].midis).toEqual([60, 64, 67]);
    expect(chord.events[0].steps).toBe(2); // chord + hold
  });

  it('parses optional fingering suffixes', () => {
    const fing = parseSong('R: E:1 D#:2 [C:1E:3G:5] |', 'fingers');
    expect(fing.events[0].fingers).toEqual([1]);
    expect(fing.events[1].fingers).toEqual([2]);
    expect(fing.events[2].fingers).toEqual([1, 3, 5]);
    // Plain notes keep undefined fingers.
    const plain = parseSong('R: E D |', 'plain');
    expect(plain.events[0].fingers).toEqual([undefined]);
  });

  it('treats missing L lines as rests', () => {
    const only = parseSong('R: C D | E F |', 'right only');
    expect(only.events.every((e) => e.hand === 'R')).toBe(true);
  });

  it('handles holds that follow across measures', () => {
    // R line 2 of Für Elise: "B - - -" = B4 held 4 steps, starting after
    // pair 1's 14 steps. (R1 also contains a B inside "EB" at step 5.)
    const r = hand('R');
    const b = r.find((e) => e.midis[0] === 71 && e.startStep === 14);
    expect(b).toBeDefined();
    expect(b!.steps).toBe(4);
  });
});

describe('midiToName', () => {
  it('round-trips note names', () => {
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(63)).toBe('D#4');
    expect(midiToName(69)).toBe('A4');
    expect(midiToName(21)).toBe('A0');
  });
});
