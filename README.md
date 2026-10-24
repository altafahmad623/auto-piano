# Auto Piano

Web app that listens to your real piano through the microphone and teaches you
songs note by note. Play the right note → the cursor advances. Also plays the
song back for you (listen mode).

## Modes

- **Library** — browse songs from the `songs/` directory.
- **Listen** — the app plays the song with sampled piano while highlighting notes.
- **Practice** — pick a hand (R/L), play your piano; detected notes advance the
  cursor. Chords require all members. Wrong notes count as mistakes. Order
  matters, timing does not. Input source: microphone (real piano) or computer
  keyboard. Accepted notes play a piano tone as feedback.
- **Free play** — jam on the computer keyboard with piano sounds (a = C4,
  interleaved mapping: `a w s e d f t g y h u j k o l p ;`).
- **Calibrate device** — optional. Play keys one by one in order; each key's
  detected pitch is stored under a named device profile so the matcher accepts
  how *your* instrument reads.

## Pitch detection

Polyphonic via Spotify's [basic-pitch](https://github.com/spotify/basic-pitch)
model (TensorFlow.js, runs locally in the browser, ~1 MB). Chords and both
hands are detected. Expect ~0.5 s detection latency.

## Song file format

Text files in `songs/`:

```
Key: A minor
Beat: 3|4
Tempo: 120
R: ED# ED# EB DC | A - - | C E A |
L: | A E A | |
```

Rules:

- `Key`, `Beat` (measures|beat-unit), `Tempo` (BPM) headers. Only `Tempo`
  affects playback.
- `R:` / `L:` lines hold the right/left hand notes. Lines pair up in order;
  both lines of a pair occupy the same measures. A missing line rests.
- Tokens are whitespace-separated; `|` is a measure boundary.
- A token is one or more glued letters: `ED#` = E then D# (sequential, one
  step each). A step is one eighth note at `Tempo`.
- `[CEG]` is a chord: C, E, G together (one step).
- `-` holds the previous note of that hand for one step.
- Optional octave digit after a letter: `E5`. Defaults: R hand octave 4,
  L hand octave 3.
- Optional fingering suffix `:n` (1–5, thumb=1): `E:1`, `[C:1E:3G:5]`.

Example: `songs/fur-elise.txt`.

## Development

```sh
npm install
npm run dev      # http://localhost:5173 (mic requires localhost or HTTPS)
npm test         # parser unit tests (vitest)
```

The piano samples for listen mode are fetched from
`https://tonejs.github.io/audio/salamander/` at runtime.
