import { midiToName } from '../parser';
import type { NoteEvent } from '../types';

interface Props {
  events: NoteEvent[];
  currentIndex: number;
  /** Extra CSS class for the strip container. */
  className?: string;
}

/** Horizontal scrolling note strip; current note highlighted. */
export function NoteStrip({ events, currentIndex, className }: Props) {
  return (
    <div className={`note-strip ${className ?? ''}`}>
      {events.map((ev, i) => {
        const label = ev.midis.map(midiToName).join('+');
        const state = i < currentIndex ? 'past' : i === currentIndex ? 'current' : 'future';
        return (
          <span key={`${ev.startStep}-${ev.hand}-${i}`} className={`note-chip ${state} hand-${ev.hand}`}>
            {label}
          </span>
        );
      })}
    </div>
  );
}
