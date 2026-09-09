import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source = await readFile(new URL('../../dist/photo-gallery.js', import.meta.url), 'utf8');
async function setup(page) {
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body{margin:0}.root{width:414px;height:600px;overflow:hidden}
    .root.app.mobile .track:not(.zoomed){overflow-x:auto!important;scroll-snap-type:x mandatory!important;touch-action:pan-x!important;scroll-behavior:smooth!important}
    .track{display:flex;position:relative;width:100%;height:100%}
    .slide{flex:0 0 100%;width:100%;height:100%;display:grid;place-items:center;scroll-snap-align:start}
    img{width:100%;height:100%;object-fit:contain}
  </style><div class="root app mobile"><div class="track">${['red','green','blue'].map(color =>
    `<div class="slide"><img src="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="${color}"/></svg>`)}"></div>`
  ).join('')}</div></div>`);
  await page.addScriptTag(process.env.GALLERY_RUNTIME_URL ? { url: process.env.GALLERY_RUNTIME_URL } : { content: source });
  await page.evaluate(async () => {
    window.track = document.querySelector('.track'); window.slides = [...track.children];
    window.frames = []; window.starts = []; window.settled = []; window.pinching = false; window.scale = 1;
    window.switcher = VniipoPhotoGallery.createFullscreenSwitcher({
      root: document.querySelector('.root'), track, slides, directDesktop: false, touchPaging: 'controlled', touchPagingPresentation:'transform',
      canTouchPage: () => !pinching && scale <= 1,
      onTouchPagingStart(value) { starts.push({index:value.index, settling:switcher.isSettling, fingers:value.event.touches.length}); },
      onTouchPagingPosition(value) { frames.push({...value, left:switcher.position}); },
      onTouchPagingSettle(value) { settled.push(value); },
    });
    window.touch = (type, points) => {
      const event = new Event(type, {bubbles:true,cancelable:true});
      Object.defineProperty(event,'touches',{value:points.map(([x,y],identifier)=>({identifier,clientX:x,clientY:y}))});
      track.dispatchEvent(event);
    };
    track.addEventListener('touchstart', event => {
      if (event.touches.length !== 2) return;
      pinching = true;
      switcher.goTo(Math.round(switcher.position / track.clientWidth),'instant');
    });
    track.addEventListener('touchmove', event => {
      if (!pinching || event.touches.length !== 2) return;
      scale = Math.abs(event.touches[1].clientX-event.touches[0].clientX)/100;
      slides[switcher.activeIndex].firstElementChild.style.transform = `scale(${scale})`;
    });
    await Promise.all([...document.images].map(image=>image.decode()));
    window.images = [...document.images];
  });
}

test('fractional: released swipe accepts a NEW pinch while still settling, with no late position or bitmap reset', async ({page}) => {
  await setup(page);
  const policy = await page.evaluate(() => {
    const style = getComputedStyle(track);
    return [style.overflowX,style.touchAction,style.scrollSnapType,style.scrollBehavior];
  });
  expect(policy).toEqual(['clip','none','none','auto']);
  await page.evaluate(() => touch('touchstart',[[350,200]]));
  await page.waitForTimeout(30);
  await page.evaluate(() => { touch('touchmove',[[100,200]]); touch('touchend',[]); });
  await page.waitForTimeout(30);
  expect(await page.evaluate(() => switcher.isSettling && switcher.position > track.clientWidth/2 && switcher.position < track.clientWidth)).toBe(true);
  const takeover = await page.evaluate(() => {
    touch('touchstart',[[130,200],[230,200]]);
    touch('touchmove',[[80,200],[280,200]]);
    return {scale,settling:switcher.isSettling,left:switcher.position, callbacks:starts.at(-1)};
  });
  expect(takeover.scale).toBe(2); expect(takeover.settling).toBe(false);
  expect(takeover.callbacks).toEqual({index:1,settling:false,fingers:2});
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => ({scale,left:switcher.position,same:images.every((image,index)=>image===document.images[index]),
    transform:slides[1].firstElementChild.style.transform}))).toEqual({scale:2,left:takeover.left,same:true,transform:'scale(2)'});
});

test('fractional: smooth goTo can be interrupted by a new swipe and edge return can be interrupted by pinch', async ({page}) => {
  await setup(page);
  await page.evaluate(() => switcher.goTo(2,'smooth'));
  await page.waitForTimeout(35);
  const frozen = await page.evaluate(() => { touch('touchstart',[[200,200]]); return switcher.position; });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => switcher.position)).toBe(frozen);
  await page.evaluate(() => { switcher.goTo(2,'instant'); touch('touchstart',[[250,200]]); touch('touchmove',[[0,200]]); });
  expect(await page.evaluate(() => track.clientWidth*2-switcher.position)).toBe(-44);
  await page.evaluate(() => touch('touchend',[]));
  await page.waitForTimeout(30);
  await page.evaluate(() => { touch('touchstart',[[130,200],[230,200]]); touch('touchmove',[[80,200],[280,200]]); });
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => ({scale,index:switcher.activeIndex,translate:slides[2].firstElementChild.style.translate}))).toEqual({scale:2,index:2,translate:''});
});

test('fractional: reduced motion settles immediately and destroy restores consumer scroll styles', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await setup(page);
  const result = await page.evaluate(() => {
    switcher.goTo(2,'smooth');
    const result = {index:switcher.activeIndex,settling:switcher.isSettling,settles:settled.length};
    switcher.destroy();
    return {...result,overflow:getComputedStyle(track).overflowX,touch:getComputedStyle(track).touchAction};
  });
  expect(result).toEqual({index:2,settling:false,settles:1,overflow:'auto',touch:'pan-x'});
});

test('fractional: 38-slide drag paints the latest finger position without per-move layout reads or class churn', async ({page}) => {
  await setup(page);
  const result = await page.evaluate(() => {
    switcher.destroy();
    while (track.children.length < 38) track.append(track.children[0].cloneNode(true));
    slides = [...track.children];
    const getOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype,'offsetLeft').get;
    let reads = 0;
    slides.forEach(slide => Object.defineProperty(slide,'offsetLeft',{get(){ reads++; return getOffset.call(this); }}));
    switcher = VniipoPhotoGallery.createFullscreenSwitcher({
      root:document.querySelector('.root'),track,slides,directDesktop:false,touchPaging:'controlled',touchPagingPresentation:'transform',
    });
    const observer = new MutationObserver(()=>{});
    observer.observe(track,{subtree:true,attributes:true,attributeFilter:['class']});
    touch('touchstart',[[350,200]]);
    reads=0;
    for (let x=340; x>=190; x-=10) touch('touchmove',[[x,200]]);
    const result = {reads,mutations:observer.takeRecords().length,left:switcher.position,count:slides.length};
    observer.disconnect();
    switcher.destroy();
    return result;
  });
  expect(result).toEqual({reads:0,mutations:0,left:160,count:38});
});

test('fractional: subpixel input yields 12 distinct image rectangles AND raster positions', async ({page}) => {
  await setup(page);
  await page.evaluate(async () => {
    images[0].src = 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="414" height="600"><rect width="414" height="600" fill="black"/><rect x="220" width="6" height="600" fill="white"/></svg>');
    await images[0].decode();
    touch('touchstart',[[350,200]]);
  });
  const rects=[], rasters=[];
  for(let i=0;i<12;i++) {
    const position=100+i*.2;
    rects.push(await page.evaluate(async position => {
      touch('touchmove',[[350-position,200]]);
      await new Promise(requestAnimationFrame);
      return track.getBoundingClientRect().left-slides[0].getBoundingClientRect().left;
    },position));
    const bitmap=await page.screenshot({clip:{x:100,y:300,width:40,height:1}});
    rasters.push(createHash('sha256').update(bitmap).digest('hex'));
    expect(rects.at(-1)).toBeCloseTo(position,3);
  }
  expect(new Set(rects).size).toBe(12);
  expect(new Set(rasters).size).toBe(12);
  expect(await page.evaluate(()=>track.scrollLeft)).toBe(0);
});

test('fractional: burst paints once per RAF and pending pinch flushes before bubble selection', async ({page}) => {
  await setup(page);
  const burst=await page.evaluate(async () => {
    let scrolls=0;track.addEventListener('scroll',()=>scrolls++);
    const observer=new MutationObserver(()=>{}),strip=track.querySelector('.vpg-controlled-strip');
    observer.observe(strip,{attributes:true,attributeFilter:['style']});
    touch('touchstart',[[350,200]]);
    for(let i=0;i<12;i++) touch('touchmove',[[250-i*.2,200]]);
    const pending={logical:switcher.position,actual:-slides[0].getBoundingClientRect().left || 0,writes:observer.takeRecords().length,callbacks:frames.length};
    let writes=0;observer.disconnect();
    const painted=new MutationObserver(records=>writes+=records.length);
    painted.observe(strip,{attributes:true,attributeFilter:['style']});
    await new Promise(requestAnimationFrame);await Promise.resolve();
    const result={pending,writes:writes+painted.takeRecords().length,actual:-slides[0].getBoundingClientRect().left,callbacks:frames.length,scrolls};
    painted.disconnect();return result;
  });
  expect(burst.pending).toEqual({logical:102.19999999999999,actual:0,writes:0,callbacks:0});
  expect(burst.writes).toBe(1);expect(burst.callbacks).toBe(1);expect(burst.scrolls).toBe(0);
  expect(burst.actual).toBeCloseTo(102.2,3);
  const pinch=await page.evaluate(() => {
    touch('touchmove',[[110,200]]); // Remains queued when the next touch arrives.
    touch('touchstart',[[130,200],[230,200]]);
    touch('touchmove',[[80,200],[280,200]]);
    return {scale,index:switcher.activeIndex,actual:-slides[0].getBoundingClientRect().left,logical:switcher.position};
  });
  expect(pinch).toEqual({scale:2,index:1,actual:414,logical:414});
  await page.waitForTimeout(300);
  expect(await page.evaluate(()=>-slides[0].getBoundingClientRect().left)).toBe(414);
});

test('fractional: button proxy and lifecycle preserve nodes, order and inline policy', async ({page}) => {
  await setup(page);
  const result=await page.evaluate(async () => {
    const button=document.createElement('button');button.style.setProperty('touch-action','pan-y','important');document.querySelector('.root').append(button);
    let clicks=0;button.addEventListener('click',()=>clicks++);
    const unbind=switcher.bindTouchPagingTarget(button);
    const emit=(type,points=[])=>{
      const event=new Event(type,{bubbles:true,cancelable:true});
      Object.defineProperty(event,'touches',{value:points.map(([x,y],identifier)=>({identifier,clientX:x,clientY:y}))});button.dispatchEvent(event);
    };
    emit('touchstart',[[350,200]]);emit('touchend');emit('click');
    emit('touchstart',[[350,200]]);emit('touchmove',[[50,200]]);emit('touchend');emit('click');
    await new Promise(resolve=>setTimeout(resolve,300));
    const index=switcher.activeIndex,policy=getComputedStyle(button).touchAction;
    unbind();
    const restored=[button.style.getPropertyValue('touch-action'),button.style.getPropertyPriority('touch-action')];
    switcher.destroy();
    return {index,policy,restored,clicks,same:slides.every((slide,i)=>slide===track.children[i])&&images.every((img,i)=>img===slides[i].firstElementChild),comments:[...track.childNodes].filter(node=>node.nodeType===8).length};
  });
  expect(result).toEqual({index:1,policy:'none',restored:['pan-y','important'],clicks:1,same:true,comments:0});
});

test('fractional: real width changes settle old nearest index and height-only changes keep drag', async ({page}) => {
  await setup(page);
  await page.evaluate(() => {
    touch('touchstart',[[350,200]]);touch('touchmove',[[100,200]]);
    document.querySelector('.root').style.width='390px';
  });
  await expect.poll(()=>page.evaluate(()=>switcher.viewportWidth)).toBe(390);
  expect(await page.evaluate(()=>({index:switcher.activeIndex,position:switcher.position,actual:-slides[0].getBoundingClientRect().left,settling:switcher.isSettling,settle:settled.at(-1).index})))
    .toEqual({index:1,position:390,actual:390,settling:false,settle:1});
  await page.evaluate(()=>{touch('touchstart',[[350,200]]);touch('touchmove',[[330,200]]);document.querySelector('.root').style.height='550px';});
  await page.waitForTimeout(70);
  expect(await page.evaluate(()=>switcher.position)).toBe(410);
  await page.evaluate(()=>touch('touchmove',[[320,200]]));
  expect(await page.evaluate(()=>switcher.position)).toBe(420);
});
