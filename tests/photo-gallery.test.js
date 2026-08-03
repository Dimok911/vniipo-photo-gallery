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
  assert.equal(runtime.version, "2.0.1");
  assert.equal(runtime.contractVersion, 2);
  assert.equal(typeof runtime.bindInlineGalleries, "function");
  assert.equal(typeof runtime.createFullscreenSwitcher, "function");
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

test("dot target stays active throughout smooth navigation", () => {
  const { resolveNavigationIndex } = runtime.helpers;
  assert.deepEqual(
    JSON.parse(JSON.stringify(resolveNavigationIndex(2, 0, false))),
    { activeIndex: 2, pendingIndex: 2 },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(resolveNavigationIndex(2, 1, false))),
    { activeIndex: 2, pendingIndex: 2 },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(resolveNavigationIndex(2, 2, true))),
    { activeIndex: 2, pendingIndex: null },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(resolveNavigationIndex(null, 1, false))),
    { activeIndex: 1, pendingIndex: null },
  );
});

test("2.0.1 exposes bounded inertia and contains thumbnail images", () => {
  const next = runtime.helpers.stepInertia({
    x: 10,
    y: -5,
    velocityX: 1,
    velocityY: -0.5,
    elapsedMs: 16,
  });
  assert.equal(next.x, 26);
  assert.equal(next.y, -13);
  assert.ok(next.velocityX > 0 && next.velocityX < 1);
  assert.ok(next.velocityY < 0 && next.velocityY > -0.5);
  assert.match(source, /object-fit:contain/);
  assert.match(source, /overscroll-behavior-x:none/);
});

test("2.0.1 settles moved and cancelled touch gestures on a real slide", () => {
  assert.match(source, /if \(gesture\.moved\) \{[\s\S]{0,160}scrollToIndex\(resolveActiveIndex\(track, slides\)\)/);
  assert.match(source, /listen\(track, "touchcancel"[\s\S]{0,180}scrollToIndex\(resolveActiveIndex\(track, slides\)\)/);
});

const classList = () => {
  const values = new Set();
  return {
    values,
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    toggle: (name, force) => {
      if (force) values.add(name);
      else values.delete(name);
    },
  };
};

const slide = (offsetLeft) => ({
  offsetLeft,
  classList: classList(),
  attributes: new Map(),
  setAttribute(name, value) { this.attributes.set(name, value); },
  removeAttribute(name) { this.attributes.delete(name); },
});

test("fullscreen switcher swaps desktop slides without scrolling the track", () => {
  const root = { classList: classList() };
  const slides = [slide(0), slide(400), slide(800)];
  const calls = [];
  const track = {
    clientWidth: 400,
    classList: classList(),
    scrollTo(value) { calls.push(value); },
  };
  const switcher = runtime.createFullscreenSwitcher({
    root,
    track,
    slides,
    initialIndex: 0,
    directDesktop: true,
  });
  switcher.goTo(2, "smooth");
  assert.equal(switcher.activeIndex, 2);
  assert.equal(calls.length, 0);
  assert.equal(slides[2].classList.values.has("vpg-fullscreen-active"), true);
  assert.equal(slides[0].attributes.get("aria-hidden"), "true");
});

test("fullscreen switcher retains native mobile scrolling", () => {
  const slides = [slide(0), slide(360)];
  const calls = [];
  const switcher = runtime.createFullscreenSwitcher({
    root: { classList: classList() },
    track: { classList: classList(), scrollTo(value) { calls.push(value); } },
    slides,
    directDesktop: false,
  });
  switcher.goTo(1, "smooth");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ left: 360, behavior: "smooth" }]);
});
