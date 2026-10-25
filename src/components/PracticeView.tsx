import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Tone from 'tone';
import { type DeviceProfile } from '../calibration';
import { KeyboardInput } from '../keyboardInput';
import { LiveDetector, type NoteOnset } from '../detector';
import { midiToName } from '../parser';
import { PracticeMatcher } from '../matcher';
import { profileStore } from '../profileStore';
import { createPianoSampler } from '../player';
import type { Hand, Song } from '../types';
import { eventRange, Keyboard, type KeyFlash } from './Keyboard';
import { ErrorBanner } from './ErrorBanner';
import { InfoTip } from './InfoTip';

interface Props {
  song: Song;
}

export function PracticeView({ song }: Props) {
  const navigate = useNavigate();
  const [hand, setHand] = useState<Hand>('R');
  const [inputSource, setInputSource] = useState<'mic' | 'keyboard'>('mic');
  const [profiles, setProfiles] = useState<DeviceProfile[]>([]);
  const [profileName, setProfileName] = useState<string>(''); // '' = no profile
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [matcher, setMatcher] = useState<PracticeMatcher | null>(null);
  const [idx, setIdx] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [lastHeard, setLastHeard] = useState<string>('—');
  const [feedback, setFeedback] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [keyFlash, setKeyFlash] = useState<KeyFlash | null>(null);
  const flashTimer = useRef<number | null>(null);
  const detectorRef = useRef<LiveDetector | null>(null);
  const samplerRef = useRef<Tone.Sampler | null>(null);

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

  // Profiles come from the async store (repo-local files via the dev-server
  // middleware, so they survive origin/port changes). Corrupt entries are
  // reported, not hidden.
  useEffect(() => {
    let cancelled = false;
    profileStore
      .list()
      .then(({ profiles: stored, errors }) => {
        if (cancelled) return;
        setProfiles(stored);
        if (errors.length > 0) setError(errors.join(' · '));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(`Loading profiles failed: ${err.message}`);
      });
    return () => {
      cancelled = true;
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

  function feedMatch(m: PracticeMatcher, midi: number, now: number, confirmed: boolean) {
    const result = m.feed(midi, now, confirmed);
    // Only show pitches that were part of the verdict: noise/hallucination
    // onsets (ignored) must not touch the "Heard" display.
    if (result !== 'ignored') setLastHeard(midiToName(midi));
    if (result === 'hit' || result === 'chord-progress') {
      flash(midi, 'hit');
      // Audible confirmation only for computer-keyboard input — with the
      // mic, the sampler's own sound would feed back into the detector.
      if (inputSource === 'keyboard') {
        samplerRef.current?.triggerAttackRelease(
          Tone.Frequency(midi, 'midi').toFrequency(),
          0.8,
        );
      }
    }
    if (result === 'hit') {
      setIdx(Math.round(m.progress * m.total));
      setFeedback('');
      if (m.done) {
        stop();
      }
    } else if (result === 'miss') {
      flash(midi, 'miss');
      setMistakes(m.mistakeCount);
      setFeedback(`Expected ${m.current?.midis.map(midiToName).join(' + ')}`);
    }
  }

  async function start() {
    setStarting(true);
    const m = new PracticeMatcher(song, hand, profile);
    setMatcher(m);
    setIdx(0);
    setMistakes(0);
    setLastHeard('—');
    setFeedback('');
    setError('');

    // Computer-keyboard input plays the pressed note through the sampler
    // (there is no mic to feed it back into). Mic input stays silent: the
    // app's own sound would be re-detected.
    if (inputSource === 'keyboard' && !samplerRef.current) {
      void Tone.start().then(() => {
        samplerRef.current = createPianoSampler();
        return Tone.loaded();
      });
    }

    if (inputSource === 'keyboard') {
      setRunning(true);
      setStarting(false);
      return;
    }

    const detector = new LiveDetector({
      onNote: (onset: NoteOnset) => {
        // Unconfirmed onsets still go to the matcher — chord members other
        // than the dominant note arrive unconfirmed — the matcher decides
        // whether they count (chord-progress vs ignored/miss).
        feedMatch(m, onset.midi, onset.time, onset.confirmed);
      },
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

  // Computer-keyboard input during practice.
  useEffect(() => {
    if (!running || inputSource !== 'keyboard' || !matcher) return;
    const input = new KeyboardInput((midi, key) => {
      void key;
      feedMatch(matcher, midi, performance.now() / 1000, true);
    });
    input.start();
    return () => input.stop();
  }, [running, inputSource, matcher]);

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
            navigate('/');
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
        <div className="setup-panel setup-panel-vertical">
          <div className="field-row">
            <label>
              Hand <InfoTip tip="Practice only the right-hand or left-hand line of the song. Notes for the chosen hand appear on the keyboard." />
            </label>
            <select value={hand} onChange={(e) => setHand(e.target.value as Hand)}>
              <option value="R">Right (R)</option>
              <option value="L">Left (L)</option>
            </select>
          </div>
          <div className="field-row">
            <label>
              Input source{' '}
              <InfoTip tip="Microphone: play your real piano, the app listens. Computer keyboard: type the letter shown on each key (a = C4) instead." />
            </label>
            <select
              value={inputSource}
              onChange={(e) => setInputSource(e.target.value as 'mic' | 'keyboard')}
            >
              <option value="mic">Microphone (real piano)</option>
              <option value="keyboard">Computer keyboard (a=C4)</option>
            </select>
          </div>
          <div className="field-row">
            <label>
              Device profile{' '}
              <InfoTip tip="Optional. If your piano consistently reads as a different pitch, calibrate it once and pick that profile here so matches still count." />
            </label>
            <select value={profileName} onChange={(e) => setProfileName(e.target.value)}>
              <option value="">None</option>
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="actions-row">
            <button onClick={() => navigate(`/calibrate?returnTo=/practice/${song.id}`)}>
              Calibrate new device…
            </button>
            {profile && (
              <button
                className="secondary"
                onClick={() => {
                  void profileStore
                    .delete(profile.name)
                    .then(() => profileStore.list())
                    .then(({ profiles: stored }) => {
                      setProfiles(stored);
                      setProfileName('');
                    })
                    .catch((err: Error) => setError(`Deleting profile failed: ${err.message}`));
                }}
              >
                Delete “{profile.name}”
              </button>
            )}
          </div>
          <button className="primary" onClick={start}>
            Start practice
          </button>
        </div>
      )}

      {starting && <p className="hint">Loading model and requesting microphone…</p>}
      {error && <ErrorBanner message={error} />}

      {(running || done) && (
        <>
          <div className="big-note">
            {current ? current.midis.map(midiToName).join(' + ') : 'Done!'}
          </div>
          <div className="heard">
            Heard <InfoTip tip="The last note the app detected from your piano. If this shows a different note than you played, a device profile can correct it." />: {lastHeard}
          </div>
          {feedback && <div className="feedback">{feedback}</div>}
          <div className="keyboard-wrap">
            <Keyboard
              lo={lo}
              hi={hi}
              events={playable}
              mode="wait"
              currentIdx={done ? playable.length : idx}
              keyFlash={keyFlash}
              showKeyLetters={inputSource === 'keyboard'}
            />
          </div>
          <div className="stats-row">
            <span>
              {done ? playable.length : idx} / {playable.length}
            </span>
            <span>Mistakes: {mistakes}</span>
          </div>
          {(running || done) && (
            <div className="progress-track" aria-hidden="true">
              <div
                className="progress-fill"
                style={{ width: `${((done ? playable.length : idx) / playable.length) * 100}%` }}
              />
            </div>
          )}
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
              <button className="secondary" onClick={() => navigate('/')}>
                ← Library
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
