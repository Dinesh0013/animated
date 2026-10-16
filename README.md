# Video Reach Tracker: map story

The page opens on a full-screen map of India with the awareness video on top of it. Scrolling slides the video away and zooms straight into Delhi (no tilt, rotation or drift); the map then stays still while a school list scrolls beside it and the school markers appear. The camera is a pure function of scroll progress, so scrolling back up retraces it exactly.

Below the map: a monthly student-growth chart, a schools table and a bubble chart of reach by school. The "Add your school" button lives in the top bar, with a small reminder popup near the map.

## How it works

- **Data:** the same read-only Apps Script feed as the original dashboard. `js/data.js` cleans it (viewer counts, names, usable locations) and derives the monthly series and Delhi figures.
- **Map:** MapLibre GL with OpenFreeMap vector tiles, restyled in `js/story.js`, plus India state/district boundaries and the Delhi outline from `data/` (from udit-001/india-maps-data, simplified).
- **Scroll:** GSAP ScrollTrigger drives a single progress value. `js/story.js` maps it to the camera, markers and panels.
- **Sections:** `js/sections.js` renders the charts, tables and copy. Everything is rebuilt from the data every 5 minutes without a reload.
- **Accessibility:** `prefers-reduced-motion` swaps the continuous camera for stepped views, markers are real buttons with labels, and charts have text descriptions and tables.
- **Security:** CDN scripts are pinned with Subresource Integrity hashes, and the feed is read-only.

## Run locally

Serve the folder with any static server (ES modules need `http://`, not `file://`):

```bash
python -m http.server 8000
```

The Apps Script feed and map tiles are fetched over HTTPS, so an internet connection is required.

## Credits

Map data © OpenStreetMap contributors, OpenMapTiles, served by OpenFreeMap. India boundaries from udit-001/india-maps-data.
