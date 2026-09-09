import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture as baseFixture } from './helpers/controlled-fixture.mjs';
const fixture = options => baseFixture({touchPagingPresentation:'transform', ...options});
const painted = f => -Number(f.track.childNodes[0].style.transform.match(/translate3d\(([-\d.e]+)px/)[1]) || 0;

test('fractional moves publish latest logical position and paint once for a burst per RAF', () => {
  const f=fixture();
  assert.equal(f.switcher.touchPagingPresentation,'transform');
  f.emit('touchstart');
  for(let i=0;i<12;i++) f.emit('touchmove',100-i*.2);
  assert.equal(f.switcher.position,102.2);
  assert.equal(painted(f),0);
  assert.equal(f.frames.size,1);
  assert.equal(f.positions.length,0);
  f.advance(16);
  assert.equal(painted(f),102.2);
  assert.equal(f.positions.length,1);
  assert.equal(f.track.scrollLeft,0);
  assert.equal(f.frames.size,0);
  f.switcher.destroy();
});

test('new pinch flushes pending fractional input before Start and rejects the old RAF', () => {
  let f;
  f=fixture({onTouchPagingStart({event,index,position}) {
    if(event.touches.length!==2)return;
    assert.equal(position,220.2); assert.equal(index,1);
    assert.equal(painted(f),220.2); assert.equal(f.frames.size,0);
    f.switcher.goTo(index,'instant');
  }});
  f.emit('touchstart'); f.emit('touchmove',-20.2);
  const stale=[...f.frames.values()][0];
  f.emit('touchstart',0,{touches:[{identifier:1},{identifier:2}]});
  assert.equal(f.switcher.position,360);
  stale(); f.advance(500);
  assert.equal(painted(f),360); assert.equal(f.frames.size,0);
  const count=f.settled.length;
  f.emit('touchcancel');f.emit('touchend');f.emit('touchmove',-100);
  assert.equal(f.settled.length,count);assert.equal(painted(f),360);
  f.switcher.destroy();
});

test('flush callback reentry cannot overwrite newer navigation or a destroyed controller', () => {
  for(const destroy of [false,true]) {
    let f, takeover=false;
    f=fixture({onTouchPagingPosition(){
      if(takeover)return;takeover=true;
      if(destroy)f.switcher.destroy();else f.switcher.goTo(2,'instant');
    }});
    f.emit('touchstart');f.emit('touchmove',-20);
    f.switcher.goTo(1,'instant');
    f.advance(500);
    assert.equal(f.frames.size,0);
    if(destroy)assert.deepEqual(f.track.childNodes,f.slides);
    else assert.equal(painted(f),720);
    f.switcher.destroy();
  }
});

test('fast swipe and reversed release retain one-slide limits and bounded strip edges', () => {
  const f=fixture();
  f.emit('touchstart');f.advance(20);f.emit('touchmove',176);f.emit('touchend');
  f.advance(300);assert.equal(painted(f),360);
  f.emit('touchstart');f.advance(20);f.emit('touchmove',0);f.advance(20);f.emit('touchmove',50);f.emit('touchend');
  f.advance(300);assert.equal(painted(f),0);
  f.emit('touchstart');f.emit('touchmove',500);f.advance(16);
  assert.equal(painted(f),-44);assert.equal(f.slides[0].firstElementChild.style.translate,'');
  f.emit('touchend');f.advance(40);
  const edge=f.switcher.position;
  f.emit('touchstart');f.emit('touchmove',190);f.advance(16);
  assert.ok(f.switcher.position>edge);
  f.emit('touchcancel');assert.equal(painted(f),0);
  f.switcher.goTo(2,'instant');f.emit('touchstart');f.emit('touchmove',-1000);f.advance(16);
  assert.equal(painted(f),764);f.emit('touchend');f.advance(300);assert.equal(painted(f),720);
  f.switcher.destroy();
});

test('external touch targets share paging, preserve taps and remove handlers on unbind/destroy', () => {
  const f=fixture(), listeners=new Map();
  const button={addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
  const unbind=f.switcher.bindTouchPagingTarget(button);
  const event=(type,x)=>({touches:type==='touchend'?[]:[{identifier:4,clientX:x,clientY:100}],preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}});
  listeners.get('touchstart')(event('touchstart',200));
  const tap=event('click');listeners.get('click')(tap);assert.equal(tap.prevented,undefined);
  f.advance(20);listeners.get('touchmove')(event('touchmove',170));
  listeners.get('touchend')(event('touchend'));
  const click=event('click');listeners.get('click')(click);assert.equal(click.prevented,true);assert.equal(click.stopped,true);
  f.advance(300);assert.equal(painted(f),360);
  unbind();assert.equal(listeners.size,0);
  f.switcher.bindTouchPagingTarget(button);f.switcher.destroy();assert.equal(listeners.size,0);
  assert.deepEqual(f.track.childNodes,f.slides);
});

test('width resize cancels pending drag and settles the old nearest slide at its new offset', () => {
  let resize,disconnected=false;
  const f=fixture({ResizeObserver:class {constructor(fn){resize=fn;}observe(){}disconnect(){disconnected=true;}}});
  f.emit('touchstart');f.emit('touchmove',-30);
  f.track.clientWidth=420;f.slides[1].offsetLeft=420;f.slides[2].offsetLeft=840;
  resize();
  assert.equal(painted(f),420);assert.equal(f.switcher.viewportWidth,420);
  assert.equal(f.settled.at(-1).index,1);assert.equal(f.frames.size,0);
  f.emit('touchstart');f.emit('touchmove',180);resize();
  assert.equal(f.frames.size,1); // Unchanged width, including height-only resize.
  f.switcher.destroy();assert.equal(disconnected,true);
});

test('fractional reduced motion, layout refresh and destroy leave no pending work', () => {
  const f=fixture({reducedMotion:true});
  f.switcher.goTo(2);assert.equal(painted(f),720);assert.equal(f.frames.size,0);
  f.emit('touchstart');f.emit('touchmove',250);
  f.switcher.refreshTouchPagingLayout();assert.equal(painted(f),720);
  f.emit('touchstart');f.emit('touchmove',220);const stale=[...f.frames.values()][0];
  const count=f.positions.length;
  f.switcher.destroy();stale();f.advance(500);
  assert.equal(f.positions.length,count);assert.equal(f.listeners.size,0);
  assert.deepEqual(f.track.childNodes,f.slides);
});
