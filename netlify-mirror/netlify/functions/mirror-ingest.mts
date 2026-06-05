import type { Config } from "@netlify/functions";
import { getDeployStore, getStore } from "@netlify/blobs";

declare const Netlify: {
  env?: { get(name: string): string | undefined };
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

function bearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.headers.get("x-avian-mirror-token") || "";
}

async function isAuthorized(req: Request) {
  const provided = bearerToken(req);
  const expected = Netlify.env?.get("AVIAN_MIRROR_PUSH_TOKEN");
  return Boolean(expected) && provided === expected;
}

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  if (!(await isAuthorized(req))) return json({ error: "unauthorized" }, 401);

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > 2_000_000) return json({ error: "snapshot too large" }, 413);

  let snapshot: Record<string, any>;
  try {
    snapshot = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  if (!snapshot || snapshot.schema !== "avianvisitors.snapshot.v1") {
    return json({ error: "invalid snapshot schema" }, 400);
  }
  if (!snapshot.stats || !snapshot.lifelist || !snapshot.recent) {
    return json({ error: "snapshot missing required data" }, 400);
  }

  snapshot.received_at = new Date().toISOString();
  await store().setJSON("snapshot", snapshot);

  return json({
    ok: true,
    generated_at: snapshot.generated_at,
    received_at: snapshot.received_at,
    species: snapshot.lifelist?.species?.length || 0,
  });
};

export const config: Config = {
  path: "/api/mirror/ingest",
};
