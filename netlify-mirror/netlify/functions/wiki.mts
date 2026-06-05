import type { Config } from "@netlify/functions";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const sci = (url.searchParams.get("sci") || "").trim();
  if (!sci) return json({ error: "sci required" }, 400);
  if (!/^[A-Za-z]{2,40}(?:[ ][a-z]{2,40}){1,3}$/.test(sci)) {
    return json({ error: "invalid sci" }, 400);
  }

  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(sci)}`;
  const response = await fetch(summaryUrl, {
    headers: { "user-agent": "AvianVisitorsMirror/1.0 (+https://YOUR_NETLIFY_SITE.netlify.app)" },
  });
  if (!response.ok) return json({ extract: null, thumbnail: null, title: null });

  const data = await response.json();
  let thumb = data?.thumbnail?.source || null;
  if (thumb) {
    const host = new URL(thumb).hostname;
    if (!/(^|\.)((wikimedia|wikipedia)\.org)$/i.test(host)) thumb = null;
  }

  return json({
    extract: data?.extract || null,
    thumbnail: thumb ? { source: thumb } : null,
    title: data?.title || null,
  });
};

export const config: Config = {
  path: "/avian/api/wiki.php",
};
