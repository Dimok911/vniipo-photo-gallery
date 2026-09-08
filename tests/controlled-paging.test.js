import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const context = vm.createContext({ globalThis: {}, setTimeout, clearTimeout });
vm.runInContext(await readFile(new URL('../src/photo-gallery.js', import.meta.url), 'utf8'), context);
const runtime = context.globalThis.VniipoPhotoGallery;
const classes = () => {
  const names = new Set();
  return { add: (...v) => v.forEach(x => names.add(x)), remove: (...v) => v.forEach(x => names.delete(x)),
    contains: x => names.has(x), toggle: (x, yes) => yes ? names.add(x) : names.delete(x) };
};
function fixture(options = {}) {
  let time = 0, id = 0;
  const frames = new Map(), listeners = new Map(), positions = [], settled = [], starts = [];
  const slides = [0, 360, 720].map(offsetLeft => ({ offsetLeft, offsetWidth: 360,
    classList: classes(), removeAttribute() {},
    firstElementChild: { classList: classes(), style: { translate: '', removeProperty(name) { this[name] = ''; } } },
  }));
  const track = { clientWidth: 360, scrollWidth: 1080, scrollLeft: 0, classList: classes(),
    scrollTo() { assert.fail('Controlled paging must never invoke native scrollTo'); },
    addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); } };
  const switcher = runtime.createFullscreenSwitcher({
    root: { classList: classes() }, track, slides, directDesktop: false, touchPaging: 'controlled',
    now: () => time, requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
    onTouchPagingStart: event => starts.push(event), onTouchPagingPosition: event => positions.push(event),
    onTouchPagingSettle: event => settled.push(event), ...options,
  });
  const emit = (type, x = 200, extras = {}) => {
    const event = { touches: type === 'touchend' || type === 'touchcancel' ? [] : [{identifier: 1, clientX: x, clientY: 100}],
      cancelable: true, preventDefault() { this.defaultPrevented = true; }, ...extras };
    listeners.get(type)?.(event);
    return event;
  };
  const advance = ms => { time += ms; const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(time)); };
  return { switcher, track, slides, frames, listeners, positions, settled, starts, emit, advance };
}

test('controlled constructor has no callbacks and keeps native as default', () => {
  const f = fixture();
  assert.equal(runtime.capabilities.controlledTouchPaging, 1);
  assert.equal(f.switcher.touchPaging, 'controlled');
  assert.equal(f.positions.length + f.starts.length + f.settled.length, 0);
  const native = fixture({ touchPaging: 'native' });
  assert.equal(native.switcher.touchPaging, 'native');
  f.switcher.destroy(); native.switcher.destroy();
});

test('short fast flick advances exactly one frame; dots follow painted position', () => {
  const f = fixture();
  f.emit('touchstart'); f.advance(20); f.emit('touchmove', 176); f.emit('touchend');
  assert.equal(f.switcher.isSettling, true);
  assert.equal(f.switcher.activeIndex, 0);
  f.advance(60);
  assert.equal(f.switcher.activeIndex, Math.round(f.track.scrollLeft / 360));
  f.advance(300);
  assert.equal(f.track.scrollLeft, 360);
  assert.equal(f.switcher.activeIndex, 1);
  assert.equal(f.settled.length, 1);
  f.switcher.destroy();
});

test('released flick is interrupted by NEW two-finger touch before pinch handler', () => {
  let f, called = false;
  f = fixture({ onTouchPagingStart({index,event}) {
    if (event.touches.length !== 2) return;
    called = true;
    assert.equal(f.switcher.isSettling, false);
    f.switcher.goTo(index, 'instant');
  } });
  f.emit('touchstart'); f.advance(80); f.emit('touchmove', -10); f.emit('touchend');
  f.advance(30);
  const stale = [...f.frames.values()][0];
  f.emit('touchstart', 0, { touches: [{identifier: 2}, {identifier: 3}] });
  assert.equal(called, true);
  assert.equal(f.track.scrollLeft, 360);
  stale(); f.advance(500);
  assert.equal(f.track.scrollLeft, 360);
  assert.equal(f.frames.size, 0);
  assert.equal(f.switcher.isSettling, false);
  f.switcher.destroy();
});

test('new single touch freezes smooth goTo and can drag in reverse', () => {
  const f = fixture();
  f.switcher.goTo(2, 'smooth'); f.advance(70);
  const interrupted = f.switcher.position;
  f.emit('touchstart'); f.advance(10); f.emit('touchmove', 230);
  assert.equal(f.switcher.position, interrupted - 30);
  f.emit('touchend'); f.advance(300);
  assert.equal(f.switcher.isSettling, false);
  assert.ok(f.switcher.activeIndex <= 1);
  f.switcher.destroy();
});

test('edges are bounded and return resumes without jumping on repeated touch', () => {
  const f = fixture();
  f.emit('touchstart'); f.advance(20); f.emit('touchmove', 500);
  assert.equal(f.switcher.position, -44);
  assert.equal(f.track.scrollLeft, 0);
  assert.equal(f.slides[0].firstElementChild.style.translate, '44px 0px');
  f.emit('touchend'); f.advance(60);
  const position = f.switcher.position;
  f.emit('touchstart'); f.emit('touchmove', 200);
  assert.equal(f.switcher.position, position);
  f.advance(20); f.emit('touchmove', 180);
  assert.ok(f.switcher.position > position);
  f.emit('touchcancel');
  assert.equal(f.track.scrollLeft, 0);
  assert.equal(f.slides[0].firstElementChild.style.translate, '');
  f.switcher.goTo(2, 'instant');
  f.emit('touchstart'); f.advance(20); f.emit('touchmove', -1000); f.emit('touchend'); f.advance(300);
  assert.equal(f.track.scrollLeft, 720);
  f.switcher.destroy();
});

test('long drags cannot skip more than one slide or wrap', () => {
  const f = fixture();
  f.emit('touchstart'); f.advance(20); f.emit('touchmove', -2000); f.emit('touchend'); f.advance(300);
  assert.equal(f.switcher.activeIndex, 1);
  f.switcher.goTo(-10, 'instant'); assert.equal(f.switcher.activeIndex, 0);
  f.switcher.goTo(100, 'instant'); assert.equal(f.switcher.activeIndex, 2);
  f.switcher.destroy();
});

test('external control drag is adopted before goTo or a new touch without losing edge offsets', () => {
  const f = fixture();
  f.track.scrollLeft = 450;
  f.switcher.goTo(2, 'smooth');
  assert.equal(f.switcher.position, 450);
  f.advance(50);
  assert.ok(f.switcher.position > 450);
  f.track.scrollLeft = 150;
  f.emit('touchstart');
  assert.equal(f.starts.at(-1).position, 150);
  f.advance(20); f.emit('touchmove', 180);
  assert.equal(f.track.scrollLeft, 170);
  f.switcher.destroy();
});

test('zoom and vertical gestures do not page, and remaining pinch finger stays with app', () => {
  let allowed = false;
  const f = fixture({ canTouchPage: () => allowed });
  f.emit('touchstart'); f.emit('touchmove', -100); f.emit('touchend');
  assert.equal(f.track.scrollLeft, 0);
  allowed = true;
  f.emit('touchstart'); f.emit('touchmove', 200, { touches: [{identifier: 1, clientX: 200, clientY: 200}] });
  f.emit('touchmove', -100); assert.equal(f.track.scrollLeft, 0);
  f.emit('touchstart', 0, { touches: [{identifier:1},{identifier:2}] });
  f.emit('touchend', 0, { touches: [{identifier:1}] }); f.emit('touchmove', -100);
  assert.equal(f.track.scrollLeft, 0);
  const settles = f.settled.length;
  f.emit('touchcancel');
  assert.equal(f.settled.length, settles);
  f.switcher.destroy();
});

test('reduced motion settles synchronously; destroy and reentrant takeover prevent stale writes', () => {
  const reduced = fixture({ reducedMotion: true });
  reduced.switcher.goTo(1, 'smooth');
  assert.equal(reduced.track.scrollLeft, 360); assert.equal(reduced.frames.size, 0);
  reduced.switcher.destroy();
  const f = fixture();
  f.switcher.goTo(1); const stale = [...f.frames.values()][0];
  f.switcher.destroy(); stale(); f.advance(400);
  assert.equal(f.track.scrollLeft, 0); assert.equal(f.listeners.size, 0); assert.equal(f.frames.size, 0);
});
