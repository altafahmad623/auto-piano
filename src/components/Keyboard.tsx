import { useMemo } from 'react';
import { midiToName } from '../parser';
import type { NoteEvent } from '../types';

const WHITE_PC = new Set([0, 2, 4, 5, 7, 9, 11]);
const KEY_W = 42;
const KEY_H = 150;
const BLACK_W = 26;
const BLACK_H = 95;
/** Vertical px above the keyboard used for falling notes. */
const FALL_ZONE = 300;
/** How many steps (eighth notes) a note spends crossing the fall zone. */
const FALL_STEPS = 10;

interface KeyGeometry {
  midi: number;
  black: boolean;
  x: number;
  w: number;
  h: number;
}

function isBlack(midi: number): boolean {
  return !WHITE_PC.has(midi % 12);
}

/** Build keyboard geometry for a MIDI range, expanded to C..B octave bounds. */
function buildKeys(lo: number, hi: number): KeyGeometry[] {
  // Expand to octave boundaries (C..B).
  let start = 12 * (Math.floor(lo / 12) + 1);
  let end = 12 * (Math.floor(hi / 12) + 1) - 1;
  while (end - start < 23) {
    start -= 12;
    end += 12;
  }

  const keys: KeyGeometry[] = [];
  let whiteIndex = 0;
  for (let midi = start; midi <= end; midi++) {
    if (!isBlack(midi)) {
      keys.push({ midi, black: false, x: whiteIndex * KEY_W, w: KEY_W, h: KEY_H });
      whiteIndex += 1;
    }
  }
  // Black keys sit between their neighboring whites.
  let lastWhiteX = 0;
  whiteIndex = 0;
  for (let midi = start; midi <= end; midi++) {
    if (!isBlack(midi)) {
      lastWhiteX = whiteIndex * KEY_W;
      whiteIndex += 1;
    } else {
      keys.push({
        midi,
        black: true,
        x: lastWhiteX + KEY_W - BLACK_W / 2,
        w: BLACK_W,
        h: BLACK_H,
      });
    }
  }
  return keys;
}

export interface KeyFlash {
  midi: number;
  kind: 'hit' | 'miss';
}

interface Props {
  lo: number;
  hi: number;
  events: NoteEvent[];
  /** 'wait': practice mode (currentIdx drives blocks). 'fall': listen mode (cursorStep drives). */
  mode: 'wait' | 'fall';
  currentIdx?: number;
  cursorStep?: number;
  keyFlash?: KeyFlash | null;
  /** Persistent highlight on a key (calibration: the key to play next). */
  highlightMidi?: number | null;
}

/** MIDI range covering all events (min/max). */
export function eventRange(events: NoteEvent[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const ev of events) {
    for (const m of ev.midis) {
      if (m < lo) lo = m;
      if (m > hi) hi = m;
    }
  }
  if (lo === Infinity) return [60, 72];
  return [lo, hi];
}

/** SVG piano keyboard with Synthesia-style note blocks. */
export function Keyboard({
  lo,
  hi,
  events,
  mode,
  currentIdx,
  cursorStep,
  keyFlash,
  highlightMidi,
}: Props) {
  const keys = useMemo(() => buildKeys(lo, hi), [lo, hi]);
  const keyByMidi = useMemo(() => new Map(keys.map((k) => [k.midi, k])), [keys]);
  const width = keys.filter((k) => !k.black).length * KEY_W;

  const stepPx = FALL_ZONE / FALL_STEPS;

  return (
    <svg
      className="keyboard"
      viewBox={`0 0 ${width} ${KEY_H + FALL_ZONE}`}
      preserveAspectRatio="xMidYMax meet"
    >
      {/* Fall zone */}
      <rect x={0} y={0} width={width} height={FALL_ZONE} className="fall-zone" />

      {/* Note blocks */}
      {events.map((ev, i) => {
        const visible =
          mode === 'fall'
            ? (() => {
                const cursor = cursorStep ?? 0;
                const y = FALL_ZONE - (ev.startStep - cursor) * stepPx;
                return y > -60 && y < FALL_ZONE + 10;
              })()
            : i >= (currentIdx ?? 0) && i < (currentIdx ?? 0) + 5;
        if (!visible) return null;

        return ev.midis.map((midi, m) => {
          const key = keyByMidi.get(midi);
          if (!key) return null;

          let y: number;
          let opacity = 1;
          let isCurrent = false;
          if (mode === 'fall') {
            const cursor = cursorStep ?? 0;
            y = FALL_ZONE - (ev.startStep - cursor) * stepPx;
          } else {
            const offset = i - (currentIdx ?? 0);
            y = FALL_ZONE - offset * 52;
            opacity = offset === 0 ? 1 : Math.max(0.25, 0.8 - offset * 0.2);
            isCurrent = offset === 0;
          }

          const h = Math.max(
            18,
            Math.min(ev.steps, 4) * (mode === 'fall' ? stepPx : 40),
          );
          const finger = ev.fingers?.[m];

          return (
            <g key={`${ev.startStep}-${midi}-${m}`} opacity={opacity}>
              <rect
                x={key.x + (key.black ? 0 : 1)}
                y={y - h}
                width={key.w - (key.black ? 0 : 2)}
                height={h}
                rx={4}
                className={`note-block hand-${ev.hand} ${isCurrent ? 'current' : ''}`}
              />
              {finger !== undefined && (
                <text
                  x={key.x + key.w / 2}
                  y={y - h / 2 + 4}
                  textAnchor="middle"
                  className="finger-label"
                >
                  {finger}
                </text>
              )}
            </g>
          );
        });
      })}

      {/* Keys */}
      {keys.map((k) => {
        const flash =
          keyFlash && keyFlash.midi === k.midi
            ? keyFlash.kind
            : null;
        const highlight = highlightMidi === k.midi ? 'key-highlight' : '';
        return (
          <g key={k.midi}>
            <rect
              x={k.x}
              y={FALL_ZONE}
              width={k.w}
              height={k.h}
              rx={3}
              className={`key ${k.black ? 'black' : 'white'} ${highlight} ${
                flash === 'hit' ? 'flash-hit' : flash === 'miss' ? 'flash-miss' : ''
              }`}
            />
            {!k.black && (
              <text
                x={k.x + k.w / 2}
                y={FALL_ZONE + k.h - 8}
                textAnchor="middle"
                className="key-label"
              >
                {midiToName(k.midi)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
