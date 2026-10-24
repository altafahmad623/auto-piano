import { useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import { midiToName } from '../parser';
import { createPianoSampler } from '../player';
import { KeyboardInput } from '../keyboardInput';
import { Keyboard, type KeyFlash } from './Keyboard';

interface Props {
  onBack: () => void;
}

/** Jam on the computer keyboard (a=C4, interleaved mapping) with piano sounds. */
export function FreePlayView({ onBack }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [flash, setFlash] = useState<KeyFlash | null>(null);
  const [lastNote, setLastNote] = useState('—');
  const flashTimer = useRef<number | null>(null);
  const inputRef = useRef<KeyboardInput | null>(null);

  useEffect(() => {
    void Tone.start().then(async () => {
      const sampler = createPianoSampler();
      await Tone.loaded();
      const input = new KeyboardInput(
        (midi) => {
          sampler.triggerAttackRelease(Tone.Frequency(midi, 'midi').toFrequency(), 1.2);
          setLastNote(midiToName(midi));
          setFlash({ midi, kind: 'hit' });
          if (flashTimer.current !== null) clearTimeout(flashTimer.current);
          flashTimer.current = window.setTimeout(() => setFlash(null), 150);
        },
      );
      input.start();
      inputRef.current = input;
      setLoaded(true);
    });
    return () => {
      inputRef.current?.stop();
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    };
  }, []);

  return (
    <div className="view">
      <header className="view-header">
        <button className="secondary" onClick={onBack}>← Library</button>
        <h2>Free play</h2>
      </header>
      <div className="big-note">{lastNote}</div>
      <p className="hint">a = C4 · w e t y u o p · interleaved mapping</p>
      {!loaded && <p className="hint">Loading piano samples…</p>}
      <div className="keyboard-wrap">
        <Keyboard
          lo={60}
          hi={76}
          events={[]}
          mode="wait"
          currentIdx={0}
          keyFlash={flash}
          showKeyLetters
        />
      </div>
    </div>
  );
}
