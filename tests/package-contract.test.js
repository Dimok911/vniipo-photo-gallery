import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const [packageJson, manifest, source, dist] = await Promise.all([
  readFile(new URL("package.json", root), "utf8").then(JSON.parse),
  readFile(new URL("dist/manifest.json", root), "utf8").then(JSON.parse),
  readFile(new URL("src/photo-gallery.js", root)),
  readFile(new URL("dist/photo-gallery.js", root)),
]);

test("package, source, distribution, and manifest identify the same runtime", () => {
  const hash = createHash("sha256").update(dist).digest("hex");
  assert.equal(packageJson.version, "2.4.0");
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.contractVersion, 2);
  assert.equal(manifest.sha256, hash);
  assert.deepEqual(dist, Buffer.from(source.toString("utf8").replace(/\r\n/g, "\n")));
});
