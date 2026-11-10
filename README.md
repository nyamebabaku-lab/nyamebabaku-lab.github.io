# nyamebabaku-lab.github.io

Forwards to FlockPilot at https://flockpilot.vercel.app, keeping any path. The app's code is at https://github.com/nyamebabaku-lab/flockpilot.

`404.html` is a copy of `index.html`, so deep links such as `/today` forward too.

## VerseBeam (`/verse/`)

A separate app at https://nyamebabaku-lab.github.io/verse/ for projecting Bible verses from a phone to a TV or projector. It is a static, installable web app with no build step, and it works offline after the first visit.

- `verse/index.html`, `verse/styles.css`, `verse/js/` — the app.
- `verse/sw.js` — caches the app and Bible data for offline use. Bump `VERSION` in it when files change.
- `verse/data/` — bundled King James Version with Strong's numbers (CrossWire, public domain) and Strong's dictionaries (Open Scriptures, CC BY-SA). Rebuilt with `verse/tools/build-data.py`.
- Copyrighted versions (NKJV, NIV, NLT, MSG, AMP) are not bundled; users import their own files in the Library tab.
