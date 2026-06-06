# Avian Visitors

A BirdNET-Pi display that turns recent detections into an illustrated bird collage.

This is a fork of the [Twarner491/AvianVisitors](https://github.com/Twarner491/AvianVisitors) awesome project. The original README is saved as [`README.upstream.md`](README.upstream.md). This fork keeps the local Pi display, but adds a secure public-facing mirror without admin controls. It also adds a Central Florida 36-bird art pack, increases collage illustration sizing across devices, and redesigns the Stats page around recent calls.

## What changed

- Added a secure, public-facing mirror without admin controls, including a [`netlify-mirror`](netlify-mirror) package for easy deployment on Netlify. Non-Netlify setup notes are also included below.
- Added a 36-species Central Florida illustration pack for birds common around ponds, yards, and wetlands in the region. The cutouts live in [`avian/assets/illustrations`](avian/assets/illustrations), with matching sizing data in the frontend.
- Increased the bird illustration sizing so the collage uses more of the screen on desktop, tablet, and phone layouts.
- Redesigned the Stats page for all devices around a recent-calls list sorted by latest detection time, with each bird's call total shown beside it. Period and top-species summaries appear below the recent list.

The 36-species Central Florida pack includes, in eBird taxonomic order:

- Black-bellied Whistling-Duck
- Common Gallinule
- American Coot
- Limpkin
- Sandhill Crane
- Wilson's Snipe
- Lesser Yellowlegs
- Greater Yellowlegs
- Least Sandpiper
- Wood Stork
- Anhinga
- White Ibis
- Glossy Ibis
- Tricolored Heron
- Swallow-tailed Kite
- Barred Owl
- Red-bellied Woodpecker
- Eastern Phoebe
- Great Crested Flycatcher
- White-eyed Vireo
- Yellow-throated Vireo
- Red-eyed Vireo
- Blue Jay
- Fish Crow
- Carolina Chickadee
- Tufted Titmouse
- Gray Catbird
- Brown Thrasher
- Eastern Bluebird
- Eastern Meadowlark
- Common Grackle
- Boat-tailed Grackle
- Northern Parula
- Yellow-throated Warbler
- Prairie Warbler
- Northern Cardinal

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
- Updates arrive only when the Pi posts a snapshot. If the Pi is unplugged, the Netlify site keeps showing the last snapshot and stops changing.

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
