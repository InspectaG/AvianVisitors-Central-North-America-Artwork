import type { Config } from "@netlify/functions";

export default async () => {
  return new Response(JSON.stringify({ items: [] }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
};

export const config: Config = {
  path: "/avian/api/menu.php",
};
