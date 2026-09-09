import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const context = vm.createContext({ globalThis: {}, setTimeout, clearTimeout });
vm.runInContext(await readFile(new URL('../../src/photo-gallery.js', import.meta.url), 'utf8'), context);
const runtime = context.globalThis.VniipoPhotoGallery;
const classes = () => {
  const names = new Set();
  return { add: (...v) => v.forEach(x => names.add(x)), remove: (...v) => v.forEach(x => names.delete(x)),
    contains: x => names.has(x), toggle: (x, yes) => yes ? names.add(x) : names.delete(x) };
};
export function fixture(options = {}) {
  let time = 0, id = 0;
  const frames = new Map(), listeners = new Map(), positions = [], settled = [], starts = [];
  const slides = [0, 360, 720].map(offsetLeft => ({ offsetLeft, offsetWidth: 360,
    classList: classes(), removeAttribute() {},
    firstElementChild: { classList: classes(), style: { translate: '', removeProperty(name) { this[name] = ''; } } },
  }));
  const track = { clientWidth: 360, scrollWidth: 1080, scrollLeft: 0, classList: classes(),
    scrollTo() { assert.fail('Controlled paging must never invoke native scrollTo'); },
    addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); } };
  const makeNode = () => ({
    childNodes: [], style: {setProperty(key,value){this[key]=value;},getPropertyValue(key){return this[key]||'';},getPropertyPriority(){return '';},removeProperty(key){delete this[key];}},
    insertBefore(node, before) {
      node.remove?.();
      const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
      this.childNodes.splice(index,0,node); node.parentNode=this;
    },
    appendChild(node) { this.insertBefore(node,null); },
    remove() { if(this.parentNode){const list=this.parentNode.childNodes;list.splice(list.indexOf(this),1);this.parentNode=null;} },
  });
  const doc = {createElement:makeNode,createComment:makeNode};
  Object.assign(track,makeNode(),{ownerDocument:doc});
  slides.forEach(slide=>{Object.assign(slide,{remove:makeNode().remove});track.appendChild(slide);});
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
  return { runtime, switcher, track, slides, frames, listeners, positions, settled, starts, emit, advance };
}
