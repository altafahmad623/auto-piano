/**
 * Interleaved computer-keyboard-to-piano mapping, middle C4 on 'a':
 * a w s e d f t g y h u j k o l p ;  →  C4 C#4 D4 D#4 E4 F4 F#4 G4 G#4 A4 A#4 B4 C5 ...
 */
export const KEY_ORDER = 'awsedftgyhujkolp;';
const C4 = 60;

export function keyToMidi(key: string): number | null {
  const idx = KEY_ORDER.indexOf(key);
  return idx === -1 ? null : C4 + idx;
}

/** Tracks keydown/keyup on window; ignores auto-repeat. */
export class KeyboardInput {
  private readonly down = new Set<string>();
  private readonly onKeyDown: (midi: number, key: string) => void;
  private readonly onKeyUp?: (midi: number, key: string) => void;

  constructor(
    onKeyDown: (midi: number, key: string) => void,
    onKeyUp?: (midi: number, key: string) => void,
  ) {
    this.onKeyDown = onKeyDown;
    this.onKeyUp = onKeyUp;
  }

  private handleDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const midi = keyToMidi(e.key);
    if (midi === null || this.down.has(e.key)) return;
    this.down.add(e.key);
    e.preventDefault();
    this.onKeyDown(midi, e.key);
  };

  private handleUp = (e: KeyboardEvent) => {
    const midi = keyToMidi(e.key);
    if (midi === null) return;
    this.down.delete(e.key);
    this.onKeyUp?.(midi, e.key);
  };

  start(): void {
    window.addEventListener('keydown', this.handleDown);
    window.addEventListener('keyup', this.handleUp);
  }

  stop(): void {
    window.removeEventListener('keydown', this.handleDown);
    window.removeEventListener('keyup', this.handleUp);
    this.down.clear();
  }
}
