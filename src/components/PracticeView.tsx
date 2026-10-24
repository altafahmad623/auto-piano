import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteProfile, listProfiles, type DeviceProfile } from '../calibration';
import { LiveDetector, type NoteOnset } from '../detector';
import { midiToName } from '../parser';
import { PracticeMatcher } from '../matcher';
import type { Hand, Song } from '../types';
import { eventRange, Keyboard, type KeyFlash } from './Keyboard';

interface Props {
  song: Song;
  onBack: () => void;
  onCalibrate: () => void;
}

export function PracticeView({ song, onBack, onCalibrate }: Props) {
  const [hand, setHand] = useState<Hand>('R');
  const [profiles, setProfiles] = useState<DeviceProfile[]>(() => listProfiles());
  const [profileName, setProfileName] = useState<string>(''); // '' = no profile
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [matcher, setMatcher] = useState<PracticeMatcher | null>(null);
  const [idx, setIdx] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [lastHeard, setLastHeard] = useState<string>('—');
  const [feedback, setFeedback] = useState<string>('');
  const [keyFlash, setKeyFlash] = useState<KeyFlash | null>(null);
  const flashTimer = useRef<number | null>(null);
  const detectorRef = useRef<LiveDetector | null>(null);

  const profile = profiles.find((p) => p.name === profileName);

  const playable = useMemo(
    () =>
      song.events
        .filter((e) => e.hand === hand && e.midis.length > 0)
        .sort((a, b) => a.startStep - b.startStep),
    [song, hand],
  );
  const [lo, hi] = eventRange(playable);

  useEffect(() => {
    return () => {
      detectorRef.current?.stop();
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    };
  }, []);

  function flash(midi: number, kind: 'hit' | 'miss') {
    setKeyFlash({ midi, kind });
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setKeyFlash(null), 180);
  }

  function stop() {
    detectorRef.current?.stop();
    detectorRef.current = null;
    setRunning(false);
    setStarting(false);
  }

  async function start() {
    setStarting(true);
    const m = new PracticeMatcher(song, hand, profile);
    setMatcher(m);
    setIdx(0);
    setMistakes(0);
    setLastHeard('—');
    setFeedback('');

    const detector = new LiveDetector((onset: NoteOnset) => {
      setLastHeard(midiToName(onset.midi));
      const result = m.feed(onset.midi, onset.time);
      if (result === 'hit' || result === 'chord-progress') {
        flash(onset.midi, 'hit');
      }
      if (result === 'hit') {
        setIdx(Math.round(m.progress * m.total));
        setFeedback('');
        if (m.done) {
          detectorRef.current?.stop();
          detectorRef.current = null;
          setRunning(false);
        }
      } else if (result === 'miss') {
        flash(onset.midi, 'miss');
        setMistakes(m.mistakeCount);
        setFeedback(`Expected ${m.current?.midis.map(midiToName).join(' + ')}`);
      }
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

  function skip() {
    matcher?.skip();
    setIdx(Math.round((matcher?.progress ?? 0) * (matcher?.total ?? 0)));
    setFeedback('');
  }

  const current = matcher?.current;
  const done = matcher?.done ?? false;

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
        <h2>{song.title} — Practice</h2>
        <span className="hint">
          {hand === 'R' ? 'Right hand' : 'Left hand'}
          {profile ? ` · ${profile.name}` : ''}
        </span>
      </header>

      {!running && !starting && !done && (
        <div className="setup-panel">
          <label>
            Hand{' '}
            <select value={hand} onChange={(e) => setHand(e.target.value as Hand)}>
              <option value="R">Right (R)</option>
              <option value="L">Left (L)</option>
            </select>
          </label>
          <label>
            Device profile{' '}
            <select value={profileName} onChange={(e) => setProfileName(e.target.value)}>
              <option value="">None</option>
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button onClick={onCalibrate}>Calibrate new device…</button>
          {profile && (
            <button
              className="secondary"
              onClick={() => {
                deleteProfile(profile.name);
                setProfiles(listProfiles());
                setProfileName('');
              }}
            >
              Delete “{profile.name}”
            </button>
          )}
          <button className="primary" onClick={start}>
            Start practice
          </button>
        </div>
      )}

      {starting && <p className="hint">Loading model and requesting microphone…</p>}

      {(running || done) && (
        <>
          <div className="big-note">
            {current ? current.midis.map(midiToName).join(' + ') : 'Done!'}
          </div>
          <div className="heard">Heard: {lastHeard}</div>
          {feedback && <div className="feedback">{feedback}</div>}
          <div className="keyboard-wrap">
            <Keyboard
              lo={lo}
              hi={hi}
              events={playable}
              mode="wait"
              currentIdx={done ? playable.length : idx}
              keyFlash={keyFlash}
            />
          </div>
          <div className="stats-row">
            <span>
              {done ? playable.length : idx} / {playable.length}
            </span>
            <span>Mistakes: {mistakes}</span>
          </div>
          {running && (
            <div className="actions-row">
              <button className="secondary" onClick={skip}>
                Skip
              </button>
              <button className="secondary" onClick={stop}>
                Stop
              </button>
            </div>
          )}
          {done && (
            <div className="actions-row">
              <button onClick={start}>Practice again</button>
              <button className="secondary" onClick={onBack}>
                ← Library
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
