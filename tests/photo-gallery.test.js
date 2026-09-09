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
  assert.equal(runtime.version, "2.3.1");
  assert.equal(runtime.contractVersion, 2);
  assert.equal(runtime.capabilities.fullscreenSourceLifecycle, 1);
  assert.equal(runtime.capabilities.safeFullscreenImageReplace, 1);
  assert.equal(runtime.capabilities.fullscreenControlStyles, 1);
  assert.equal(runtime.capabilities.fullscreenImagePresentation, 1);
  assert.equal(runtime.capabilities.fullscreenEdgeSettling, 2);
  assert.equal(runtime.capabilities.fullscreenEdgeRubberBand, 2);
  assert.equal(runtime.capabilities.readyFullscreenNavigation, 1);
  assert.equal(typeof runtime.bindInlineGalleries, "function");
  assert.equal(typeof runtime.createFullscreenSourceController, "function");
  assert.equal(typeof runtime.createFullscreenSwitcher, "function");
  assert.equal(typeof runtime.decodeFullscreenImage, "function");
  assert.equal(typeof runtime.destroyInlineGalleries, "function");
  assert.equal(typeof runtime.ensureFullscreenControlStyles, "function");
  assert.equal(typeof runtime.fullscreenImageUsesSource, "function");
  assert.equal(typeof runtime.loadAndDecodeFullscreenImage, "function");
  assert.equal(typeof runtime.replaceFullscreenImageSource, "function");
});

test("fullscreen presentation resolves a stable pre-paint size from known metadata", () => {
  const { resolveFullscreenImagePresentation } = runtime.helpers;
  assert.deepEqual(JSON.parse(JSON.stringify(resolveFullscreenImagePresentation({
    naturalWidth: 640,
    naturalHeight: 480,
    availableWidth: 1200,
    availableHeight: 900,
  }))), {
    known: true,
    preventUpscale: true,
    width: 640,
    height: 480,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(resolveFullscreenImagePresentation({
    naturalWidth: 4000,
    naturalHeight: 3000,
    availableWidth: 1200,
    availableHeight: 900,
  }))), {
    known: true,
    preventUpscale: false,
    width: 1200,
    height: 900,
  });
});

test("fullscreen presentation keeps application upscale policy additive", () => {
  const { resolveFullscreenImagePresentation } = runtime.helpers;
  assert.equal(resolveFullscreenImagePresentation({
    naturalWidth: 1600,
    naturalHeight: 900,
    availableWidth: 1920,
    availableHeight: 1080,
    preventUpscaleMaxPixels: 1_000_000,
  }).preventUpscale, false);
  assert.equal(resolveFullscreenImagePresentation({
    naturalWidth: 800,
    naturalHeight: 600,
    availableWidth: 1920,
    availableHeight: 1080,
    preventUpscaleMaxPixels: 1_000_000,
  }).preventUpscale, true);
  assert.equal(resolveFullscreenImagePresentation({
    naturalWidth: 0,
    naturalHeight: 0,
    availableWidth: 1920,
    availableHeight: 1080,
  }).known, false);
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
  assert.match(source, /background:rgba\(8,15,13,\.62\)/);
  assert.match(source, /border:1px solid rgba\(255,255,255,\.28\)/);
  assert.match(source, /border-radius:10px/);
  assert.match(source, /color:#fff/);
  assert.match(source, /-webkit-backdrop-filter:blur\(8px\);backdrop-filter:blur\(8px\)/);
  assert.match(source, /\.vpg-fullscreen-nav:hover/);
  assert.match(source, /\.vpg-fullscreen-close:active/);
  assert.match(source, /\.vpg-fullscreen-control:focus-visible/);
  assert.match(source, /outline:2px solid rgba\(255,255,255,\.9\);outline-offset:2px/);
  assert.doesNotMatch(source, /\.vpg-fullscreen-control[^}]*position:/);
});

test("fullscreen controls are injected once when a cached 2.0.1 base style already exists", () => {
  const styles = new Map([["vniipo-photo-gallery-v2-styles", { id: "vniipo-photo-gallery-v2-styles" }]]);
  const appended = [];
  const doc = {
    createElement: () => ({ id: "", textContent: "" }),
    getElementById: (id) => styles.get(id) || null,
    head: {
      appendChild(style) {
        appended.push(style);
        styles.set(style.id, style);
      },
    },
  };
  const root = { ownerDocument: doc, classList: classList() };
  const track = { ownerDocument: doc, classList: classList(), scrollTo() {} };

  runtime.createFullscreenSwitcher({ root, track, slides: [], directDesktop: true });
  runtime.createFullscreenSwitcher({ root, track, slides: [], directDesktop: true });

  assert.equal(appended.length, 1);
  assert.equal(appended[0].id, "vniipo-photo-gallery-v2-fullscreen-controls");
  assert.match(appended[0].textContent, /\.vpg-fullscreen-control/);
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
  assert.match(source, /listen\(track, "touchcancel"[\s\S]{0,500}if \(!gesture\.vertical\) scrollToIndex\(resolveActiveIndex\(track, slides\)\)/);
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
  style: {
    transform: "",
    removeProperty(name) {
      if (name === "transform") this.transform = "";
    },
  },
  attributes: new Map(),
  setAttribute(name, value) { this.attributes.set(name, value); },
  removeAttribute(name) { this.attributes.delete(name); },
  firstElementChild: {
    classList: classList(),
    style: { translate: "", transform: "scale(1)", removeProperty(name) { this[name] = ""; } },
  },
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

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function readySwitcher(directDesktop = true) {
  const slides = [slide(0), slide(360), slide(720)];
  const scrolls = [];
  const presented = [];
  const switcher = runtime.createFullscreenSwitcher({
    root: { classList: classList() }, slides,
    track: { classList: classList(), scrollTo(value) { scrolls.push(value); } },
    directDesktop, waitForReady: true,
    onPresented: ({ index }) => presented.push(index),
  });
  return { switcher, slides, scrolls, presented };
}

test("ready desktop navigation keeps one presented slide through load, resize, and commit", async () => {
  const { switcher, slides, presented } = readySwitcher();
  const gate = deferred();
  const activation = switcher.activate(1, () => gate.promise);
  assert.equal(switcher.activeIndex, 1);
  assert.equal(switcher.presentedIndex, 0);
  switcher.render(1, false);
  switcher.goTo(1, "auto", false);
  switcher.settle();
  assert.equal(slides[0].classList.values.has("vpg-fullscreen-active"), true);
  assert.equal(slides[1].attributes.get("aria-hidden"), "true");
  gate.resolve(true);
  assert.equal(await activation, true);
  assert.equal(switcher.presentedIndex, 1);
  assert.equal(slides[1].classList.values.has("vpg-fullscreen-active"), true);
  assert.deepEqual(presented, [1]);
});

test("ready navigation rejects skipped, failed, and same-index stale completions", async () => {
  const { switcher, presented } = readySwitcher();
  const first = deferred(), second = deferred();
  let signal;
  const stale = switcher.activate(1, (request) => { signal = request.signal; return first.promise; });
  const latest = switcher.activate(2, () => second.promise);
  assert.equal(signal.aborted, true);
  first.resolve(true);
  assert.equal(await stale, false);
  assert.equal(switcher.presentedIndex, 0);
  second.resolve(true);
  assert.equal(await latest, true);
  assert.equal(await switcher.activate(1, () => false), false);
  assert.equal(await switcher.activate(1, () => { throw Error("offline"); }), false);
  assert.equal(switcher.presentedIndex, 2);
  const retry = deferred();
  const oldRetry = switcher.activate(1, () => retry.promise);
  assert.equal(await switcher.activate(1, () => true), true);
  retry.resolve(true);
  assert.equal(await oldRetry, false);
  assert.deepEqual(presented, [2, 1]);
});

test("ready navigation cancels on a changed selection and on destroy", async () => {
  const { switcher, presented } = readySwitcher();
  const first = deferred();
  const activation = switcher.activate(1, () => first.promise);
  switcher.render(2);
  first.resolve(true);
  assert.equal(await activation, false);
  const last = deferred();
  let signal;
  const closing = switcher.activate(2, (request) => { signal = request.signal; return last.promise; });
  switcher.destroy();
  assert.equal(signal.aborted, true);
  last.resolve(true);
  assert.equal(await closing, false);
  assert.deepEqual(presented, []);
});

test("ready navigation never delays native mobile scrolling", async () => {
  const { switcher, scrolls } = readySwitcher(false);
  const gate = deferred();
  const activation = switcher.activate(1, () => gate.promise);
  assert.equal(switcher.presentedIndex, 1);
  assert.equal(scrolls[0].left, 360);
  assert.equal(scrolls[0].behavior, "smooth");
  gate.resolve(true);
  assert.equal(await activation, true);
  assert.equal(scrolls.length, 1);
});

test("ready navigation lets adapters own native scrolling without a duplicate snap", async () => {
  const { switcher, scrolls } = readySwitcher(false);
  assert.equal(await switcher.activate(1, () => true, { scroll: false, notify: false }), true);
  assert.equal(switcher.presentedIndex, 1);
  assert.equal(scrolls.length, 0);
  switcher.goTo(1, "smooth", false);
  assert.equal(scrolls.length, 1);
});

test("fullscreen switcher rubber-bands only an outward edge drag and leaves normal swipes native", () => {
  const slides = [slide(0), slide(360)];
  const calls = [];
  const listeners = new Map();
  const timers = [];
  const track = {
    clientWidth: 360,
    scrollLeft: 0,
    offsetWidth: 360,
    classList: classList(),
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    scrollTo(value) {
      calls.push({ ...value });
      this.scrollLeft = value.left;
    },
  };
  const switcher = runtime.createFullscreenSwitcher({
    root: { classList: classList() },
    track,
    slides,
    directDesktop: false,
    setTimeout(callback) { timers.push(callback); return timers.length; },
    clearTimeout() {},
  });

  listeners.get("touchstart")({ touches: [{ clientX: 100, clientY: 40 }] });
  let normalPrevented = false;
  listeners.get("touchmove")({
    touches: [{ clientX: 20, clientY: 42 }],
    preventDefault() { normalPrevented = true; },
  });
  listeners.get("touchend")({ preventDefault() { normalPrevented = true; } });
  assert.equal(normalPrevented, false);
  assert.equal(slides[0].style.transform, "");
  assert.deepEqual(calls, []);

  listeners.get("touchstart")({ touches: [{ clientX: 100, clientY: 40 }] });
  let edgePrevented = false;
  listeners.get("touchmove")({
    touches: [{ clientX: 200, clientY: 42 }],
    preventDefault() { edgePrevented = true; },
  });
  assert.equal(edgePrevented, true);
  assert.equal(slides[0].style.transform, "");
  assert.equal(slides[0].firstElementChild.style.translate, "24px 0px");
  assert.equal(slides[0].firstElementChild.classList.values.has("vpg-edge-content-dragging"), true);
  listeners.get("touchend")({ preventDefault() { edgePrevented = true; } });
  assert.equal(slides[0].firstElementChild.style.translate, "0px 0px");
  assert.equal(slides[0].firstElementChild.classList.values.has("vpg-edge-content-returning"), true);
  assert.deepEqual(calls, []);

  timers.splice(0).forEach((callback) => callback());
  assert.equal(track.scrollLeft, 0);
  assert.equal(slides[0].style.transform, "");
  assert.equal(slides[0].firstElementChild.style.translate, "");
  assert.equal(slides[0].firstElementChild.classList.values.has("vpg-edge-content-returning"), false);

  switcher.destroy();
  assert.equal(listeners.has("touchstart"), false);
  assert.equal(listeners.has("touchmove"), false);
  assert.equal(listeners.has("touchend"), false);
  assert.equal(listeners.has("touchcancel"), false);
});

test("inline and fullscreen galleries share the same edge rubber-band controller", () => {
  assert.equal((source.match(/createEdgeRubberBandController\(\{/g) || []).length, 2);
  assert.match(source, /function bindGallery\(gallery, options\)[\s\S]*edgeRubberBand = createEdgeRubberBandController\(\{[\s\S]*getSlides: \(\) => slides/);
  assert.doesNotMatch(source, /\[180, 420\]/);
});

function edgeFixture(options = {}) {
  const slides = [slide(0), slide(360), slide(720)];
  const listeners = new Map(), timers = new Map(), scrolls = [];
  let timerId = 0, writes = 0, left = options.left ?? 720;
  const track = {
    clientWidth: 360, scrollWidth: 1080, classList: classList(),
    get scrollLeft() { return left; },
    set scrollLeft(value) { writes++; left = value; },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    scrollTo(value) { scrolls.push(value); },
  };
  const switcher = runtime.createFullscreenSwitcher({
    root: { classList: classList() }, track, slides, directDesktop: false,
    initialIndex: options.initialIndex ?? 0, // deliberately behind measured native position
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    ...options,
  });
  function emit(type, x = 100, y = 40, extras = {}) {
    const event = {
      touches: type === "touchend" || type === "touchcancel" ? [] : [{ clientX: x, clientY: y, identifier: 4 }],
      cancelable: true, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...extras,
    };
    listeners.get(type)?.(event);
    return event;
  }
  return { switcher, slides, track, emit, listeners, timers, scrolls, writes: () => writes };
}

test("last edge uses measured position, preserves snap bounds and never wraps or writes scrollLeft", () => {
  const f = edgeFixture();
  f.emit("touchstart");
  assert.equal(f.emit("touchmove", -400).defaultPrevented, true);
  assert.equal(f.slides[2].firstElementChild.style.translate, "-44px 0px");
  assert.equal(f.slides[2].style.transform, "");
  assert.equal(f.slides[2].firstElementChild.style.transform, "scale(1)");
  assert.equal(f.emit("touchmove", 150).defaultPrevented, true);
  assert.equal(f.slides[2].firstElementChild.style.translate, "0px 0px");
  f.emit("touchend");
  for (const fn of f.timers.values()) fn();
  assert.equal(f.track.scrollLeft, 720);
  assert.equal(f.writes(), 0);
  assert.deepEqual(f.scrolls, []);
  assert.equal(f.slides[2].firstElementChild.style.translate, "");
  f.switcher.destroy();
});

test("first edge, fractional alignment, and a single slide remain bounded", () => {
  const f = edgeFixture({ left: 0.5 });
  f.emit("touchstart");
  f.emit("touchmove", 500);
  assert.equal(f.slides[0].firstElementChild.style.translate, "44px 0px");
  f.emit("touchcancel");
  assert.equal(f.slides[0].firstElementChild.style.translate, "");
  assert.equal(f.timers.size, 0);
  const one = edgeFixture({ left: 0, slides: [f.slides[0]] });
  one.emit("touchstart");
  one.emit("touchmove", -300);
  assert.equal(f.slides[0].firstElementChild.style.translate, "-44px 0px");
  one.switcher.destroy();
  f.switcher.destroy();
});

test("edge controller yields permanently to inward, vertical, native and multi-touch gestures", () => {
  for (const first of [
    { x: 170, y: 40 }, { x: 100, y: 90 },
    { x: 30, y: 40, cancelable: false },
    { x: 30, y: 40, defaultPrevented: true },
    { x: 30, y: 40, touches: [{ identifier: 4 }, { identifier: 5 }] },
    { x: 30, y: 40, touches: [{ identifier: 99, clientX: 30, clientY: 40 }] },
  ]) {
    const f = edgeFixture();
    f.emit("touchstart");
    f.emit("touchmove", first.x, first.y, first);
    assert.equal(f.emit("touchmove", -100).defaultPrevented, false);
    f.emit("touchend");
    assert.equal(f.slides[2].firstElementChild.style.translate, "");
    assert.equal(f.writes(), 0);
    assert.equal(f.timers.size, 0);
    f.switcher.destroy();
  }
});

test("native bounce and mid-track positions are never recaptured", () => {
  for (const left of [745, -20, 340, 705]) {
    const f = edgeFixture({ left });
    f.emit("touchstart");
    f.emit("touchmove", left < 0 ? 300 : -100);
    assert.ok(f.slides.every((slide) => !slide.firstElementChild.style.translate));
    assert.equal(f.writes(), 0);
    f.switcher.destroy();
  }
});

test("zoom eligibility changes and pinch cancel captured edges without delayed work", () => {
  let allowed = false;
  const f = edgeFixture({ canRubberBand: () => allowed });
  f.emit("touchstart");
  f.emit("touchmove", 20);
  assert.equal(f.slides[2].firstElementChild.style.translate, "");
  allowed = true;
  f.emit("touchstart");
  f.emit("touchmove", 20);
  allowed = false;
  f.emit("touchmove", 0);
  assert.equal(f.slides[2].firstElementChild.style.translate, "");
  f.emit("touchend");
  assert.equal(f.timers.size, 0);
  f.switcher.destroy();
  assert.equal(f.listeners.size, 0);
});

test("touch during return resumes the painted offset and stale cleanup cannot reset it", () => {
  const f = edgeFixture({
    getComputedStyle(content) {
      return { translate: content.classList.values.has("vpg-edge-content-returning") ? "-12px 0px" : content.style.translate || "none" };
    },
  });
  f.emit("touchstart");
  f.emit("touchmove", 0);
  f.emit("touchend");
  const stale = [...f.timers.values()][0];
  f.emit("touchstart");
  assert.equal(f.slides[2].firstElementChild.style.translate, "-12px 0px");
  f.emit("touchmove", 75);
  assert.equal(f.slides[2].firstElementChild.style.translate, "-18px 0px");
  stale();
  assert.equal(f.slides[2].firstElementChild.style.translate, "-18px 0px");
  assert.equal(f.timers.size, 0);
  f.emit("touchcancel");
  assert.equal(f.slides[2].firstElementChild.style.translate, "");
  f.switcher.destroy();
});

test("slow original loading cannot pull a native swipe back to the requested index", async () => {
  const f = edgeFixture({ waitForReady: true });
  const gate = deferred();
  const pending = f.switcher.activate(0, () => gate.promise, { scroll: false });
  f.emit("touchstart");
  f.emit("touchmove", 0);
  f.emit("touchend");
  gate.resolve(true);
  await pending;
  for (const fn of f.timers.values()) fn();
  assert.equal(f.track.scrollLeft, 720);
  assert.equal(f.writes(), 0);
  assert.deepEqual(f.scrolls, []);
  f.switcher.destroy();
});

test("slide positions use track coordinates even with a shared external offset parent", () => {
  const parent = {};
  const track = { offsetParent: parent, offsetLeft: 120, clientLeft: 2, clientWidth: 360, scrollWidth: 1080, scrollLeft: 720 };
  const slides = [122, 482, 842].map((offsetLeft) => ({ offsetLeft, offsetParent: parent, offsetWidth: 360 }));
  assert.equal(runtime.helpers.resolveSlideLeft(track, slides[2], 2), 720);
  assert.equal(runtime.helpers.resolveActiveIndex(track, slides), 2);
  track.scrollLeft = -60;
  assert.equal(runtime.helpers.resolveActiveIndex(track, slides), 0);
  track.scrollLeft = 1000;
  assert.equal(runtime.helpers.resolveActiveIndex(track, slides), 2);
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
