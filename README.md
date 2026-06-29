# Avian Visitors - Central / North America Artwork Edition

A BirdNET-Pi display that turns local detections into an illustrated bird collage, a browsable bird atlas, and a personal guide to when each species is most likely to be seen or heard.

This is a fork of the [Twarner491/AvianVisitors](https://github.com/Twarner491/AvianVisitors) project, which itself builds on the BirdNET-Pi ecosystem. The original README is saved as [`README.upstream.md`](README.upstream.md). This edition keeps the local Pi display and public mirror workflow, but adds Central / North America artwork, best-time clocks, recent detection calendars, local rarity labels, optional eBird nearby context, and a safer Collage layout.

![Atlas detail modal showing the best-time clock dial for Northern Cardinal](docs/avian-best-time-clock.png)

## What changed

- Added a Central / North America bird illustration pack under [`avian/assets/illustrations`](avian/assets/illustrations), with regional bird images for this installation.
- Added an Atlas detail panel that shows the best time to see or hear each bird based on that species' previous BirdNET detections.
- Added BirdNET-style radial 24-hour clock dials with a red current-time marker.
- Added a Stats-page activity clock for all detections, including a click-to-enlarge modal view.
- Added a 30-day detection calendar on Atlas species details so each bird has recent activity context.
- Added local rarity tiers: Epic, Rare, Uncommon, and Pedestrian, calculated from this BirdNET instance's own detection history.
- Added small Collage badges for only the most notable birds: Epic and Rare.
- Added optional eBird nearby-observation context using a server-side API key.
- Added an admin/settings field for storing an eBird API key as a masked secret.
- Improved Collage placement so bird tiles are much less likely to overlap when artwork sizes vary.
- Updated the public mirror snapshot format so hosted/static views can show enriched species profiles without direct database access.

## Activity clocks

The project now has two clock-dial views:

- **Atlas species clock:** click a bird in Atlas to see when that specific species is most often detected by this BirdNET installation.
- **Stats activity clock:** the Stats page shows when any bird is detected across the day.

Both clocks reuse the original BirdNET-style polar histogram idea. Green wedges show detection volume by hour, the strongest hour is emphasized, and a thin red line marks the current local time. The Stats clock can be clicked to open a much larger modal view for easier reading.

## Detection calendar and rarity

Atlas species details now include a compact 30-day detection calendar. This answers a different question from the clock: the clock shows the best time of day, while the calendar shows how recently and how often that species has been detected.

Rarity is calculated from this installation's own detection history:

- **Epic:** 1 total detection, or less than 0.1% of all detections.
- **Rare:** 2-3 total detections, or less than 0.5% of all detections.
- **Uncommon:** less than 2% of all detections.
- **Pedestrian:** everything else.

Only Epic and Rare birds get small badges on the Collage page, keeping the main view clean while still calling attention to special visitors.

## eBird nearby context

The Atlas can optionally show nearby recent eBird reports as extra context. This is read-only: it helps compare local BirdNET detections against nearby community observations, but it does not submit detections or checklists to eBird.

The eBird API key is stored server-side and masked after it is saved. The browser can see whether a key is configured, but it cannot retrieve the raw key.

To enable eBird nearby observations:

1. Open the BirdNET-Pi Avian Visitors settings/admin screen.
2. Enter an eBird API key in the eBird API key field.
3. Make sure the BirdNET-Pi config has `LATITUDE` and `LONGITUDE` set.

The API reads recent observations around the configured location and caches responses briefly so the UI stays responsive.

## Atlas species details

Clicking a bird in the Atlas opens a detail modal with the illustration, detection counts, Wikipedia/eBird links, recordings on the local Pi, and the new activity sections.

The local endpoint at `avian/api/birdnet-api.php?action=species` now includes a `time_profile` block for every species:

```json
{
  "time_profile": {
    "hours": [0, 1, 2, 3],
    "counts": [0, 2, 4, 1],
    "total": 228,
    "peak_hour": 6
  }
}
```

It also includes a `daily_profile` block for the recent detection calendar:

```json
{
  "daily_profile": {
    "days": ["2026-06-01", "2026-06-02"],
    "counts": [0, 3],
    "total": 18,
    "active_days": 7
  }
}
```

`avian/frontend/apt.js` renders the clock, calendar, rarity label, and eBird nearby status in the Atlas modal, with graceful empty states when a species has little or no local history yet.

## Artwork edition notes

This branch replaces and expands the bird artwork used by the collage and Atlas. The artwork set is intended for Central and North America-focused BirdNET-Pi installations, while still preserving the core AvianVisitors UI and deployment model.

## Local Pi display

Install the same way as the upstream project, but point the installer at your fork once you publish it:

```bash
ssh <your-username>@birdnet.local
curl -s https://raw.githubusercontent.com/YOUR_GITHUB_USER/AvianVisitors/main/newinstaller.sh | bash
```

After the Pi reboots:

- Collage UI: `http://birdnet.local/`
- Stock BirdNET-Pi UI: `http://birdnet.local/index.php`

The local Pi version keeps the menu and admin tools because it is meant for your LAN.

## Public mirror

The public mirror is for friends and family. The included implementation uses Netlify. It serves the same collage, stats, and atlas views, but it does not expose the Pi itself.

Public mirror behavior:

- The menu button is hidden.
- Admin routes are blocked in the browser.
- The Netlify `menu.php` shim returns no menu items.
- Private endpoints such as recordings, spectrograms, config, and Pi status return `404`.
- Bird audio is not mirrored.
- eBird secrets stay on the live BirdNET-Pi server; mirror-only eBird calls return a disabled placeholder.
- Updates arrive only when the Pi posts a snapshot. If the Pi is unplugged, the Netlify site keeps showing the last snapshot and stops changing.

The mirror snapshot now includes `time_profile` and `daily_profile` data, so the public Atlas can render clocks, recent activity, and rarity context without direct database access.

### Mirror setup

In Netlify, set this environment variable:

```bash
AVIAN_MIRROR_PUSH_TOKEN=replace-with-a-long-random-token
```

Then update these placeholders:

- [`netlify-mirror/public/index.html`](netlify-mirror/public/index.html): replace `YOUR_NETLIFY_SITE` and `[insert your location]`.
- [`netlify-mirror/scripts/avian-mirror-export.py`](netlify-mirror/scripts/avian-mirror-export.py): replace `YOUR_NETLIFY_SITE`, or set `AVIAN_MIRROR_INGEST_URL` on the Pi.
- [`netlify-mirror/netlify/functions/wiki.mts`](netlify-mirror/netlify/functions/wiki.mts): replace `YOUR_NETLIFY_SITE` in the user agent.

Build check:

```bash
cd netlify-mirror
npm install
npm run build
```

Deploy only after the placeholders and token are set:

```bash
netlify deploy --prod --dir=public
```

### First Pi push

Copy the mirror scripts to the Pi:

```bash
scp netlify-mirror/scripts/avian-mirror-export.py birdnet.local:~/BirdNET-Pi/scripts/
scp netlify-mirror/scripts/avian-mirror-watch-push.sh birdnet.local:~/BirdNET-Pi/scripts/
```

Create `~/.avian-visitors-mirror.env` on the Pi:

```bash
AVIAN_MIRROR_PUSH_TOKEN=replace-with-the-same-token
AVIAN_MIRROR_INGEST_URL=https://YOUR_NETLIFY_SITE.netlify.app/api/mirror/ingest
```

Post one snapshot:

```bash
ssh birdnet.local
source ~/.avian-visitors-mirror.env
python3 ~/BirdNET-Pi/scripts/avian-mirror-export.py --post
```

For ongoing updates, run `avian-mirror-watch-push.sh` under systemd or another process supervisor. The watcher waits briefly after the database changes, then posts a fresh snapshot.

### Using another host

The mirror is not tied to Netlify. Netlify is just the implementation included here. To run the mirror on another host, serve [`netlify-mirror/public`](netlify-mirror/public) as the static site and provide these routes:

- `GET /avian/api/birdnet-api.php?action=stats`
- `GET /avian/api/birdnet-api.php?action=lifelist`
- `GET /avian/api/birdnet-api.php?action=timeseries`
- `GET /avian/api/birdnet-api.php?action=firstseen`
- `GET /avian/api/birdnet-api.php?action=recent&hours=24`
- `GET /avian/api/birdnet-api.php?action=species&sci=Cardinalis%20cardinalis`
- `GET /avian/api/birdnet-api.php?action=ebird_nearby&dist=25&back=14` optional, when eBird is configured
- `POST /api/mirror/ingest`
- `GET /avian/api/cutout.php?sci=Cardinalis%20cardinalis`
- `GET /avian/api/menu.php`
- `GET /avian/api/wiki.php?sci=Cardinalis%20cardinalis`

The checked-in Netlify functions are the reference implementation. A Cloudflare Pages Functions, Vercel Functions, small VPS, or other backend can use the same pattern:

- Store the latest snapshot posted by the Pi.
- Read from that snapshot for the `birdnet-api.php` actions.
- Redirect `cutout.php` to the matching PNG in `/avian/assets/illustrations/`.
- Return `{ "items": [] }` from `menu.php`.
- Return `404` for private routes such as recordings, spectrograms, config, and Pi status.
- Keep `POST /api/mirror/ingest` token-protected.

Pure static hosts need one extra adapter because there is nowhere to receive the Pi's snapshot post or answer the API routes. For those, publish the snapshot JSON yourself and adjust the frontend to read that file directly.

## Privacy and data notes

BirdNET detections stay local in the BirdNET-Pi database unless you choose to export or publish them yourself. The eBird integration added here is only for reading nearby observation context from eBird. It does not publish BirdNET detections to eBird.

The eBird API key is treated as a secret setting. After it is saved, the settings endpoint reports only whether the key is configured and a masked value for display.

## Repo layout

```text
avian/
  frontend/       Local BirdNET-Pi collage UI
  assets/         Bird illustrations, cutouts, and sizing data
  api/            PHP shims served by BirdNET-Pi
  scripts/        Illustration-generation helpers
  forwarding/     Optional forwarding recipes from upstream

netlify-mirror/
  public/         Public static UI and seed snapshot
  netlify/        Read-only API functions and snapshot ingest
  scripts/        Pi-side snapshot export and watcher scripts
```

## License

This fork keeps the upstream license: CC-BY-NC-SA-4.0, inherited from [BirdNET-Pi](https://github.com/Nachtzuster/BirdNET-Pi/blob/main/LICENSE). Non-commercial use only.
