import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/photo-gallery.js", import.meta.url), "utf8");
const context = vm.createContext({
  console,
  globalThis: {},
  setTimeout,
  clearTimeout,
});
vm.runInContext(source, context);
const runtime = context.globalThis.VniipoPhotoGallery;

test("publishes a stable contract and reusable API", () => {
  assert.equal(runtime.version, "1.0.0");
  assert.equal(runtime.contractVersion, 1);
  assert.equal(typeof runtime.bindInlineGalleries, "function");
  assert.equal(typeof runtime.destroyInlineGalleries, "function");
});

test("gesture helper distinguishes tap, horizontal swipe, and vertical page scroll", () => {
  const { resolveSwipe } = runtime.helpers;
  assert.equal(resolveSwipe(10, 10, 12, 13, 28).tap, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(resolveSwipe(100, 20, 40, 25, 28))),
    { dx: -60, dy: 5, moved: true, horizontal: true, vertical: false, direction: 1, tap: false },
  );
  const vertical = resolveSwipe(100, 20, 95, 100, 28);
  assert.equal(vertical.vertical, true);
  assert.equal(vertical.horizontal, false);
  assert.equal(vertical.tap, false);
});

test("runtime keeps wheel passive and prevents only the true touch tap", () => {
  assert.match(source, /"wheel", cancelPendingScroll, \{ passive: true \}/);
  assert.doesNotMatch(source, /wheel[\s\S]{0,180}preventDefault/);
  assert.match(source, /if \(gesture\.tap && ended\.slideIndex >= 0\)[\s\S]{0,180}event\.preventDefault\(\)/);
  assert.match(source, /suppressClickUntil = Date\.now\(\) \+ 600/);
});

test("shared dots use the Bikepacking 22px strip and 8px marker", () => {
  assert.match(source, /height:calc\(100% - 22px\)/);
  assert.match(source, /min-height:22px/);
  assert.match(source, /width:8px;height:8px/);
  assert.match(source, /aria-current/);
});
