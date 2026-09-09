import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "src", "photo-gallery.js");
const distPath = path.join(root, "dist");
const assetPath = path.join(distPath, "photo-gallery.js");
const source = Buffer.from((await readFile(sourcePath, "utf8")).replace(/\r\n/g, "\n"));
const hash = createHash("sha256").update(source).digest("hex");

await mkdir(distPath, { recursive: true });
await writeFile(assetPath, source);
await writeFile(path.join(distPath, "manifest.json"), `${JSON.stringify({
  name: "vniipo-photo-gallery",
  version: "2.4.1",
  contractVersion: 2,
  channel: "stable",
  asset: "photo-gallery.js",
  immutableUrl: "/shared-ui/photo-gallery/v2.4.1/photo-gallery.js",
  stableUrl: "/shared-ui/photo-gallery/stable.js",
  sha256: hash,
  updateWindowMinutes: 60,
}, null, 2)}\n`);

console.log(`Built vniipo-photo-gallery 2.4.1 sha256=${hash}`);
