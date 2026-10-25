# Plan 004: Requirements — routing, profile persistence, practice correctness, UI refresh

Status: **requirements draft — decisions marked `OPEN` need user sign-off before implementation.**
Written so a fresh Claude session can pick this up cold.

## 0. Context / current state

Uncommitted work already in the tree (from the calibration-debug session; see `git status`):

- `src/detector.ts`
  - **Fixed** `takeWindow()`: `startInLead` was `Math.max(0, lead.length - excess)`, now `excess`. The old line returned `null` whenever the buffered size was a multiple of the 128-sample worklet chunk (always true at 48 kHz), so `poll()` never ran inference and "Heard" never fired.
  - **Added** `LiveDetectorOptions.requireGuessAgreement` + exported `guessAgrees()`: an onset is emitted only if the mono autocorrelation guess was stable on the same MIDI within ±1 s (`GUESS_AGREE_SECONDS`). Rejections are logged as `[detector] rejected (no matching guess): …`.
  - Temporary `[detector] rms …` diagnostics (`topBinsLog`, `console.log` in `poll()`) are still present.
- `src/components/CalibrateView.tsx` passes `{ requireGuessAgreement: true }`.
- `src/detector.test.ts`: 10 unit tests (`takeWindow`, `guessAgrees`, `guessMidi`) pass; 3 `takeWindow` tests fail against the old line.

Known facts from the debug session:

- basic-pitch **hallucinates low notes on near-silence** (A1, F#1, D#2, C3, E1; amplitudes 0.22–0.55, same range as real notes). Before the gate, ambient noise auto-filled 12/12 calibration keys in ~15 s.
- Steady-state inference is ~120–135 ms after a ~1.5 s first-call warmup (webgl, M3 Pro). Latency is not a concern.
- **Not verified:** a clean silent-room baseline with the gate on (the one run had tonal sound in the room, RMS 0.008–0.03) and the accepted/rejected behaviour on real key presses. Calibration is reported working by the user; the zero-false-positives claim is untested.
- Practice mode uses the same detector **without** the guess gate (`PracticeView.tsx`), so it is exposed to the same hallucinations.

Current architecture facts relevant below:

- `src/App.tsx`: view is a `useState<View>` union; **no URLs**, no router dependency.
- `src/calibration.ts`: profiles in `localStorage['auto-piano-device-profiles']`, synchronous API (`listProfiles/saveProfile/deleteProfile`), used by `App.tsx` and `PracticeView.tsx`.
- `src/library.ts`: songs bundled at build time via `import.meta.glob('/songs/*.txt')`; only `fur-elise.txt` exists. Song identity is currently its **title** (`key={view.song.title}`).
- `src/components/PracticeView.tsx`: creates a Tone sampler and plays each accepted note (`samplerRef.current?.triggerAttackRelease`).

## 1. Separate pages via URLs

**Requirement.** Each screen is addressable and survives reload / back / forward.

| Route | View |
|---|---|
| `/` | song library (`SongList`) |
| `/listen/:songId` | `ListenView` |
| `/practice/:songId` | `PracticeView` |
| `/free-play` | `FreePlayView` |
| `/calibrate` | `CalibrateView` (optional `?returnTo=/practice/:songId`) |
| `*` | not-found view with link home |

**Technical approach**
- Add `id` (slug from filename, e.g. `fur-elise`) to `Song` in `src/types.ts`; set it in `loadSongs()`. Replace title-as-identity (`key={…title}`).
- Replace the `View` union in `App.tsx` with route definitions; replace `onListen/onPractice/onBack/...` callbacks with navigation (`navigate`/`<Link>`).
- The current `from: 'library' | 'practice'` + `song` state in the `calibrate` view becomes `?returnTo=`; `calibrateDone` navigates to it (default `/`). Validate `returnTo` is an internal path (starts with `/`, not `//`) to avoid open redirects.
- Unknown `:songId` → not-found view, not a crash.
- Mic/audio must stop on route change. `CalibrateView` and `PracticeView` already stop the detector in their unmount cleanup — confirm this still holds when navigating via browser back mid-session.
- Dev/preview: Vite serves an SPA fallback by default (verify). Static hosting would need a rewrite rule; no deploy config exists in the repo, so only document it.

**Options (`OPEN`)**
- A. `react-router-dom` — params, `navigate`, `<Link>`, back-button handled. One new dependency. *Leaning A.*
- B. ~40-line custom `history` hook — no dependency, but we re-implement params/links/not-found.
- C. Hash routing (`/#/calibrate`) — no server fallback needed, but uglier URLs.

**Acceptance**
- Direct load of each route renders the right view; reload keeps you there.
- Browser back/forward works across all views; mic indicator off after leaving calibrate/practice.
- Calibrate launched from practice returns to that song's practice route.

**Files:** `src/App.tsx`, `src/main.tsx`, `src/types.ts`, `src/library.ts`, `SongList.tsx`, `PracticeView.tsx`, `CalibrateView.tsx`, `ListenView.tsx`, `FreePlayView.tsx`, `package.json` (option A).

## 2. Where calibrated profiles are saved

**Today:** `localStorage` under the app's origin. It already persists across sessions in the same browser profile, but is lost when the origin changes (different dev port, `localhost` vs `127.0.0.1`), the browser/profile changes, or site data is cleared. The Playwright browser has its own empty storage.

**Requirement.** Profiles survive those cases and are inspectable/portable.

**Options (`OPEN`)**
- A. **File System Access API.** User picks a folder once (`showDirectoryPicker`); keep the `FileSystemDirectoryHandle` in IndexedDB; write `<name>.json` per profile. Chromium-only (no Firefox/Safari). Permission typically has to be re-granted with a user gesture in a new session — so "ask on every app start" becomes a one-click banner, not a picker each time.
- B. **Vite dev-server middleware** (`GET/POST/DELETE /api/profiles`) writing to a repo-local `profiles/` dir. Any browser, no prompts, trivially backed up or committed. Only works while served by `vite` (dev/preview), not static hosting.
- C. **Keep localStorage + Export/Import JSON** buttons. Smallest change; manual.
- D. Hybrid: localStorage as cache + A or B as the durable store.

*Opinion:* prompting for a folder on every app start is friction; if the app is only ever run locally via `npm run dev`, B is simplest and most reliable. If it must run as a plain static site, A. Need the user's answer on how it's run.

**Technical notes (any option)**
- Introduce a storage interface (`ProfileStore`: `list/save/delete`, **async**) in `src/calibration.ts`; today's sync functions have two call sites (`App.tsx`, `PracticeView.tsx`), so the refactor is small.
- Add `version: 1` to the stored JSON; one-time migration that imports existing `localStorage` profiles into the new store, leaving the old key untouched until the user confirms.
- Profile name → filename: sanitize (`[a-z0-9-_]`), handle collisions/overwrite deliberately (current `saveProfile` overwrites same name).
- Surface errors with the existing `ErrorBanner` (permission denied, folder removed).

**Acceptance**
- Save a profile, reload with a different origin/port (or fresh browser profile for B), profile still listed and usable in practice.
- Corrupt/unknown-version file is skipped with a visible message, not a crash.

**Files:** `src/calibration.ts`, `App.tsx` (save), `PracticeView.tsx` (list/delete), `vite.config.ts` (option B), `.gitignore` (`profiles/` decision).

## 3. Practice mode

### 3i. Listen only — no audio output from the app

**Technical approach:** remove from `PracticeView.tsx` the `Tone` import, `samplerRef`, the `Tone.start().then(createPianoSampler)` block in `start()`, and the `triggerAttackRelease` in `feedMatch`. `ListenView` / `FreePlayView` keep their sampler.

**Why (beyond preference):** the sampler plays through the speakers, so the mic can hear the app's own note and feed it back into the detector.

**`OPEN`:** with the *computer-keyboard* input source there is no other sound. Keep sampler feedback for that source only, or fully silent?

### 3ii. Progress advances only on a real key press

**Interpretation (confirm):** the cursor advances only when the user physically plays the expected note — not on room noise, model hallucinations, harmonics, or a ringing previous note re-detected.

**Known leaks today**
1. **Hallucinated onsets** — practice has no gate (see §0). Any onset whose pitch equals the expected note advances.
2. **Repeated pitches** (consecutive events with the same MIDI): `PracticeMatcher.feed()` has no minimum gap between hits; a decaying previous note could satisfy the next event. Unverified; check against `songs/fur-elise.txt` repeats.
3. `Skip` advances manually (intentional; keep).
4. `lastHeard` updates for every onset including noise, which makes the UI look wrong even when progress is correct.

**Proposed approach (needs prototyping on real piano data)**
- Make the detector report confirmation instead of dropping: `NoteOnset.confirmed: boolean` (guess agreed within ±1 s). Consumers decide: `CalibrateView` and **single-note** practice events require `confirmed`; **chord** events require every member detected plus at least one confirmed anchor (the mono guess only sees the dominant note). This replaces/extends the `requireGuessAgreement` option.
- Add a window-RMS floor so near-silent windows emit nothing (value to tune; observed noise RMS 0.002–0.01).
- In `PracticeMatcher`, add a re-arm rule: after a hit, the same pitch must produce a new onset at least N ms later before it can satisfy the next event.
- Gate or remove the temporary `[detector]` diagnostics (e.g. behind `localStorage.debugDetector`).
- Verify the gate against **calibration profiles**: with `offsets[expected] = detected`, confirm the guess reads the same shifted pitch as basic-pitch. If not, compare against the profile-mapped pitch.

**Needs the user:** a data-collection run on the real piano (press listed keys ~2 s apart, firmly, plus a silent stretch and a few soft presses) to tune thresholds. Keep threshold constants named in `detector.ts`.

**Acceptance**
- 30 s of silence / room noise: **0** advances, **0** mistakes counted.
- Correct key pressed once: advances exactly once within ~1 s.
- Wrong key: `miss` + mistake count, no advance.
- Two consecutive same-pitch events need two separate presses.
- Soft but deliberate press still registers (measure and record the minimum RMS/amplitude that works).

**Tests (unit-only per project rule):** matcher re-arm and chord-anchor logic, `confirmed` flagging, RMS gate. Mic behaviour is verified manually.

**Files:** `src/detector.ts`, `src/matcher.ts`, `src/components/PracticeView.tsx`, `CalibrateView.tsx`, `detector.test.ts`, new `matcher.test.ts`.

## 4. UI refresh

**Observation:** part of the "empty" feel is content — the library has **one** song. Plan 003 explicitly excluded palette/motion changes; this plan lifts that.

**Process**
1. Run `ui-ux-pro-max` to pick a style/palette/type pairing and `improve-ui` to audit current screens against it; output is implementation plans, not code.
2. Respect `CLAUDE.md`: read at most 2–3 screenshots at a time, prefer `browser_snapshot`, delete stale `audit-*.png` / `.playwright-mcp` artifacts.
3. Land after §1 (shared shell/nav needs routes) and §3 (practice HUD shows trustworthy state).

**Candidate scope (`OPEN` — prioritize with user)**
- App shell: header with nav (Library / Free play / Calibrate), active-route state.
- Library: song cards (title, key/time/BPM, hands, best score once stats exist), richer empty/hero state; add more sample songs if wanted.
- Keyboard: press/hit/miss animation, next-note highlight, optional falling-notes lane.
- Practice HUD: large next note, streak, accuracy, progress ring; completion screen (accuracy, mistakes, replay).
- Calibration: per-key status shown on the keyboard (recorded / skipped / current), mic-level meter polish.
- Polish: transitions with `prefers-reduced-motion` respected, contrast ≥ 4.5:1, responsive down to tablet width.
- Stats persistence (best accuracy per song) would reuse the §2 store.

**Constraints:** no heavy UI/animation dependency without asking; keep existing `InfoTip` / `ErrorBanner` patterns.

## 5. Suggested order and dependencies

1. **§3** — practice correctness is the core feature and currently untrustworthy; also unblocks calibration confidence. Needs the real-piano data run.
2. **§1** — mechanical, but required by §4's shell.
3. **§2** — independent; do after the storage option is chosen.
4. **§4** — last; depends on §1 and §3.

## 6. Open decisions (summary)

1. Router: react-router-dom vs custom vs hash (§1).
2. Profile storage: A / B / C / D, and how the app is run — dev server or static (§2).
3. Computer-keyboard input: sampler feedback or silent (§3i).
4. Confirm the §3ii interpretation and the confirmed-anchor approach for chords.
5. UI direction and priority from the §4 candidate list; whether to add more songs.

## 7. Verification (every part)

- `npx vitest run` green; `npx tsc -b` clean on affected packages only (no repo-wide builds).
- Manual browser pass per changed view; integration/mic runs are done by the user with Claude directing key presses.
