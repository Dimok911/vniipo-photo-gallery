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
  assert.equal(runtime.version, "2.1.2");
  assert.equal(runtime.contractVersion, 2);
  assert.equal(runtime.capabilities.fullscreenSourceLifecycle, 1);
  assert.equal(runtime.capabilities.safeFullscreenImageReplace, 1);
  assert.equal(runtime.capabilities.fullscreenControlStyles, 1);
  assert.equal(typeof runtime.bindInlineGalleries, "function");
  assert.equal(typeof runtime.createFullscreenSourceController, "function");
  assert.equal(typeof runtime.createFullscreenSwitcher, "function");
  assert.equal(typeof runtime.decodeFullscreenImage, "function");
  assert.equal(typeof runtime.destroyInlineGalleries, "function");
  assert.equal(typeof runtime.fullscreenImageUsesSource, "function");
  assert.equal(typeof runtime.loadAndDecodeFullscreenImage, "function");
  assert.equal(typeof runtime.replaceFullscreenImageSource, "function");
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

test("fullscreen close and navigation controls share one application-neutral visual contract", () => {
  assert.match(source, /\.vpg-fullscreen-control,\.vpg-fullscreen-close,\.vpg-fullscreen-nav\{/);
  assert.match(source, /background:rgba\(40,44,52,\.82\)/);
  assert.match(source, /border:1px solid rgba\(255,255,255,\.5\)/);
  assert.match(source, /color:#fff/);
  assert.match(source, /-webkit-backdrop-filter:blur\(8px\);backdrop-filter:blur\(8px\)/);
  assert.match(source, /\.vpg-fullscreen-nav:hover/);
  assert.match(source, /\.vpg-fullscreen-close:active/);
  assert.match(source, /\.vpg-fullscreen-control:focus-visible/);
  assert.doesNotMatch(source, /\.vpg-fullscreen-control[^}]*position:/);
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

test("safe fullscreen replacement commits only a decoded matching source after paint", async () => {
  const calls = [];
  const currentImage = {
    isConnected: true,
    replaceWith(replacement) {
      calls.push("replace");
      this.isConnected = false;
      replacement.isConnected = true;
    },
  };
  const replacement = {
    src: "",
    currentSrc: "",
    complete: true,
    naturalWidth: 2400,
    isConnected: false,
    removeAttribute() {},
    async decode() { calls.push("visible-decode"); },
  };
  const result = await runtime.replaceFullscreenImageSource(currentImage, "blob:full", {
    createReplacement: () => replacement,
    async loadAndDecode(image, src) {
      image.src = src;
      image.currentSrc = src;
      calls.push("candidate-decode");
    },
    async afterPaint() { calls.push("two-frames"); },
    shouldCommit({ phase }) {
      calls.push(`check:${phase}`);
      return true;
    },
    onReplaced() { calls.push("committed"); },
  });
  assert.equal(result, replacement);
  assert.deepEqual(calls, [
    "candidate-decode",
    "check:before-replace",
    "replace",
    "committed",
    "two-frames",
    "check:after-paint",
    "visible-decode",
  ]);
  assert.equal(runtime.fullscreenImageUsesSource(replacement, "blob:full"), true);
});

test("safe fullscreen replacement rolls the exact image back after a post-paint failure", async () => {
  const calls = [];
  const currentImage = {
    isConnected: true,
    replaceWith(replacement) {
      this.isConnected = false;
      replacement.isConnected = true;
    },
  };
  const replacement = {
    src: "",
    currentSrc: "",
    complete: true,
    naturalWidth: 2400,
    isConnected: false,
    removeAttribute() {},
    replaceWith(restored) {
      calls.push("rollback");
      this.isConnected = false;
      restored.isConnected = true;
    },
    async decode() {},
  };
  await assert.rejects(runtime.replaceFullscreenImageSource(currentImage, "blob:full", {
    createReplacement: () => replacement,
    async loadAndDecode(image, src) {
      image.src = src;
      image.currentSrc = src;
    },
    async afterPaint() { replacement.currentSrc = "blob:wrong"; },
    onRollback() { calls.push("notified"); },
  }), /source-not-visible/);
  assert.deepEqual(calls, ["rollback", "notified"]);
  assert.equal(currentImage.isConnected, true);
  assert.equal(replacement.isConnected, false);
});

test("safe fullscreen replacement honors abort before touching the visible image", async () => {
  const controller = new AbortController();
  controller.abort();
  let replaced = false;
  await assert.rejects(runtime.replaceFullscreenImageSource({
    replaceWith() { replaced = true; },
  }, "blob:full", {
    signal: controller.signal,
    createReplacement: () => ({ removeAttribute() {} }),
  }), { name: "AbortError" });
  assert.equal(replaced, false);
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("fullscreen source controller starts selected photo from verified full and leaves others on preview", () => {
  const entries = [0, 1, 2].map((index) => ({
    previewSrc: `preview:${index}`,
    verifiedFullSrc: `full:${index}`,
  }));
  const controller = runtime.createFullscreenSourceController({ entries, initialIndex: 1 });
  assert.equal(controller.initialSource(0), "preview:0");
  assert.equal(controller.initialSource(1), "full:1");
  assert.equal(controller.initialSource(2), "preview:2");
  controller.destroy();
});

test("fullscreen source controller decodes active first and prefetches neighbors only after success", async () => {
  const calls = [];
  const entries = [0, 1, 2].map((index) => ({ index, previewSrc: `preview:${index}` }));
  const controller = runtime.createFullscreenSourceController({
    entries,
    initialIndex: 1,
    resolveFullSource(entry, index, { prefetch }) {
      calls.push(`resolve:${index}:${prefetch}`);
      return `full:${index}`;
    },
    async decodeSource({ index, prefetch }) {
      calls.push(`decode:${index}:${prefetch}`);
      return true;
    },
    commitSource({ index, src }) {
      calls.push(`commit:${index}:${src}`);
    },
  });

  const result = await controller.activate(1);
  await tick();
  assert.equal(result.success, true);
  assert.deepEqual(calls.slice(0, 3), [
    "resolve:1:false",
    "decode:1:false",
    "commit:1:full:1",
  ]);
  assert.ok(calls.indexOf("resolve:0:true") > calls.indexOf("decode:1:false"));
  assert.ok(calls.indexOf("resolve:2:true") > calls.indexOf("decode:1:false"));
  controller.destroy();
});

test("fullscreen source controller does not prefetch after a failed active decode", async () => {
  const resolved = [];
  const controller = runtime.createFullscreenSourceController({
    entries: [{}, {}, {}],
    initialIndex: 1,
    resolveFullSource(_entry, index) {
      resolved.push(index);
      return `full:${index}`;
    },
    decodeSource() { return false; },
  });
  const result = await controller.activate(1);
  await tick();
  assert.equal(result.success, false);
  assert.deepEqual(resolved, [1]);
  controller.destroy();
});

test("fullscreen source controller awaits visual commit and skips neighbors when commit fails", async () => {
  const calls = [];
  const controller = runtime.createFullscreenSourceController({
    entries: [{}, {}, {}],
    initialIndex: 1,
    resolveFullSource(_entry, index) {
      calls.push(`resolve:${index}`);
      return `full:${index}`;
    },
    decodeSource({ index }) {
      calls.push(`decode:${index}`);
      return true;
    },
    async commitSource({ index }) {
      calls.push(`commit:start:${index}`);
      await tick();
      calls.push(`commit:end:${index}`);
      return false;
    },
  });
  const result = await controller.activate(1);
  await tick();
  assert.equal(result.success, false);
  assert.deepEqual(calls, [
    "resolve:1",
    "decode:1",
    "commit:start:1",
    "commit:end:1",
  ]);
  controller.destroy();
});

test("fullscreen source controller deduplicates repeated resolve and decode", async () => {
  let resolves = 0;
  let decodes = 0;
  let commits = 0;
  const controller = runtime.createFullscreenSourceController({
    entries: [{}],
    resolveFullSource() {
      resolves += 1;
      return "full:0";
    },
    async decodeSource() {
      decodes += 1;
      await tick();
      return true;
    },
    commitSource() { commits += 1; },
  });
  const results = await Promise.all([controller.activate(0), controller.activate(0)]);
  assert.equal(resolves, 1);
  assert.equal(decodes, 1);
  assert.equal(commits, 1);
  assert.equal(results.filter((result) => result.success).length, 1);
  controller.destroy();
});

test("fullscreen source controller aborts obsolete work and disposes resolved sources once", async () => {
  let resolveFull;
  let signal;
  let disposals = 0;
  const pending = new Promise((resolve) => { resolveFull = resolve; });
  const controller = runtime.createFullscreenSourceController({
    entries: [{}],
    resolveFullSource(_entry, _index, context) {
      signal = context.signal;
      return pending;
    },
    decodeSource() { return true; },
  });
  const activation = controller.activate(0);
  await tick();
  controller.cancel(0);
  assert.equal(signal.aborted, true);
  resolveFull({ src: "blob:full", dispose() { disposals += 1; } });
  const result = await activation;
  assert.equal(result.success, false);
  assert.equal(disposals, 1);
  controller.destroy();
  assert.equal(disposals, 1);
});

test("fullscreen source controller releases retained disposable sources on destroy", async () => {
  let disposals = 0;
  const controller = runtime.createFullscreenSourceController({
    entries: [{}],
    resolveFullSource() {
      return { src: "blob:retained", dispose() { disposals += 1; } };
    },
    decodeSource() { return true; },
  });
  assert.equal((await controller.activate(0)).success, true);
  controller.destroy();
  controller.destroy();
  assert.equal(disposals, 1);
});
