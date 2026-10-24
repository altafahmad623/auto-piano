# Plan 001: Replace alert() with inline error banner

## Problem
Three views use browser-native `alert()` for failures (mic permission denied,
piano sample load failure). This breaks the app's custom dark design system
(styled `--panel`/`--border` components in `src/index.css`) with a
platform-styled modal.

## Change
1. New shared component `src/components/ErrorBanner.tsx`: single-prop
   `message`, rendered as a bordered panel using existing tokens
   (`--panel` bg, `--bad` accent). No new tokens.
2. `PracticeView.tsx`: add `error` state; replace the mic-failure `alert()`
   with `setError(...)` + render `<ErrorBanner message={error} />` in the
   setup panel area. Clear error on `start()` and `stop()`.
3. `ListenView.tsx`: same — sample-load failure sets `error`, banner shown
   under the header. Clear on play/stop.
4. `CalibrateView.tsx`: same for mic failure.

## Out of scope
Findings #2 (Escape-key exit) and #3 (flash timing) — separate plans.

## Verification
- `npx tsc -b` clean, `npm test` green.
- Browser: free play → confirm no console errors. (Mic failure path requires
  denying permission — verified by code inspection if not testable headless.)
