#!/usr/bin/env python3
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import urllib.request


DB_PATH = "/home/birdnet/BirdNET-Pi/scripts/birds.db"
AUDIO_ROOT = "/home/birdnet/BirdSongs/Extracted/By_Date"
AUDIO_CACHE = "/tmp/avian-visitors-public-audio-cache.json"
DEFAULT_INGEST_URL = "https://YOUR_NETLIFY_SITE.netlify.app/api/mirror/ingest"
WINDOWS = (1, 12, 24, 168, 1000000)
MAX_AUDIO_BYTES = 1_500_000
AUDIO_FILE_RE = re.compile(r"^[A-Za-z0-9_.:'-]+\.mp3$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def rows(con, sql, params=()):
    cur = con.execute(sql, params)
    return [dict(r) for r in cur.fetchall()]


def one(con, sql, params=()):
    rs = rows(con, sql, params)
    return rs[0] if rs else None


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def sha256_file(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def find_audio_file(audio_root, det):
    file_name = (det or {}).get("file") or ""
    date = (det or {}).get("d") or ""
    if not AUDIO_FILE_RE.match(file_name):
        return None

    root = Path(audio_root)
    if not root.is_dir():
        return None

    def scan_day(day_dir):
        try:
            species_dirs = [p for p in day_dir.iterdir() if p.is_dir()]
        except OSError:
            return None
        for species_dir in species_dirs:
            candidate = species_dir / file_name
            if candidate.is_file():
                return candidate
        return None

    if DATE_RE.match(date):
        found = scan_day(root / date)
        if found:
            return found

    try:
        days = sorted((p for p in root.iterdir() if p.is_dir()), reverse=True)
    except OSError:
        return None
    for day_dir in days:
        found = scan_day(day_dir)
        if found:
            return found
    return None


def public_audio_for(sci, det, audio_root):
    path = find_audio_file(audio_root, det)
    if not path:
        return None
    size = path.stat().st_size
    if size < 64 or size > MAX_AUDIO_BYTES:
        return None
    digest = sha256_file(path)
    meta = {
        "key": f"public-audio/{slugify(sci)}/{digest[:24]}.mp3",
        "last_seen": f"{det.get('d')} {det.get('t')}",
        "confidence": det.get("conf"),
        "bytes": size,
        "content_type": "audio/mpeg",
    }
    return {"meta": meta, "path": str(path), "sha256": digest, "sci": sci}


def snapshot(db_path, audio_root=AUDIO_ROOT):
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    now = dt.datetime.now().astimezone().isoformat()

    total = one(con, "SELECT COUNT(*) AS n FROM detections")["n"]
    species_total = one(con, "SELECT COUNT(DISTINCT Sci_Name) AS n FROM detections")["n"]
    today = one(con, "SELECT COUNT(*) AS n FROM detections WHERE Date = DATE('now','localtime')")["n"]
    today_species = one(con, "SELECT COUNT(DISTINCT Sci_Name) AS n FROM detections WHERE Date = DATE('now','localtime')")["n"]
    last_hour = one(con, "SELECT COUNT(*) AS n FROM detections WHERE Date = DATE('now','localtime') AND Time >= TIME('now','localtime','-1 hour')")["n"]
    week = one(con, "SELECT COUNT(*) AS n FROM detections WHERE Date >= DATE('now','localtime','-7 day')")["n"]
    week_species = one(con, "SELECT COUNT(DISTINCT Sci_Name) AS n FROM detections WHERE Date >= DATE('now','localtime','-7 day')")["n"]
    started = one(con, "SELECT MIN(Date) AS d FROM detections")["d"]

    lifelist = rows(
        con,
        """
        SELECT Sci_Name AS sci, Com_Name AS com, MIN(Date||' '||Time) AS first_seen,
               MAX(Date||' '||Time) AS last_seen, COUNT(*) AS n, MAX(Confidence) AS best_conf
        FROM detections GROUP BY Sci_Name ORDER BY first_seen ASC
        """,
    )

    recent = {}
    for hours in WINDOWS:
        rs = rows(
            con,
            """
            SELECT Sci_Name AS sci, Com_Name AS com, COUNT(*) AS n, MAX(Confidence) AS best_conf,
                   MAX(Date||' '||Time) AS last_seen
            FROM detections
            WHERE (julianday('now','localtime') - julianday(Date||' '||Time)) * 24 <= ?
            GROUP BY Sci_Name ORDER BY last_seen DESC
            """,
            (hours,),
        )
        recent[str(hours)] = {"hours": hours, "species": rs, "as_of": now}

    daily = rows(
        con,
        """
        SELECT Date AS date, COUNT(*) AS detections, COUNT(DISTINCT Sci_Name) AS species
        FROM detections
        WHERE Date >= DATE('now','localtime','-29 day')
        GROUP BY Date ORDER BY Date
        """,
    )
    by_hour = rows(
        con,
        """
        SELECT CAST(strftime('%H', Time) AS INT) AS hour, COUNT(*) AS detections
        FROM detections
        WHERE Date >= DATE('now','localtime','-30 day')
        GROUP BY hour ORDER BY hour
        """,
    )

    firstseen = rows(
        con,
        """
        SELECT Sci_Name AS sci, Com_Name AS com, MIN(Date||' '||Time) AS first_seen,
               COUNT(*) AS total
        FROM detections GROUP BY Sci_Name ORDER BY first_seen DESC LIMIT 10
        """,
    )

    audio_by_sci = {}
    audio_uploads = {}
    for item in lifelist:
        latest = one(
            con,
            """
            SELECT Date AS d, Time AS t, File_Name AS file, Confidence AS conf
            FROM detections WHERE Sci_Name = ?
            ORDER BY Date DESC, Time DESC LIMIT 1
            """,
            (item["sci"],),
        )
        audio = public_audio_for(item["sci"], latest, audio_root)
        if audio:
            audio_by_sci[item["sci"]] = audio["meta"]
            audio_uploads[audio["meta"]["key"]] = audio
            item["public_audio"] = audio["meta"]

    for window in recent.values():
        for item in window.get("species", []):
            audio = audio_by_sci.get(item["sci"])
            if audio:
                item["public_audio"] = audio

    species = {}
    for item in lifelist:
        sci = item["sci"]
        summary = one(
            con,
            """
            SELECT Com_Name AS com, COUNT(*) AS total, MIN(Date||' '||Time) AS first_seen,
                   MAX(Date||' '||Time) AS last_seen, MAX(Confidence) AS best_conf
            FROM detections WHERE Sci_Name = ?
            """,
            (sci,),
        )
        time_rows = rows(
            con,
            """
            SELECT CAST(strftime('%H', Time) AS INT) AS hour, COUNT(*) AS n
            FROM detections WHERE Sci_Name = ? GROUP BY hour ORDER BY hour
            """,
            (sci,),
        )
        profile_total = sum(int(r.get("n") or 0) for r in time_rows)
        best = max(time_rows, key=lambda r: int(r.get("n") or 0), default=None)
        audio = audio_by_sci.get(sci)
        if audio and summary:
            summary["public_audio"] = audio
        species[sci] = {
            "sci": sci,
            "summary": summary,
            "public_audio": audio,
            "detections": [],
            "audio_private": True,
            "time_profile": {
                "total": profile_total,
                "best_hour": int(best["hour"]) if best else None,
                "hours": time_rows,
            },
        }

    data = {
        "schema": "avianvisitors.snapshot.v1",
        "generated_at": now,
        "stats": {
            "totals": {"detections": total, "species": species_total},
            "today": {"detections": today, "species": today_species},
            "last_hour": {"detections": last_hour},
            "week": {"detections": week, "species": week_species},
            "started": started,
            "as_of": now,
        },
        "lifelist": {"species": lifelist, "as_of": now},
        "recent": recent,
        "timeseries": {"days": 30, "daily": daily, "by_hour": by_hour, "as_of": now},
        "firstseen": {"species": firstseen, "as_of": now},
        "ebird_nearby": {"configured": False, "species": {}, "message": "eBird nearby reports are only available on the live Pi."},
        "species": species,
    }
    return data, audio_uploads


def post_snapshot(url, token, data):
    body = json.dumps(data, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "authorization": f"Bearer {token}",
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        sys.stdout.write(response.read().decode("utf-8") + "\n")


def audio_url_for(ingest_url):
    return ingest_url.rstrip("/").rsplit("/", 1)[0] + "/audio"


def load_audio_cache(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception:
        return {}


def save_audio_cache(path, cache):
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def post_audio(url, token, upload):
    with open(upload["path"], "rb") as f:
        body = f.read()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "authorization": f"Bearer {token}",
            "content-type": "audio/mpeg",
            "x-avian-audio-key": upload["meta"]["key"],
            "x-avian-sci": upload["sci"],
        },
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def post_audio_uploads(url, token, uploads, cache_path):
    if not uploads:
        return {"uploaded": 0, "skipped": 0}
    cache = load_audio_cache(cache_path)
    uploaded = 0
    skipped = 0
    for key, upload in uploads.items():
        if cache.get(key) == upload["sha256"]:
            skipped += 1
            continue
        post_audio(url, token, upload)
        cache[key] = upload["sha256"]
        uploaded += 1
        save_audio_cache(cache_path, cache)
    return {"uploaded": uploaded, "skipped": skipped}


def main():
    parser = argparse.ArgumentParser(description="Export BirdNET-Pi detections to the Avian Visitors public mirror.")
    parser.add_argument("--db", default=DB_PATH)
    parser.add_argument("--audio-root", default=os.environ.get("AVIAN_MIRROR_AUDIO_ROOT", AUDIO_ROOT))
    parser.add_argument("--audio-cache", default=os.environ.get("AVIAN_MIRROR_AUDIO_CACHE", AUDIO_CACHE))
    parser.add_argument("--out")
    parser.add_argument("--post", action="store_true")
    parser.add_argument("--url", default=os.environ.get("AVIAN_MIRROR_INGEST_URL", DEFAULT_INGEST_URL))
    parser.add_argument("--token", default=os.environ.get("AVIAN_MIRROR_PUSH_TOKEN"))
    args = parser.parse_args()

    data, audio_uploads = snapshot(args.db, args.audio_root)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
    else:
        json.dump(data, sys.stdout, indent=2)
        sys.stdout.write("\n")

    if args.post:
        if not args.token:
            raise SystemExit("AVIAN_MIRROR_PUSH_TOKEN is required for --post")
        audio_result = post_audio_uploads(audio_url_for(args.url), args.token, audio_uploads, args.audio_cache)
        sys.stdout.write(json.dumps({"audio": audio_result}, separators=(",", ":")) + "\n")
        post_snapshot(args.url, args.token, data)


if __name__ == "__main__":
    main()
