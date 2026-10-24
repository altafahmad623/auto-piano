export type Hand = 'R' | 'L';

export interface NoteEvent {
  hand: Hand;
  /** MIDI note numbers; chord = multiple. */
  midis: number[];
  /** Optional finger numbers (1–5, thumb=1) aligned with midis; entries may be undefined. */
  fingers?: (number | undefined)[];
  /** Step index in the global timeline (1 step = 1 token letter at any octave). */
  startStep: number;
  /** Duration in steps (extended by '-' holds). */
  steps: number;
}

export interface Song {
  title: string;
  key: string;
  beatsPerMeasure: number;
  beatUnit: number;
  tempo: number;
  events: NoteEvent[];
  totalSteps: number;
  /** Step index at the start of each measure (display only). */
  measures: { startStep: number }[];
}
