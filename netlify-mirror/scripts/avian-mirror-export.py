#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import os
import sqlite3
import sys
import urllib.request


DB_PATH = "/home/birdnet/BirdNET-Pi/scripts/birds.db"
DEFAULT_INGEST_URL = "https://YOUR_NETLIFY_SITE.netlify.app/api/mirror/ingest"
WINDOWS = (1, 12, 24, 168, 1000000)


def rows(con, sql, params=()):
    cur = con.execute(sql, params)
    return [dict(r) for r in cur.fetchall()]


def one(con, sql, params=()):
    rs = rows(con, sql, params)
    return rs[0] if rs else None


def snapshot(db_path):
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
        species[sci] = {
            "sci": sci,
            "summary": summary,
            "detections": [],
            "audio_private": True,
        }

    return {
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
        "species": species,
    }


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


def main():
    parser = argparse.ArgumentParser(description="Export BirdNET-Pi detections to the Avian Visitors public mirror.")
    parser.add_argument("--db", default=DB_PATH)
    parser.add_argument("--out")
    parser.add_argument("--post", action="store_true")
    parser.add_argument("--url", default=os.environ.get("AVIAN_MIRROR_INGEST_URL", DEFAULT_INGEST_URL))
    parser.add_argument("--token", default=os.environ.get("AVIAN_MIRROR_PUSH_TOKEN"))
    args = parser.parse_args()

    data = snapshot(args.db)
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
        post_snapshot(args.url, args.token, data)


if __name__ == "__main__":
    main()
