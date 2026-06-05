import { access, stat } from "node:fs/promises";

const required = [
  "public/index.html",
  "public/styles.css",
  "public/apt.js",
  "public/favicon.png",
  "public/data/seed-snapshot.json",
  "public/avian/assets/illustrations",
];

for (const path of required) {
  await access(path);
}

const assets = await stat("public/avian/assets/illustrations");
if (!assets.isDirectory()) {
  throw new Error("public/avian/assets/illustrations must be a directory");
}

console.log("Avian Visitors mirror build inputs verified");
