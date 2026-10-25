import { describe, expect, it } from 'vitest';
import { PracticeMatcher, REARM_SECONDS } from './matcher';
import type { Hand, NoteEvent, Song } from './types';

/** A single-hand song made of the given per-event MIDI lists, in order. */
function songOf(midis: number[][]): Song {
  const events: NoteEvent[] = midis.map((m, i) => ({
    hand: 'R' as Hand,
    midis: m,
    startStep: i * 4,
    steps: 2,
  }));
  return {
    title: 'test',
    key: 'C',
    beatsPerMeasure: 4,
    beatUnit: 4,
    tempo: 120,
    events,
    totalSteps: midis.length * 4,
    measures: [{ startStep: 0 }],
  };
}

describe('PracticeMatcher single notes', () => {
  it('advances on a confirmed correct note', () => {
    const m = new PracticeMatcher(songOf([[60], [62]]), 'R');
    expect(m.feed(60, 1, true)).toBe('hit');
    expect(m.progress).toBe(0.5);
  });

  it('ignores an unconfirmed match (hallucination must not flash or advance)', () => {
    const m = new PracticeMatcher(songOf([[60]]), 'R');
    expect(m.feed(60, 1, false)).toBe('ignored');
    expect(m.progress).toBe(0);
    expect(m.mistakeCount).toBe(0);
  });

  it('advances once the same pitch arrives confirmed', () => {
    const m = new PracticeMatcher(songOf([[60]]), 'R');
    expect(m.feed(60, 1, false)).toBe('ignored');
    expect(m.feed(60, 2, true)).toBe('hit');
    expect(m.done).toBe(true);
  });

  it('counts a wrong confirmed note as a miss', () => {
    const m = new PracticeMatcher(songOf([[60]]), 'R');
    expect(m.feed(62, 1, true)).toBe('miss');
    expect(m.mistakeCount).toBe(1);
    expect(m.progress).toBe(0);
  });

  it('debounces repeated wrong notes', () => {
    const m = new PracticeMatcher(songOf([[60]]), 'R');
    expect(m.feed(62, 1, true)).toBe('miss');
    expect(m.feed(62, 1.2, true)).toBe('ignored');
    expect(m.mistakeCount).toBe(1);
  });

  it('accepts a profile-shifted pitch', () => {
    const m = new PracticeMatcher(songOf([[60]]), 'R', {
      name: 'p',
      offsets: { 60: 61 },
    });
    expect(m.feed(61, 1, true)).toBe('hit');
  });
});

describe('PracticeMatcher chords', () => {
  it('requires every member detected', () => {
    const m = new PracticeMatcher(songOf([[60, 64, 67]]), 'R');
    expect(m.feed(60, 1, true)).toBe('chord-progress');
    expect(m.feed(64, 1.1, false)).toBe('chord-progress');
    expect(m.feed(67, 1.2, false)).toBe('hit');
    expect(m.done).toBe(true);
  });

  it('requires at least one confirmed anchor', () => {
    const m = new PracticeMatcher(songOf([[60, 64]]), 'R');
    expect(m.feed(60, 1, false)).toBe('chord-progress');
    expect(m.feed(64, 1.1, false)).toBe('chord-progress');
    expect(m.done).toBe(false);
    expect(m.feed(60, 1.5, true)).toBe('hit');
  });

  it('does not advance when only some members are covered', () => {
    const m = new PracticeMatcher(songOf([[60, 64]]), 'R');
    expect(m.feed(60, 1, true)).toBe('chord-progress');
    expect(m.feed(62, 1.2, true)).toBe('miss');
    expect(m.done).toBe(false);
  });
});

describe('PracticeMatcher re-arm on repeated pitches', () => {
  it('ignores a re-detected decay within REARM_SECONDS, accepts a fresh press after', () => {
    const m = new PracticeMatcher(songOf([[60], [60]]), 'R');
    expect(m.feed(60, 1, true)).toBe('hit');
    // Decaying/re-detected same pitch shortly after the hit.
    expect(m.feed(60, 1 + REARM_SECONDS - 0.1, true)).toBe('ignored');
    expect(m.progress).toBe(0.5);
    // A new press after the re-arm window satisfies the second event.
    expect(m.feed(60, 1 + REARM_SECONDS + 0.1, true)).toBe('hit');
    expect(m.done).toBe(true);
  });

  it('re-arms per pitch across chord members', () => {
    const m = new PracticeMatcher(songOf([[60, 64], [64]]), 'R');
    expect(m.feed(60, 1, true)).toBe('chord-progress');
    expect(m.feed(64, 1.1, false)).toBe('hit');
    // The 64 that just hit cannot immediately satisfy the next single 64.
    expect(m.feed(64, 1.2, true)).toBe('ignored');
    expect(m.feed(64, 1.2 + REARM_SECONDS, true)).toBe('hit');
    expect(m.done).toBe(true);
  });
});
