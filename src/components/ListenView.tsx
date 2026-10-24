import { useEffect, useRef, useState } from 'react';
import { midiToName } from '../parser';
import { startListenSession, stepDuration } from '../player';
import type { ListenSession } from '../player';
import type { Song } from '../types';
import { NoteStrip } from './NoteStrip';

interface Props {
  song: Song;
  onBack: () => void;
}

export function ListenView({ song, onBack }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'ended'>('idle');
  const [highlight, setHighlight] = useState(-1);
  const [cursorStep, setCursorStep] = useState(0);
  const sessionRef = useRef<ListenSession | null>(null);

  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (status !== 'playing') return;
    const stepDur = stepDuration(song);
    const id = window.setInterval(() => {
      const step = sessionRef.current?.currentStep() ?? 0;
      setCursorStep(step);
      let idx = -1;
      song.events.forEach((ev, i) => {
        if (ev.startStep <= step + 0.001) idx = i;
      });
      setHighlight(idx);
    }, Math.max(60, stepDur * 200));
    return () => clearInterval(id);
  }, [status, song]);

  function stop() {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setStatus('idle');
    setHighlight(-1);
    setCursorStep(0);
  }

  async function play() {
    setStatus('loading');
    try {
      sessionRef.current?.stop();
      sessionRef.current = await startListenSession(song, {
        onEnded: () => setStatus('ended'),
      });
      setStatus('playing');
    } catch (err) {
      console.error(err);
      setStatus('idle');
      alert('Failed to load piano samples. Check network connection.');
    }
  }

  const currentNames =
    highlight >= 0 && song.events[highlight]
      ? song.events[highlight].midis.map(midiToName).join(' + ')
      : '—';

  return (
    <div className="view">
      <header className="view-header">
        <button
          className="secondary"
          onClick={() => {
            stop();
            onBack();
          }}
        >
          ← Library
        </button>
        <h2>{song.title} — Listen</h2>
        {status === 'playing' ? (
          <button className="secondary" onClick={stop}>Stop</button>
        ) : (
          <button onClick={play} disabled={status === 'loading'}>
            {status === 'loading' ? 'Loading…' : status === 'ended' ? 'Replay' : 'Play'}
          </button>
        )}
      </header>
      <div className="big-note">{currentNames}</div>
      <NoteStrip events={song.events} currentIndex={highlight} />
      <p className="hint">
        step {cursorStep.toFixed(1)} / {song.totalSteps} · {song.key} · {song.tempo} BPM
      </p>
    </div>
  );
}
