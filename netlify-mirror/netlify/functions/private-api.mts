import type { Config } from "@netlify/functions";

export default async () => {
  return new Response(JSON.stringify({ error: "private on public mirror" }), {
    status: 404,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};

export const config: Config = {
  path: [
    "/avian/api/recording.php",
    "/avian/api/spectrogram.php",
    "/avian/api/config.php",
    "/avian/api/birdnet-status.php",
  ],
};
