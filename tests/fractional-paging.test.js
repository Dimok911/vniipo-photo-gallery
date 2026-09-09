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

function releaseTrajectory({ deliveries, hold = 0, index = 0, points } = {}) {
  const f = fixture({ initialIndex: index });
  f.emit('touchstart', 350, { timeStamp: 0 });
  let inputTime = 0;
  const samples = points || Array.from({ length: 8 }, (_, i) => [16, (i + 1) * 16]);
  samples.forEach(([elapsed, distance], i) => {
    inputTime += elapsed;
    f.advance(deliveries?.[i] ?? elapsed);
    f.emit('touchmove', 350 - distance, { timeStamp: inputTime });
  });
  f.advance(hold);
  f.emit('touchend', 0, { timeStamp: inputTime + hold });
  const positions = [];
  for (let i = 0; i < 20; i++) { f.advance(16); positions.push(f.switcher.position); }
  const indexAfter = f.switcher.activeIndex;
  f.switcher.destroy();
  return { positions, indexAfter };
}

test('release uses input timestamps: delayed/batched delivery produces the same trajectory', () => {
  const regular = releaseTrajectory();
  const blocked = releaseTrajectory({ deliveries: [16,16,16,16,16,16,32,1] });
  assert.deepEqual(blocked, regular);
  assert.ok(regular.positions[0] < 155); // No 100px launch from a 1px/ms input.
});

test('held-finger release speed decays continuously through the former 100ms cliff', () => {
  const points = [[16,40],[16,80],[16,120]];
  const immediate = releaseTrajectory({points});
  const pauses = [80,99,100,101,160].map(hold => releaseTrajectory({points,hold}));
  assert.ok(pauses[0].positions[0] < immediate.positions[0] - 20);
  assert.ok(Math.abs(pauses[1].positions[0] - pauses[3].positions[0]) < 0.3);
  assert.ok(pauses[4].positions[0] < pauses[0].positions[0]);
  pauses.forEach(result => assert.equal(result.indexAfter,1));
});

test('a 1px micro-reversal keeps flick direction, but a deliberate reversal changes it', () => {
  const prefix = [[16,40],[16,80],[16,120],[16,140]];
  assert.equal(releaseTrajectory({index:1,points:[...prefix,[1,139]]}).indexAfter,2);
  assert.equal(releaseTrajectory({index:1,points:[...prefix,[16,100]]}).indexAfter,0);
});

test('holding a drag produces no self-motion after its one pending frame', () => {
  const f = fixture();
  f.emit('touchstart');f.emit('touchmove',80);f.advance(16);
  const before = {position:f.switcher.position, callbacks:f.positions.length};
  for(let i=0;i<20;i++)f.advance(16);
  assert.deepEqual({position:f.switcher.position,callbacks:f.positions.length},before);
  assert.equal(f.frames.size,0);
  f.switcher.destroy();
});
