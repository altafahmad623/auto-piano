import type { DeviceProfile } from './calibration';
import type { Hand, NoteEvent, Song } from './types';

/**
 * After a hit, the same pitch must produce a new onset at least this many
 * seconds later before it can satisfy the next event. Tunable against
 * real-piano data (must stay well under the fastest legit repeated note).
 */
export const REARM_SECONDS = 0.5;

/**
 * Order-based practice matching: the user's detected note onsets advance
 * through the expected events of the chosen hand. Timing is ignored.
 * Chords require all members (with optional per-key profile correction)
 * plus at least one confirmed ("anchor") onset — the detector's mono guess
 * only sees the dominant note of a chord, so the other members arrive
 * unconfirmed. Single notes must themselves be confirmed.
 */
export class PracticeMatcher {
  private readonly events: NoteEvent[];
  private idx = 0;
  private mistakes = 0;
  private readonly covered = new Set<number>();
  /** True once a confirmed onset has been accepted for the current event. */
  private anchored = false;
  private readonly lastMissAt = new Map<number, number>();
  /** Pitch → time it last satisfied (hit) an event. */
  private readonly lastHitAt = new Map<number, number>();

  private readonly profile?: DeviceProfile;

  constructor(song: Song, hand: Hand, profile?: DeviceProfile) {
    this.profile = profile;
    this.events = song.events
      .filter((e) => e.hand === hand && e.midis.length > 0)
      .sort((a, b) => a.startStep - b.startStep);
  }

  get total(): number {
    return this.events.length;
  }

  get done(): boolean {
    return this.idx >= this.events.length;
  }

  get current(): NoteEvent | undefined {
    return this.events[this.idx];
  }

  get progress(): number {
    return this.total === 0 ? 1 : this.idx / this.total;
  }

  get mistakeCount(): number {
    return this.mistakes;
  }

  /** Would this MIDI pitch be accepted as the given expected note? */
  private accepts(expected: number, midi: number): boolean {
    if (midi === expected) return true;
    const detected = this.profile?.offsets[expected];
    return detected !== undefined && midi === detected;
  }

  /**
   * Feed one detected note onset (absolute time in seconds).
   * `confirmed` is the detector's guess-agreement flag; computer-keyboard
   * input passes true. Returns what happened so the UI can react.
   */
  feed(midi: number, now: number, confirmed: boolean): 'hit' | 'chord-progress' | 'miss' | 'ignored' {
    const ev = this.current;
    if (!ev) return 'ignored';

    // Re-arm: a pitch that just satisfied an event cannot satisfy the next
    // one until REARM_SECONDS pass, so a decaying or re-detected note does
    // not carry a repeated-pitch passage forward.
    const lastHit = this.lastHitAt.get(midi) ?? -Infinity;
    if (now - lastHit < REARM_SECONDS) return 'ignored';

    if (ev.midis.some((req) => this.accepts(req, midi))) {
      this.covered.add(midi);
      if (confirmed) this.anchored = true;
      const satisfied = ev.midis.every((req) => this.isCovered(req));
      if (satisfied && this.anchored) {
        for (const p of this.covered) this.lastHitAt.set(p, now);
        this.idx += 1;
        this.covered.clear();
        this.anchored = false;
        return 'hit';
      }
      // A single-note event waiting for its confirmed onset: an unconfirmed
      // (possibly hallucinated) match must not flash or advance anything.
      if (ev.midis.length > 1) return 'chord-progress';
      return 'ignored';
    }

    // Wrong note. Debounce repeats of the same pitch so one held/ghost
    // detection does not rack up multiple misses.
    const last = this.lastMissAt.get(midi) ?? -Infinity;
    if (now - last > 0.35) {
      this.mistakes += 1;
      this.lastMissAt.set(midi, now);
      return 'miss';
    }
    return 'ignored';
  }

  /** Is the expected note covered by some accepted detected pitch in `covered`? */
  private isCovered(expected: number): boolean {
    if (this.covered.has(expected)) return true;
    const detected = this.profile?.offsets[expected];
    return detected !== undefined && this.covered.has(detected);
  }

  /** Manually move past the current event (Skip button). */
  skip(): void {
    this.idx += 1;
    this.covered.clear();
    this.anchored = false;
  }
}
