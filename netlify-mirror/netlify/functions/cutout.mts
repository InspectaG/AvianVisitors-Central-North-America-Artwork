import type { Config } from "@netlify/functions";

function slugify(sci: string) {
  return sci.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const sci = (url.searchParams.get("sci") || "").trim();
  if (!/^[A-Za-z]{2,40}(?:[ ][a-z]{2,40}){1,3}$/.test(sci)) {
    return new Response("invalid sci", { status: sci ? 400 : 404 });
  }

  const pose = Math.max(1, Math.min(99, Number(url.searchParams.get("pose") || "1") || 1));
  const suffix = pose === 1 ? "" : `-${pose}`;
  const location = `/avian/assets/illustrations/${slugify(sci)}${suffix}.png`;
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": "public, max-age=86400",
    },
  });
};

export const config: Config = {
  path: "/avian/api/cutout.php",
};
