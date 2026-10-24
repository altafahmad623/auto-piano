# Plan 003: UX clarity improvements

## Problem
Audit (ui-ux-pro-max skill DB + live screenshots) found five clarity/feedback gaps. No design-token or architecture changes — all reuse existing components (`InfoTip`, `error-banner` pattern, current tokens).

## Changes
1. **Home empty state**: add hero blurb explaining the app ("Play your real piano — the app listens") and one-line roles for Free play / Calibrate buttons.
2. **Practice progress bar**: thin progress bar under keyboard during practice (reuse `--border`/`--good` tokens). Keeps "n / total" text.
3. **Heard label**: add InfoTip to "Heard:" explaining it shows the last note the mic detected.
4. **Calibrate hint**: move hint paragraph above Start button, tighten wording.
5. **Free-play hint**: one-line letter-mapping hint ("a = C4 … w e t y u o p") in the blank area above keyboard.

## Out of scope
Style/palette regeneration, motion/animation additions.

## Verification
- `npx tsc -b` clean, `npm test` green.
- Browser check of each changed view.
