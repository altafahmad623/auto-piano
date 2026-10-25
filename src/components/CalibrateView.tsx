import { useEffect, useRef, useState } from 'react';
import { calibrationRange, type DeviceProfile } from '../calibration';
import { Keyboard } from './Keyboard';
import { ErrorBanner } from './ErrorBanner';
import type { NoteEvent } from '../types';
import { LiveDetector, type NoteOnset } from '../detector';
import { midiToName } from '../parser';
import { InfoTip } from './InfoTip';

/** Map RMS to a 0-100 bar percentage on a -60..-20 dB scale. */
function meterPct(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(100, ((db + 60) / 40) * 100));
}

interface Props {
  onDone: (profile: DeviceProfile | null) => void;
}

/**
 * Guided calibration: user plays keys one by one in ascending order; for each
 * expected key we store the MIDI the detector actually heard.
 */
export function CalibrateView({ onDone }: Props) {
  const [name, setName] = useState('');
  const [startOctave, setStartOctave] = useState(4);
  const [octaves, setOctaves] = useState(1);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [keyIdx, setKeyIdx] = useState(0);
  const [offsets, setOffsets] = useState<Record<number, number>>({});
  const [lastHeard, setLastHeard] = useState<string>('—');
  const [level, setLevel] = useState(0);
  const [guess, setGuess] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const detectorRef = useRef<LiveDetector | null>(null);

  const range = useRef<number[]>([]);

  useEffect(() => {
    return () => detectorRef.current?.stop();
  }, []);

  function stopDetector() {
    detectorRef.current?.stop();
    detectorRef.current = null;
  }

  async function start() {
    range.current = calibrationRange(startOctave, octaves);
    const keys = range.current;
    setKeyIdx(0);
    setOffsets({});
    setSkipped(new Set());
    setStarting(true);
    setError('');

    const detector = new LiveDetector({
      onNote: (onset: NoteOnset) => {
        setLastHeard(midiToName(onset.midi));
        // Only a guess-confirmed onset advances: hallucinated low notes on
        // near-silence have real-note amplitudes and would auto-fill keys.
        if (!onset.confirmed) return;
        setKeyIdx((i) => {
          if (i >= keys.length) return i;
          const expected = keys[i];
          setOffsets((prev) => ({ ...prev, [expected]: onset.midi }));
          return i + 1;
        });
      },
      onLevel: setLevel,
      onGuess: (midi) => setGuess(midi === null ? null : midiToName(midi)),
    });
    detectorRef.current = detector;

    try {
      await detector.start();
      setRunning(true);
    } catch (err) {
      console.error(err);
      setError('Microphone access failed. Grant mic permission and try again.');
      detectorRef.current = null;
    }
    setStarting(false);
  }

  function finish(save: boolean) {
    stopDetector();
    if (save && name.trim()) {
      onDone({
        name: name.trim(),
        createdAt: Date.now(),
        offsets,
      });
    } else {
      onDone(null);
    }
  }

  function skipKey() {
    setKeyIdx((i) => {
      if (i < range.current.length) setSkipped((s) => new Set(s).add(range.current[i]));
      return i + 1;
    });
  }

  const keys = range.current;
  const expectedName = keyIdx < keys.length ? midiToName(keys[keyIdx]) : null;
  const collected = Object.keys(offsets).length + skipped.size;

  const lo = keys.length > 0 ? keys[0] : 60;
  const hi = keys.length > 0 ? keys[keys.length - 1] : 72;
  const remaining: NoteEvent[] = keys.slice(keyIdx).map((midi, i) => ({
    hand: 'R',
    midis: [midi],
    startStep: i,
    steps: 1,
  }));

  return (
    <div className="view">
      <header className="view-header">
        <button className="secondary" onClick={() => finish(false)}>Cancel</button>
        <h2>Calibrate device</h2>
      </header>

      {!running && !starting && (
        <div className="setup-panel">
          <label>
            Device name{' '}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Upright in living room"
            />
          </label>
          <label>
            Range <InfoTip tip="Which keys you'll play during calibration. Only the part of the piano you practice needs calibrating — keys outside this range still work, they're just matched by pitch as heard." />
            <select value={startOctave} onChange={(e) => setStartOctave(Number(e.target.value))}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((o) => (
                <option key={o} value={o}>C{o} –</option>
              ))}
            </select>
            <select value={octaves} onChange={(e) => setOctaves(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7].map((o) => (
                <option key={o} value={o}>{o} octave{o > 1 ? 's' : ''}</option>
              ))}
            </select>
          </label>
          <p className="hint">
            Play the shown keys one by one, in order. Each key you play is recorded
            so practice still counts even if your piano reads as a different pitch.
            Skip any key you can't play.
          </p>
          <button className="primary" onClick={start}>
            Start calibration
          </button>
        </div>
      )}

      {starting && <p className="hint">Loading model and requesting microphone…</p>}
      {error && <ErrorBanner message={error} />}

      {running && (
        <>
          <div className="big-note">{expectedName ?? 'Done!'}</div>
          <div className="meter" aria-label="Microphone input level">
            <div
              className="meter-fill"
              style={{ width: `${meterPct(level)}%` }}
            />
          </div>
          <div className="heard">
            Guess: {guess ?? '—'} · Heard: {lastHeard}
          </div>
          <div className="keyboard-wrap">
            <Keyboard
              lo={lo}
              hi={hi}
              events={remaining}
              mode="wait"
              currentIdx={0}
              highlightMidi={expectedName ? keys[keyIdx] : null}
            />
          </div>
          <p className="hint">
            {collected} / {keys.length} keys recorded
            {skipped.size > 0 ? ` · ${skipped.size} skipped` : ''}
          </p>
          <div className="actions-row">
            {expectedName && (
              <button className="secondary" onClick={skipKey}>
                Skip this key
              </button>
            )}
            <button onClick={() => finish(true)} disabled={!name.trim()}>
              Save profile
            </button>
            <button className="secondary" onClick={() => finish(false)}>
              Discard
            </button>
          </div>
        </>
      )}
    </div>
  );
}
