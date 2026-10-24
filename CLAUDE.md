# Project Notes

## Screenshots / images in context

Reading multiple screenshots into the conversation can blow past the API request
size limit and fail the session (hit with 9 images during a UI audit).

Rules:
- Keep at most 2–3 images in context at a time.
- When auditing UI with screenshots (Playwright MCP, .playwright-mcp/*.png,
  audit-*.png), read one screenshot, extract findings, then move on — do not
  re-read or accumulate them.
- Prefer `browser_snapshot` (accessibility tree, text) over
  `browser_take_screenshot` when visual layout is not the thing being checked.
- Clean up stale screenshots from repo root when they are no longer needed
  (they are untracked artifacts, do not commit them).
