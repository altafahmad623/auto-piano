import { useEffect, useRef, useState } from 'react';
import { startListenSession } from '../player';
import type { ListenSession } from '../player';
import type { Song } from '../types';
import { eventRange, Keyboard } from './Keyboard';
import { ErrorBanner } from './ErrorBanner';

interface Props {
  song: Song;
  onBack: () => void;
}

export function ListenView({ song, onBack }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'ended'>('idle');
  const [cursorStep, setCursorStep] = useState(0);
  const [error, setError] = useState<string>('');
  const sessionRef = useRef<ListenSession | null>(null);

  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (status !== 'playing') return;
    let raf = 0;
    const tick = () => {
      setCursorStep(sessionRef.current?.currentStep() ?? 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  function stop() {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setStatus('idle');
    setCursorStep(0);
    setError('');
  }

  async function play() {
    setStatus('loading');
    setError('');
    try {
      sessionRef.current?.stop();
      sessionRef.current = await startListenSession(song, {
        onEnded: () => setStatus('ended'),
      });
      setStatus('playing');
    } catch (err) {
      console.error(err);
      setStatus('idle');
      setError('Failed to load piano samples. Check network connection.');
    }
  }

  const [lo, hi] = eventRange(song.events);

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
      {error && <ErrorBanner message={error} />}
      <div className="keyboard-wrap">
        <Keyboard
          lo={lo}
          hi={hi}
          events={song.events}
          mode="fall"
          cursorStep={cursorStep}
        />
      </div>
      <p className="hint">
        {song.key} · {song.tempo} BPM · step {cursorStep.toFixed(1)} / {song.totalSteps}
      </p>
    </div>
  );
}
