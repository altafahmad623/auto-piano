import { describe, expect, it } from 'vitest';
import { guessAgrees, guessMidi, LiveDetector } from './detector';

/** `n` samples of a sine wave at `hz`, at `rate`. */
function sine(hz: number, rate: number, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

describe('guessMidi', () => {
  const rate = 12000; // detector's decimated rate at 48kHz

  it('detects a clean sine as the right MIDI note', () => {
    // C4 = 261.63Hz → MIDI 60
    expect(guessMidi(sine(261.63, rate, 1024), rate)).toBe(60);
  });

  it('detects low and high notes within range', () => {
    expect(guessMidi(sine(440, rate, 1024), rate)).toBe(69); // A4
    expect(guessMidi(sine(1046.5, rate, 1024), rate)).toBe(84); // C6
    expect(guessMidi(sine(65.41, rate, 1024), rate)).toBe(36); // C2
  });

  it('returns null for noise (no confident periodicity)', () => {
    const buf = new Float32Array(1024);
    let seed = 12345;
    for (let i = 0; i < buf.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      buf[i] = (seed / 0x3fffffff - 1) * 0.5;
    }
    expect(guessMidi(buf, rate)).toBeNull();
  });
});

describe('LiveDetector.takeWindow', () => {
  interface Internals {
    audioCtx: { sampleRate: number };
    chunks: Float32Array[];
    bufferedSamples: number;
    takeWindow(): Float32Array | null;
  }

  /** Detector with `total` samples buffered as 128-sample worklet chunks, value = global index. */
  function buffered(rate: number, total: number): Internals {
    const d = new LiveDetector({ onNote: () => {} }) as unknown as Internals;
    d.audioCtx = { sampleRate: rate };
    d.chunks = [];
    for (let start = 0; start < total; start += 128) {
      d.chunks.push(Float32Array.from({ length: 128 }, (_, i) => start + i));
    }
    d.bufferedSamples = total;
    return d;
  }

  it('returns null until a full window is buffered', () => {
    expect(buffered(48000, 48000).takeWindow()).toBeNull();
  });

  it('returns the latest full window when buffered size is a multiple of the chunk size', () => {
    // 3s at 48kHz = 144000 = 1125 * 128 → excess after whole-chunk drop is 0.
    const win = buffered(48000, 144000).takeWindow();
    expect(win).not.toBeNull();
    expect(win!.length).toBe(96000);
    expect(win![0]).toBe(48000);
    expect(win![95999]).toBe(143999);
  });

  it('drops whole leading chunks beyond the window', () => {
    const win = buffered(48000, 96000 + 128).takeWindow();
    expect(win![0]).toBe(128);
  });

  it('trims a partial leading chunk', () => {
    // 44100Hz → need 88200 = 689.06 chunks, so the lead chunk is cut mid-way (excess 120).
    const win = buffered(44100, 88320).takeWindow();
    expect(win!.length).toBe(88200);
    expect(win![0]).toBe(120);
    expect(win![88199]).toBe(88319);
  });
});

describe('guessAgrees', () => {
  const seen = new Map([[60, 10]]);

  it('accepts an onset near a stable guess of the same pitch', () => {
    expect(guessAgrees(seen, 60, 10)).toBe(true);
    expect(guessAgrees(seen, 60, 10.9)).toBe(true);
    expect(guessAgrees(seen, 60, 9.1)).toBe(true);
  });

  it('rejects an onset with no guess for that pitch', () => {
    expect(guessAgrees(seen, 61, 10)).toBe(false);
    expect(guessAgrees(seen, 48, 10)).toBe(false);
  });

  it('rejects an onset too far from the guess in time', () => {
    expect(guessAgrees(seen, 60, 11.5)).toBe(false);
    expect(guessAgrees(seen, 60, 8.5)).toBe(false);
  });
});
