import { BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import '@tensorflow/tfjs';
import { midiToName } from './parser';

/** First MIDI note of the model's 88 output bins (A0). */
const MODEL_BASE_MIDI = 21;

/**
 * Debug diagnostics: "name=<max score>, ..." for the top-scoring bins of a
 * posterior. Empty string when the model produced no frames.
 */
function topBinsLog(label: string, arr: number[][]): string {
  if (arr.length === 0) return `, ${label}: none`;
  const best = new Float32Array(arr[0].length);
  for (const f of arr) {
    for (let i = 0; i < f.length; i++) if (f[i] > best[i]) best[i] = f[i];
  }
  const top = Array.from(best.keys())
    .sort((a, b) => best[b] - best[a])
    .slice(0, 3)
    .filter((i) => best[i] > 0.05);
  if (top.length === 0) return `, ${label}: all <0.05`;
  return `, ${label}: ${top.map((i) => `${midiToName(i + MODEL_BASE_MIDI)}=${best[i].toFixed(2)}`).join(' ')}`;
}

const MODEL_URL = '/model/model.json';
const TARGET_RATE = 22050;
/** Native-rate samples retained (~3s at 48kHz). */
const BUFFER_SECONDS = 3;
/** Inference window length in seconds at native rate. */
const WINDOW_SECONDS = 2;
/** How often we run inference (ms). */
const POLL_MS = 400;
/**
 * Only onsets newer than this (relative to window end) are emitted. Must be
 * large enough to cover inference latency: with a 400ms poll interval, a note
 * stays catchable only while it is within this span of the window end, so if
 * inference takes longer than this, notes age out before emission.
 */
const FRESH_SECONDS = 1.5;
/** Same pitch within this window (absolute seconds) is deduplicated. */
const DEDUP_SECONDS = 0.4;
/** Note/onset confidence thresholds for the basic-pitch model. */
const ONSET_THRESHOLD = 0.3;
const FRAME_THRESHOLD = 0.25;

const WORKLET_SRC = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0][0];
    if (ch) this.port.postMessage(new Float32Array(ch));
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

function resampleLinear(data: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return data;
  const ratio = toRate / fromRate;
  const outLen = Math.floor(data.length * ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i / ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, data.length - 1);
    out[i] = data[i0] + (data[i1] - data[i0]) * (pos - i0);
  }
  return out;
}

export interface NoteOnset {
  midi: number;
  /** Seconds since the detector started. */
  time: number;
  amplitude: number;
  /**
   * True when the mono autocorrelation guess was stable on this pitch within
   * GUESS_AGREE_SECONDS of the onset. Basic-pitch hallucinates low notes on
   * near-silence with real-note amplitudes; the guess is the cross-check.
   * Chords: only the dominant member will be confirmed (the guess is mono).
   */
  confirmed: boolean;
}

export interface LiveDetectorCallbacks {
  onNote: (onset: NoteOnset) => void;
  /** Live input level (RMS, 0..1), emitted ~10x/s. */
  onLevel?: (rms: number) => void;
  /** Quick mono pitch guess from autocorrelation, ~10x/s. Null when silent/unsure. */
  onGuess?: (midi: number | null) => void;
}

// Live-guess downsampling: analyze every Nth sample at a reduced rate.
const GUESS_DIV = 4;
const GUESS_BUF = 1024;
const GUESS_MIN_MIDI = 24; // C1 — lowest pitch the guess attempts
const GUESS_MAX_MIDI = 96; // C7
const GUESS_MIN_R = 0.6; // correlation confidence required
const LEVEL_FLOOR = 0.004; // below this RMS, report silence
const INFO_MS = 100; // onLevel/onGuess emit cadence
/** Same pitch must repeat this many consecutive updates before it's shown. */
const GUESS_STABLE_COUNT = 3;

/** An onset is trusted only if a stable guess for the same pitch occurred within this many seconds. */
const GUESS_AGREE_SECONDS = 1;
/**
 * Windows quieter than this RMS skip inference entirely. Observed room-noise
 * RMS was 0.002–0.01; tune against a real-piano recording (soft presses must
 * stay above it). See plan 004 §3ii.
 */
const WINDOW_MIN_RMS = 0.015;

/** Diagnostics are logged only with localStorage.debugDetector = '1'. */
function debugEnabled(): boolean {
  try {
    return localStorage.getItem('debugDetector') === '1';
  } catch {
    return false;
  }
}

/** Root-mean-square of a sample buffer. */
export function windowRms(buf: Float32Array): number {
  let sum = 0;
  for (const v of buf) sum += v * v;
  return Math.sqrt(sum / buf.length);
}

/** True if `midi` was a stable guess within GUESS_AGREE_SECONDS of `time`. */
export function guessAgrees(seen: ReadonlyMap<number, number>, midi: number, time: number): boolean {
  const t = seen.get(midi);
  return t !== undefined && Math.abs(t - time) <= GUESS_AGREE_SECONDS;
}

function midiHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Normalized autocorrelation over `buf` at `rate` — returns MIDI or null. */
export function guessMidi(buf: Float32Array, rate: number): number | null {
  const minLag = Math.max(2, Math.floor(rate / midiHz(GUESS_MAX_MIDI)));
  const maxLag = Math.min(buf.length - 1, Math.floor(rate / midiHz(GUESS_MIN_MIDI)));
  const n = buf.length - maxLag;
  if (n < minLag) return null;
  // r[lag] for every candidate lag. Harmonics correlate at integer multiples
  // of the period too, so the strongest peak may sit at k*T; we resolve to the
  // fundamental by taking the earliest interior local peak within 0.05 of the
  // best correlation. (Lags at minLag are excluded: their left neighbor is
  // unwritten and low-frequency content correlates strongly at tiny lags.)
  const r = new Float32Array(maxLag + 1);
  let bestR = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let dot = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < n; i++) {
      const a = buf[i];
      const b = buf[i + lag];
      dot += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    r[lag] = dot / (Math.sqrt(e1 * e2) || 1);
    if (r[lag] > bestR) bestR = r[lag];
  }
  if (bestR < GUESS_MIN_R) return null;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const isPeak = r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1];
    if (isPeak && r[lag] >= bestR - 0.05) {
      // Parabolic interpolation for sub-lag resolution (integer lags are
      // coarse relative to period at high pitches).
      const y0 = r[lag - 1];
      const y1 = r[lag];
      const y2 = r[lag + 1];
      const denom = y0 - 2 * y1 + y2;
      const shift = denom === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom));
      return Math.round(69 + 12 * Math.log2(rate / (lag + shift) / 440));
    }
  }
  return null;
}

/**
 * Live polyphonic pitch detection. Captures the mic through an AudioWorklet,
 * keeps a rolling buffer, and every POLL_MS runs basic-pitch over the last
 * WINDOW_SECONDS, emitting note onsets as they appear in the fresh region.
 */
export class LiveDetector {
  private basicPitch: BasicPitch | null = null;
  private audioCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private workletUrl: string | null = null;
  private chunks: Float32Array[] = [];
  private bufferedSamples = 0;
  private pollTimer: number | null = null;
  private startedAt = 0;
  private inferring = false;
  private stopped = false;
  private readonly lastEmitted = new Map<number, number>();
  private readonly cb: LiveDetectorCallbacks;
  // Live-guess state: decimated ring buffer + level accumulation.
  private guessBuf = new Float32Array(GUESS_BUF);
  private guessWrite = 0;
  private levelSquares = 0;
  private levelCount = 0;
  private lastInfoAt = 0;
  private stableGuess: number | null = null;
  private stableCount = 0;
  /** MIDI → last time (seconds since start) it was a stable guess. */
  private readonly guessSeen = new Map<number, number>();

  constructor(callbacks: LiveDetectorCallbacks) {
    this.cb = callbacks;
  }

  async start(): Promise<void> {
    if (this.audioCtx) return; // already running

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    this.audioCtx = new AudioContext();
    if (this.audioCtx.state === 'suspended') {
      // Autoplay policy can leave the context suspended; the worklet then
      // receives silence even though getUserMedia succeeded.
      await this.audioCtx.resume();
    }
    const src = this.audioCtx.createMediaStreamSource(this.stream);

    this.workletUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    await this.audioCtx.audioWorklet.addModule(this.workletUrl);
    const node = new AudioWorkletNode(this.audioCtx, 'capture-processor');
    node.port.onmessage = (e) => this.pushChunk(e.data as Float32Array);
    src.connect(node);
    // Do not connect to destination — no monitoring feedback.

    if (!this.basicPitch) this.basicPitch = new BasicPitch(MODEL_URL);
    await this.basicPitch.model; // ensure weights are loaded before first poll

    this.startedAt = performance.now() / 1000;
    this.stopped = false;
    this.pollTimer = window.setInterval(() => void this.poll(), POLL_MS);
  }

  private pushChunk(chunk: Float32Array): void {
    this.chunks.push(chunk);
    this.bufferedSamples += chunk.length;
    const maxSamples = this.audioCtx!.sampleRate * BUFFER_SECONDS;
    while (this.bufferedSamples > maxSamples && this.chunks.length > 1) {
      const first = this.chunks[0];
      this.chunks.shift();
      this.bufferedSamples -= first.length;
    }

    for (let i = 0; i < chunk.length; i++) {
      this.levelSquares += chunk[i] * chunk[i];
    }
    this.levelCount += chunk.length;
    for (let i = 0; i < chunk.length; i += GUESS_DIV) {
      this.guessBuf[this.guessWrite] = chunk[i];
      this.guessWrite = (this.guessWrite + 1) % GUESS_BUF;
    }
    this.maybeEmitInfo();
  }

  /** Throttled onLevel/onGuess emission (~10x/s). */
  private maybeEmitInfo(): void {
    const now = performance.now();
    if (now - this.lastInfoAt < INFO_MS) return;
    this.lastInfoAt = now;

    const rms = this.levelCount > 0 ? Math.sqrt(this.levelSquares / this.levelCount) : 0;
    this.levelSquares = 0;
    this.levelCount = 0;
    this.cb.onLevel?.(rms);

    // Guess tracking runs even without an onGuess consumer: the `confirmed`
    // flag on onsets (and the calibration gate) depend on guessSeen.
    // Require the same pitch on consecutive updates before trusting it:
    // ambient noise produces random hits, a held note stays stable.
    if (rms < LEVEL_FLOOR) {
      this.stableGuess = null;
      this.stableCount = 0;
      this.cb.onGuess(null);
      return;
    }
    // Unwrap the ring buffer into chronological order.
    const ordered = new Float32Array(GUESS_BUF);
    ordered.set(this.guessBuf.subarray(this.guessWrite), 0);
    ordered.set(this.guessBuf.subarray(0, this.guessWrite), GUESS_BUF - this.guessWrite);
    const midi = guessMidi(ordered, this.audioCtx!.sampleRate / GUESS_DIV);
    if (midi === null || midi !== this.stableGuess) {
      this.stableGuess = midi;
      this.stableCount = midi === null ? 0 : 1;
    } else {
      this.stableCount++;
    }
    if (this.stableCount >= GUESS_STABLE_COUNT && midi !== null) {
      this.guessSeen.set(midi, now / 1000 - this.startedAt);
      this.cb.onGuess?.(midi);
    }
  }

  private takeWindow(): Float32Array | null {
    const rate = this.audioCtx!.sampleRate;
    const need = Math.floor(rate * WINDOW_SECONDS);
    if (this.bufferedSamples < need) return null;

    // Drop whole leading chunks that end before the window starts.
    let excess = this.bufferedSamples - need;
    while (this.chunks.length > 1 && this.chunks[0].length <= excess) {
      excess -= this.chunks[0].length;
      this.bufferedSamples -= this.chunks[0].length;
      this.chunks.shift();
    }

    const win = new Float32Array(need);
    const lead = this.chunks[0];
    const startInLead = excess;
    const first = lead.subarray(startInLead);
    win.set(first, 0);
    let filled = first.length;
    for (let i = 1; i < this.chunks.length && filled < need; i++) {
      const c = this.chunks[i];
      const n = Math.min(c.length, need - filled);
      win.set(c.subarray(0, n), filled);
      filled += n;
    }
    return filled === need ? win : null;
  }

  private async poll(): Promise<void> {
    if (this.inferring || this.stopped || !this.basicPitch) return;
    const native = this.takeWindow();
    if (!native) return;

    this.inferring = true;
    try {
      // Window end time must be captured BEFORE inference: after a potentially
      // long await it would drift, shifting every note's computed time and
      // breaking both the freshness filter and deduplication.
      const windowEndAbs = performance.now() / 1000 - this.startedAt;
      const inferStart = performance.now();
      const rate = this.audioCtx!.sampleRate;
      const rms = windowRms(native);
      if (rms < WINDOW_MIN_RMS) {
        // Near-silence is where basic-pitch hallucinates; skip inference.
        if (debugEnabled()) console.log(`[detector] rms ${rms.toFixed(4)} below floor, skipping inference`);
        return;
      }
      const resampled = resampleLinear(native, rate, TARGET_RATE);

      const frames: number[][] = [];
      const onsets: number[][] = [];
      await this.basicPitch.evaluateModel(
        resampled,
        (f: number[][], o: number[][]) => {
          frames.push(...f);
          onsets.push(...o);
        },
        () => {},
      );

      const notes = noteFramesToTime(
        outputToNotesPoly(frames, onsets, ONSET_THRESHOLD, FRAME_THRESHOLD, 2),
      );
      const inferMs = performance.now() - inferStart;
      if (debugEnabled()) {
        console.log(
          `[detector] rms ${rms.toFixed(4)}, inference ${inferMs.toFixed(0)}ms, frames ${frames.length}, notes ${notes.length}` +
            topBinsLog('onsets', onsets) +
            topBinsLog('frames', frames) +
            (notes.length > 0
              ? `, detected ${notes
                  .map((n) => `${midiToName(n.pitchMidi)}@${n.startTimeSeconds.toFixed(2)}(${n.amplitude.toFixed(2)})`)
                  .join(' ')}`
              : ''),
        );
      }

      const windowStartAbs = windowEndAbs - WINDOW_SECONDS;
      const unconfirmed: string[] = [];
      for (const note of notes) {
        if (note.startTimeSeconds < WINDOW_SECONDS - FRESH_SECONDS) continue;
        const abs = windowStartAbs + note.startTimeSeconds;
        const last = this.lastEmitted.get(note.pitchMidi) ?? -Infinity;
        if (abs - last < DEDUP_SECONDS) continue;
        const confirmed = guessAgrees(this.guessSeen, note.pitchMidi, abs);
        if (!confirmed) unconfirmed.push(`${midiToName(note.pitchMidi)}(${note.amplitude.toFixed(2)})`);
        this.lastEmitted.set(note.pitchMidi, abs);
        this.cb.onNote({ midi: note.pitchMidi, time: abs, amplitude: note.amplitude, confirmed });
      }
      if (unconfirmed.length > 0 && debugEnabled()) {
        console.log(`[detector] unconfirmed (no matching guess): ${unconfirmed.join(' ')}`);
      }
    } finally {
      this.inferring = false;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.chunks = [];
    this.bufferedSamples = 0;
    this.guessBuf = new Float32Array(GUESS_BUF);
    this.guessWrite = 0;
    this.levelSquares = 0;
    this.levelCount = 0;
    this.lastInfoAt = 0;
    this.stableGuess = null;
    this.stableCount = 0;
    this.guessSeen.clear();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.audioCtx?.close();
    this.audioCtx = null;
    if (this.workletUrl) URL.revokeObjectURL(this.workletUrl);
    this.workletUrl = null;
  }
}
