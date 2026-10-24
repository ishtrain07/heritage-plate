# Backlog (paused to save time; pick up before Oct 28 freeze)

## UI
- **Hero example card (Plate):** it looks stuck. It should either shuffle or swap left/right between examples, or be clearly static. Text on it also shows dark highlight boxes (seen on the Vercel branch preview, Oct 24). Check the card animation; it may also cause the "flicker" on load.
- **Vercel branch preview feels unstable** (flicker, Care not loading). Local build is stable at 390/1280 px with any saved side. Next steps: check `/api/care/library` and `/static/care.js` on the preview URL, check Deployment Protection, then redeploy.
- **First visit and shared links** should open on the home page (`#home`), not the side used last.
- **Care front end polish** and **a simple "what this app does" explainer** on home.

## Content
- Devpost text and 3-minute video script (Plate + Care).
- Verified sources for the stop-list remedies, and for salicylic acid as a face/acne active.

## Release
- Merge `claude/stoic-wozniak-8ie5mb` → `main` only after "ship it".
