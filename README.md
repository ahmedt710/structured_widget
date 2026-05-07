# Schedule-based Notion Widget

A static widget you can embed in Notion that:
- fetches your schedule from a **public GitHub raw URL** (NDJSON: **one JSON object per line**)
- auto-runs with real time
- shows **current task + time remaining**, or **time until next task**
- plays a **soothing chime** on task **start and end** (deduped for overlaps)
- supports **aesthetic backgrounds** per task type (study/break/pray/other)

## Your schedule source (example)

The schedule file format is NDJSON:

```txt
{"title":"MCAT Study Block 1A","startTime":"2026-05-07T10:00:00-04:00","endTime":"2026-05-07T10:50:00-04:00","colour":"Orange","icon":"Book"}
{"title":"MCAT Study Block 1A Break","startTime":"2026-05-07T10:50:00-04:00","endTime":"2026-05-07T11:00:00-04:00","colour":"Blue","icon":"iPhone"}
```

Required fields: `title`, `startTime`, `endTime`  
Optional fields: `colour`, `icon`, `completed`, anything else (ignored)

## Run locally

Any static server works. For example:

```bash
python -m http.server 5173
```

Then open `http://localhost:5173/`.

## GitHub Pages deployment

1. Create a GitHub repo for this widget (or use an existing one).
2. Put `index.html`, `styles.css`, `main.js` at the repo root.
3. In GitHub: **Settings → Pages**:
   - Source: **Deploy from a branch**
   - Branch: `main` (or `master`) and `/ (root)`
4. Wait for Pages to publish your URL:
   - `https://<user>.github.io/<repo>/`

## Notion embed URL

In Notion, add an **Embed** block and paste a URL like:

```txt
https://<user>.github.io/<repo>/?src=<urlencoded_raw_schedule_url>
```

### Example (your schedule)

Raw schedule URL:

```txt
https://raw.githubusercontent.com/ahmedt710/structured/main/structured_json.txt
```

Embed (after you deploy Pages):

```txt
https://<user>.github.io/<repo>/?src=https%3A%2F%2Fraw.githubusercontent.com%2Fahmedt710%2Fstructured%2Fmain%2Fstructured_json.txt
```

## Backgrounds (study/break/pray/other)

Provide your own background images via query params:

```txt
&bgStudy=https%3A%2F%2Fexample.com%2Fstudy.jpg
&bgBreak=https%3A%2F%2Fexample.com%2Fbreak.jpg
&bgPray=https%3A%2F%2Fexample.com%2Fpray.jpg
&bgOther=https%3A%2F%2Fexample.com%2Fother.jpg
&bgOpacity=0.55
&bgBlurPx=2
```

## Useful params

- `sound=1|0`, `volume=0..1`
- `compact=1`
- `hideTimeline=1`
- `fontScale=0.8..1.2`
- `fetchEveryMs=300000` (refresh schedule every 5 min)

## Task type classification

`pray`: title contains `prayer` or `Fajr/Dhuhr/Asr/Maghrib/Isha`  
`break`: title contains `break`, `wind down`, `lunch`  
`study`: title contains `MCAT`, `Anki`, `CARS`, `Quran`  
`other`: fallback

