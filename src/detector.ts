import { BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import '@tensorflow/tfjs';

const MODEL_URL = '/model/model.json';
const TARGET_RATE = 22050;
/** Native-rate samples retained (~3s at 48kHz). */
const BUFFER_SECONDS = 3;
/** Inference window length in seconds at native rate. */
const WINDOW_SECONDS = 2;
/** How often we run inference (ms). */
const POLL_MS = 400;
/** Only onsets newer than this (relative to window start) are emitted. */
const FRESH_SECONDS = 0.6;
/** Same pitch within this window (absolute seconds) is deduplicated. */
const DEDUP_SECONDS = 0.4;

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
  private readonly onNote: (onset: NoteOnset) => void;

  constructor(onNote: (onset: NoteOnset) => void) {
    this.onNote = onNote;
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
    const startInLead = Math.max(0, lead.length - excess);
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
      const rate = this.audioCtx!.sampleRate;
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
        outputToNotesPoly(frames, onsets, 0.5, 0.3, 2),
      );

      const nowAbs = performance.now() / 1000 - this.startedAt;
      const windowStartAbs = nowAbs - WINDOW_SECONDS;
      for (const note of notes) {
        if (note.startTimeSeconds < WINDOW_SECONDS - FRESH_SECONDS) continue;
        const abs = windowStartAbs + note.startTimeSeconds;
        const last = this.lastEmitted.get(note.pitchMidi) ?? -Infinity;
        if (abs - last < DEDUP_SECONDS) continue;
        this.lastEmitted.set(note.pitchMidi, abs);
        this.onNote({ midi: note.pitchMidi, time: abs, amplitude: note.amplitude });
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
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.audioCtx?.close();
    this.audioCtx = null;
    if (this.workletUrl) URL.revokeObjectURL(this.workletUrl);
    this.workletUrl = null;
  }
}
