import { useEffect, useRef, useState } from 'react';
import { calibrationRange, type DeviceProfile } from '../calibration';
import { Keyboard } from './Keyboard';
import type { NoteEvent } from '../types';
import { LiveDetector, type NoteOnset } from '../detector';
import { midiToName } from '../parser';

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

    const detector = new LiveDetector((onset: NoteOnset) => {
      setLastHeard(midiToName(onset.midi));
      setKeyIdx((i) => {
        if (i >= keys.length) return i;
        const expected = keys[i];
        setOffsets((prev) => ({ ...prev, [expected]: onset.midi }));
        return i + 1;
      });
    });
    detectorRef.current = detector;

    try {
      await detector.start();
      setRunning(true);
    } catch (err) {
      console.error(err);
      alert('Microphone access failed. Grant mic permission and try again.');
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
            Range{' '}
            <select value={startOctave} onChange={(e) => setStartOctave(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((o) => (
                <option key={o} value={o}>C{o} –</option>
              ))}
            </select>
            <select value={octaves} onChange={(e) => setOctaves(Number(e.target.value))}>
              {[1, 2, 3].map((o) => (
                <option key={o} value={o}>{o} octave{o > 1 ? 's' : ''}</option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={start}>
            Start calibration
          </button>
          <p className="hint">
            Play the shown keys one by one, in order. Each detected note is stored
            for this device.
          </p>
        </div>
      )}

      {starting && <p className="hint">Loading model and requesting microphone…</p>}

      {running && (
        <>
          <div className="big-note">{expectedName ?? 'Done!'}</div>
          <div className="heard">Heard: {lastHeard}</div>
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
