import type { Config } from "@netlify/functions";
import { getDeployStore, getStore } from "@netlify/blobs";

type Snapshot = Record<string, any>;

declare const Netlify: {
  context?: { deploy?: { context?: string } };
};

function store() {
  if (Netlify.context?.deploy?.context === "production") {
    return getStore({ name: "avianvisitors", consistency: "strong" });
  }
  return getDeployStore("avianvisitors");
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function seedSnapshot(req: Request): Promise<Snapshot | null> {
  const seedUrl = new URL("/data/seed-snapshot.json", req.url);
  const response = await fetch(seedUrl);
  if (!response.ok) return null;
  return response.json();
}

async function loadSnapshot(req: Request): Promise<Snapshot | null> {
  const saved = await store().get("snapshot", { type: "json" });
  return saved ?? seedSnapshot(req);
}

function recentFor(snapshot: Snapshot, hours: string) {
  const recent = snapshot.recent || {};
  if (recent[hours]) return recent[hours];
  if (recent[String(Number(hours))]) return recent[String(Number(hours))];
  return recent["24"] || { hours: Number(hours) || 24, species: [], as_of: snapshot.generated_at };
}

export default async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return json({ error: "method not allowed" }, 405);
  }

  const snapshot = await loadSnapshot(req);
  if (!snapshot) {
    return json({ error: "no mirror snapshot available" }, 503);
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "stats";

  if (action === "stats") return json(snapshot.stats || {});
  if (action === "lifelist") return json(snapshot.lifelist || { species: [], as_of: snapshot.generated_at });
  if (action === "timeseries") return json(snapshot.timeseries || { daily: [], by_hour: [], as_of: snapshot.generated_at });
  if (action === "firstseen") return json(snapshot.firstseen || { species: [], as_of: snapshot.generated_at });
  if (action === "recent") return json(recentFor(snapshot, url.searchParams.get("hours") || "24"));
  if (action === "species") {
    const sci = url.searchParams.get("sci") || "";
    const detail = snapshot.species?.[sci];
    if (detail) return json(detail);
    return json({ sci, summary: null, detections: [], audio_private: true });
  }

  return json({ error: "unknown action" }, 404);
};

export const config: Config = {
  path: "/avian/api/birdnet-api.php",
};
