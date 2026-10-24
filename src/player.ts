import * as Tone from 'tone';
import type { Hand, NoteEvent, Song } from './types';

/** One step (token letter) = one eighth note at the song's tempo. */
export function stepDuration(song: Song): number {
  return (60 / song.tempo) / 2;
}

const SALAMANDER_BASE = 'https://tonejs.github.io/audio/salamander/';
const SALAMANDER_NOTES = [
  'A0', 'C1', 'D#1', 'F#1', 'A1', 'C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3',
  'A3', 'C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6',
  'A6', 'C7', 'D#7', 'F#7', 'A7', 'C8',
];

export interface ListenSession {
  stop(): void;
  /** Current cursor position in steps; -1 before first note. */
  currentStep(): number;
  onEnded: () => void;
}

/**
 * Plays a song (both hands) with sampled piano. Progress cursor is polled by
 * the UI from currentStep().
 */
export async function startListenSession(
  song: Song,
  options: { hands?: Hand[]; onEnded: () => void },
): Promise<ListenSession> {
  await Tone.start(); // must run inside the click gesture
  const hands = options.hands ?? ['R', 'L'];
  const stepDur = stepDuration(song);

  const sampler = new Tone.Sampler({
    // The Salamander CDN names sharp files with 's', e.g. "Ds1.mp3".
    urls: Object.fromEntries(SALAMANDER_NOTES.map((n) => [n, `${n.replace('#', 's')}.mp3`])),
    baseUrl: SALAMANDER_BASE,
    release: '2s',
  }).toDestination();

  return new Promise((resolve, reject) => {
    const partEvents = song.events
      .filter((ev) => hands.includes(ev.hand))
      .map((ev) => ({ ...ev, time: ev.startStep * stepDur }));

    const part = new Tone.Part(
      (time, ev: NoteEvent & { time: number }) => {
        for (const midi of ev.midis) {
          sampler.triggerAttackRelease(
            Tone.Frequency(midi, 'midi').toFrequency(),
            ev.steps * stepDur * 0.95,
            time,
          );
        }
      },
      partEvents,
    );
    part.start(0);

    Tone.Transport.scheduleOnce((time) => {
      void time;
      Tone.Transport.stop();
      Tone.Transport.cancel();
      sampler.dispose();
      part.dispose();
      options.onEnded();
    }, Math.max(song.totalSteps * stepDur, 0.1) + 0.5);

    Tone.loaded().then(
      () => {
        Tone.Transport.start('+0.1');
        resolve({
          stop: () => {
            Tone.Transport.stop();
            Tone.Transport.cancel();
            sampler.dispose();
            part.dispose();
          },
          currentStep: () => Tone.Transport.seconds / stepDur,
          onEnded: options.onEnded,
        });
      },
      (err: unknown) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
