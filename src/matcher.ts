import type { DeviceProfile } from './calibration';
import type { Hand, NoteEvent, Song } from './types';

/**
 * Order-based practice matching: the user's detected note onsets advance
 * through the expected events of the chosen hand. Timing is ignored.
 * Chords require all members (with optional per-key profile correction).
 */
export class PracticeMatcher {
  private readonly events: NoteEvent[];
  private idx = 0;
  private mistakes = 0;
  private readonly covered = new Set<number>();
  private readonly lastMissAt = new Map<number, number>();

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
   * Returns what happened so the UI can react.
   */
  feed(midi: number, now: number): 'hit' | 'chord-progress' | 'miss' | 'ignored' {
    const ev = this.current;
    if (!ev) return 'ignored';

    if (ev.midis.some((req) => this.accepts(req, midi))) {
      this.covered.add(midi);
      const satisfied = ev.midis.every((req) => this.isCovered(req));
      if (satisfied) {
        this.idx += 1;
        this.covered.clear();
        return 'hit';
      }
      return 'chord-progress';
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
  }
}
