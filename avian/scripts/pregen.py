#!/usr/bin/env python3
"""AvianVisitors - pre-generate bird illustrations for a region.

Reads a species list (BirdNET-Pi's labels.txt, eBird, or stdin),
generates an illustration for each via Gemini or OpenAI image generation,
and saves PNGs into avian/assets/illustrations*.

Each species gets two poses: <slug>.png (perched) and <slug>-2.png
(flight). Edit avian/scripts/prompt.template.md to change the visual
style - the prompt body is re-sent verbatim per request with
{sci_name}, {com_name}, and {pose} substituted.

Usage:
    # Every species BirdNET-Pi knows:
    python3 pregen.py --labels ~/BirdNET-Pi/model/labels.txt

    # Only species observed in an eBird region:
    python3 pregen.py --labels ~/BirdNET-Pi/model/labels.txt \\
                      --ebird-region US-CA --ebird-key YOUR_KEY

    # Re-render a single species (useful after editing the prompt):
    python3 pregen.py --species "Calypte anna|Anna's Hummingbird" --force

    # Re-render everything after a prompt change:
    python3 pregen.py --labels ~/BirdNET-Pi/model/labels.txt --force

Set GEMINI_API_KEY / OPENAI_API_KEY in the environment (preferred) or
pass --gemini-key / --openai-key.
"""
from __future__ import annotations
import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Gemini's image-out model. The endpoint changes occasionally; if you
# get a 404 here, check Google's model catalog and bump this.
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash-image:generateContent"
)
OPENAI_URL = "https://api.openai.com/v1/images/generations"
POSES = {1: "perched", 2: "in flight with wings spread"}
OPENAI_STYLES = {
    "watercolor": "loose transparent watercolor with soft paper texture, natural field-guide proportions, gentle pigments",
    "ink": "clean black ink linework with restrained wash color, vintage scientific plate feeling, crisp silhouette",
    "paper-cut": "layered paper-cut collage, visible paper edges, subtle shadowing, handmade but anatomically faithful",
    "poster": "mid-century naturalist poster art, flat shapes, limited warm palette, confident graphic forms",
    "vintage": "antique ornithology plate, hand-colored engraving mood, warm aged paper influence but transparent background",
    "gouache": "opaque gouache illustration, matte color blocks, soft feather detail, modern natural history style",
    "minimal": "minimal geometric bird illustration, accurate species marks, calm modern icon-like silhouette",
    "custom": "",
}


def slugify(sci: str) -> str:
    """Match avian/frontend/apt.js slugify() exactly."""
    return re.sub(r"[^a-z0-9]+", "-", sci.lower()).strip("-")


def parse_species_line(line: str) -> tuple[str, str] | None:
    """Accept any of: 'Sci|Com', 'Sci_Com', 'Sci,Com'. Skip blanks + #."""
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    for sep in ("|", "_", ","):
        if sep in line:
            sci, com = line.split(sep, 1)
            sci, com = sci.strip(), com.strip()
            if sci and com:
                return (sci, com)
    return None


def parse_species_list(lines: list[str]) -> tuple[list[tuple[str, str]], int]:
    """Returns (parsed, skipped_count)."""
    out, skipped = [], 0
    for line in lines:
        parsed = parse_species_line(line)
        if parsed:
            out.append(parsed)
        elif line.strip() and not line.lstrip().startswith("#"):
            skipped += 1
    return out, skipped


def load_prompt(path: Path) -> str:
    """Return everything after the `## Prompt` heading, stripped to the
    next `##` heading (so doc preamble or trailing sections don't bleed
    into the API call)."""
    text = path.read_text()
    m = re.search(r"##\s*Prompt\s*\n(.+?)(?=\n##\s|\Z)", text, flags=re.DOTALL)
    return (m.group(1) if m else text).strip()


def ebird_filter(species, region: str, key: str):
    """Intersect a label set with the eBird species list for a region.
    Region codes: US-CA (state), US-CA-085 (county)."""
    url = f"https://api.ebird.org/v2/product/spplist/{region}"
    req = urllib.request.Request(url, headers={"X-eBirdApiToken": key})
    with urllib.request.urlopen(req, timeout=30) as r:
        ebird_codes = set(json.loads(r.read()))
    tax_url = "https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json"
    req2 = urllib.request.Request(tax_url, headers={"X-eBirdApiToken": key})
    with urllib.request.urlopen(req2, timeout=60) as r:
        taxonomy = json.loads(r.read())
    code_to_sci = {t["speciesCode"]: t["sciName"] for t in taxonomy}
    allowed = {code_to_sci[c] for c in ebird_codes if c in code_to_sci}
    return [(s, c) for s, c in species if s in allowed]


def write_progress(path: Path | None, **data) -> None:
    if not path:
        return
    data.setdefault("updated_at", time.strftime("%Y-%m-%dT%H:%M:%S%z"))
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(json.dumps(data, ensure_ascii=True))
        tmp.replace(path)
    except OSError:
        pass


def gen_one_gemini(api_key: str, prompt: str, sci: str, com: str, pose: int) -> bytes:
    """Single Gemini call with bounded retry on 429 + transient 5xx.
    Returns raw PNG bytes."""
    body = (prompt
            .replace("{sci_name}", sci)
            .replace("{com_name}", com)
            .replace("{pose}", POSES[pose]))
    payload = {
        "contents": [{"parts": [{"text": body}]}],
        # TEXT included so Gemini can surface safety messaging without
        # rejecting the request shape (image-only sometimes errors).
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
    }
    # API key as header, NOT URL - keeps the key out of Google's
    # request logs, proxy logs, and shell history.
    req = urllib.request.Request(
        GEMINI_URL,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )

    backoff = 4.0
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                resp = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                ra = e.headers.get("Retry-After")
                try:
                    retry_after = float(ra) if ra else backoff
                except (TypeError, ValueError):
                    retry_after = backoff  # HTTP-date format, fall back
                time.sleep(retry_after)
                backoff *= 2
                continue
            raise
        except urllib.error.URLError:
            if attempt < 3:
                time.sleep(backoff)
                backoff *= 2
                continue
            raise

    for cand in resp.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                return base64.b64decode(inline["data"])
    # No image - surface the blocking reason so users know what to fix.
    finish = (resp.get("candidates", [{}])[0]).get("finishReason", "?")
    block = resp.get("promptFeedback", {}).get("blockReason", "")
    raise RuntimeError(f"no image (finish={finish} block={block})")


def openai_prompt(sci: str, com: str, pose: int, style: str, custom_style: str = "") -> str:
    style_text = custom_style.strip() if style == "custom" else OPENAI_STYLES.get(style, OPENAI_STYLES["watercolor"])
    if not style_text:
        style_text = OPENAI_STYLES["watercolor"]
    return (
        f"Create a full-body bird illustration of {com} ({sci}), {POSES[pose]}. "
        f"Style: {style_text}. "
        "The bird must be isolated on a fully transparent background, centered, "
        "with the entire bird visible including feet, tail, beak, and wing tips. "
        "Keep the pose useful for a UI collage: no scenery, no text, no labels, "
        "no frame, no watermark, no cropped body parts. Preserve field marks that "
        "make the species recognizable."
    )


def gen_one_openai(api_key: str, model: str, sci: str, com: str, pose: int, style: str, custom_style: str = "") -> bytes:
    """Single OpenAI image call with bounded retry. Returns raw PNG bytes."""
    payload = {
        "model": model,
        "prompt": openai_prompt(sci, com, pose, style, custom_style),
        "size": "1024x1024",
        "quality": "medium",
        "n": 1,
    }
    req = urllib.request.Request(
        OPENAI_URL,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )

    backoff = 4.0
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                resp = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                ra = e.headers.get("Retry-After")
                try:
                    retry_after = float(ra) if ra else backoff
                except (TypeError, ValueError):
                    retry_after = backoff
                time.sleep(retry_after)
                backoff *= 2
                continue
            raise
        except urllib.error.URLError:
            if attempt < 3:
                time.sleep(backoff)
                backoff *= 2
                continue
            raise

    data = (resp.get("data") or [{}])[0]
    if data.get("b64_json"):
        return base64.b64decode(data["b64_json"])
    if data.get("url"):
        with urllib.request.urlopen(data["url"], timeout=120) as r:
            return r.read()
    raise RuntimeError("no image returned by OpenAI")


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--labels", type=Path, help="Path to BirdNET-Pi labels.txt (or any file of Sci|Com lines)")
    src.add_argument("--species", action="append", default=[],
                     help="Manual 'Sci|Com' (repeatable)")
    src.add_argument("--stdin", action="store_true", help="Read Sci|Com lines from stdin")
    ap.add_argument("--ebird-region", help="eBird region code (e.g. US-CA, US-CA-085) to filter labels")
    ap.add_argument("--ebird-key", help="eBird API key (or EBIRD_API_KEY env)")
    ap.add_argument("--provider", choices=["gemini", "openai"], default="gemini",
                    help="Image provider. Default: gemini")
    ap.add_argument("--gemini-key", help="Gemini API key (or GEMINI_API_KEY env)")
    ap.add_argument("--openai-key", help="OpenAI API key (or OPENAI_API_KEY env)")
    ap.add_argument("--openai-model", default="gpt-image-1",
                    help="OpenAI image model (default: gpt-image-1)")
    ap.add_argument("--style", choices=sorted(OPENAI_STYLES.keys()), default="watercolor",
                    help="OpenAI art style preset. Default: watercolor")
    ap.add_argument("--custom-style", default="",
                    help="Custom OpenAI style description used when --style custom")
    ap.add_argument("--out", type=Path, default=None,
                    help="Output directory (default: avian/assets/illustrations/ for Gemini, illustrations-openai-<style>/ for OpenAI)")
    ap.add_argument("--prompt", type=Path,
                    default=Path(__file__).resolve().parent / "prompt.template.md",
                    help="Prompt template path")
    ap.add_argument("--poses", nargs="+", type=int, default=[1, 2],
                    choices=list(POSES.keys()),
                    help="Which poses to render. 1=perched, 2=flight. Default: both.")
    ap.add_argument("--force", action="store_true", help="Re-render even if file exists")
    ap.add_argument("--sleep", type=float, default=6.0,
                    help="Seconds between API calls (default 6 = headroom under free-tier RPM cap)")
    ap.add_argument("--limit", type=int, default=0, help="Cap species count for testing")
    ap.add_argument("--progress", type=Path, help="Write structured JSON progress for the web UI")
    args = ap.parse_args()

    repo_assets = Path(__file__).resolve().parents[1] / "assets"
    if args.out is None:
        dirname = "illustrations" if args.provider == "gemini" else f"illustrations-openai-{args.style}"
        args.out = repo_assets / dirname

    gemini_key = args.gemini_key or os.environ.get("GEMINI_API_KEY", "")
    openai_key = args.openai_key or os.environ.get("OPENAI_API_KEY", "")
    if args.provider == "gemini" and not gemini_key:
        print("error: GEMINI_API_KEY required (--gemini-key or env)", file=sys.stderr)
        return 2
    if args.provider == "openai" and not openai_key:
        print("error: OPENAI_API_KEY required (--openai-key or env)", file=sys.stderr)
        return 2
    if args.provider == "openai" and args.style == "custom" and not args.custom_style.strip():
        print("error: --style custom requires --custom-style", file=sys.stderr)
        return 2

    # Build species list
    if args.labels:
        species, skipped = parse_species_list(args.labels.read_text().splitlines())
    elif args.stdin:
        species, skipped = parse_species_list(sys.stdin.read().splitlines())
    else:
        species, skipped = parse_species_list(args.species)
    if skipped:
        print(f"[parse] skipped {skipped} malformed line(s)", file=sys.stderr)
    if not species:
        print("error: no species resolved", file=sys.stderr)
        return 2

    if args.ebird_region:
        ek = args.ebird_key or os.environ.get("EBIRD_API_KEY", "")
        if not ek:
            print("error: --ebird-region requires --ebird-key or EBIRD_API_KEY", file=sys.stderr)
            return 2
        print(f"[ebird] filtering {len(species)} species against {args.ebird_region}...")
        species = ebird_filter(species, args.ebird_region, ek)

    if args.limit:
        species = species[:args.limit]

    prompt = load_prompt(args.prompt) if args.provider == "gemini" else ""
    args.out.mkdir(parents=True, exist_ok=True)

    total = len(species) * len(args.poses)
    style_note = f" · style {args.style}" if args.provider == "openai" else ""
    print(f"generating up to {total} illustrations via {args.provider}{style_note} into {args.out}/")
    write_progress(args.progress,
                   status="running",
                   provider=args.provider,
                   style=args.style if args.provider == "openai" else "gemini",
                   total=total,
                   current=0,
                   generated=0,
                   skipped=0,
                   failed=0,
                   message="starting")

    done = skipped_existing = failed = 0
    first_fail = None
    current = 0
    for idx, (sci, com) in enumerate(species):
        slug = slugify(sci)
        for pose in args.poses:
            current += 1
            fname = f"{slug}.png" if pose == 1 else f"{slug}-{pose}.png"
            path = args.out / fname
            write_progress(args.progress,
                           status="running",
                           provider=args.provider,
                           style=args.style if args.provider == "openai" else "gemini",
                           total=total,
                           current=current,
                           generated=done,
                           skipped=skipped_existing,
                           failed=failed,
                           sci=sci,
                           com=com,
                           pose=pose,
                           file=fname,
                           message="checking")
            if path.exists() and not args.force:
                skipped_existing += 1
                write_progress(args.progress,
                               status="running",
                               provider=args.provider,
                               style=args.style if args.provider == "openai" else "gemini",
                               total=total,
                               current=current,
                               generated=done,
                               skipped=skipped_existing,
                               failed=failed,
                               sci=sci,
                               com=com,
                               pose=pose,
                               file=fname,
                               message="already exists")
                continue
            try:
                if args.provider == "openai":
                    data = gen_one_openai(openai_key, args.openai_model, sci, com, pose, args.style, args.custom_style)
                else:
                    data = gen_one_gemini(gemini_key, prompt, sci, com, pose)
                path.write_bytes(data)
                done += 1
                print(f"  [ok]   {fname} ({len(data)//1024} KB)")
                write_progress(args.progress,
                               status="running",
                               provider=args.provider,
                               style=args.style if args.provider == "openai" else "gemini",
                               total=total,
                               current=current,
                               generated=done,
                               skipped=skipped_existing,
                               failed=failed,
                               sci=sci,
                               com=com,
                               pose=pose,
                               file=fname,
                               message="generated")
            except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError) as e:
                failed += 1
                first_fail = first_fail or fname
                print(f"  [fail] {fname}: {e}", file=sys.stderr)
                write_progress(args.progress,
                               status="running",
                               provider=args.provider,
                               style=args.style if args.provider == "openai" else "gemini",
                               total=total,
                               current=current,
                               generated=done,
                               skipped=skipped_existing,
                               failed=failed,
                               sci=sci,
                               com=com,
                               pose=pose,
                               file=fname,
                               message=f"failed: {e}")
            # Don't sleep after the last species' last pose.
            if not (idx == len(species) - 1 and pose == args.poses[-1]):
                time.sleep(args.sleep)

    print(f"\ngenerated {done} · skipped {skipped_existing} · failed {failed}")
    if first_fail:
        print(f"first failure: {first_fail} (re-run without --force to retry only the misses)", file=sys.stderr)
    write_progress(args.progress,
                   status="error" if failed else "done",
                   provider=args.provider,
                   style=args.style if args.provider == "openai" else "gemini",
                   total=total,
                   current=total,
                   generated=done,
                   skipped=skipped_existing,
                   failed=failed,
                   message=("completed with errors" if failed else "completed"),
                   first_fail=first_fail or "")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
