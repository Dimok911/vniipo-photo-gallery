import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const runtime = await readFile(new URL('../../dist/photo-gallery.js', import.meta.url), 'utf8');

async function setup(page) {
  await page.setContent(`<style>
    body{margin:0;background:black}.root{width:100vw;height:100vh}
    .track{position:relative;display:flex;width:100%;height:100%;overflow-x:auto;scroll-snap-type:x mandatory;overscroll-behavior-x:none}
    .slide{flex:0 0 100%;width:100%;height:100%;scroll-snap-align:start;display:grid;place-items:center}
    img{width:100%;height:80%;object-fit:contain;transform:scale(1)}
  </style><div class="root"><div class="track">${['red','green','blue'].map(color =>
    `<div class="slide"><img src="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="${color}"/></svg>`)}"></div>`
  ).join('')}</div></div>`);
  await page.addScriptTag({ content: runtime });
  await page.evaluate(async () => {
    window.track = document.querySelector('.track');
    window.slides = [...track.children];
    window.zoomed = false;
    window.switcher = VniipoPhotoGallery.createFullscreenSwitcher({
      root: document.querySelector('.root'), track, slides, directDesktop: false,
      canRubberBand: () => !window.zoomed,
    });
    window.touch = (type, x = 100, y = 100, extra = {}) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : [{ identifier: 1, clientX: x, clientY: y }], configurable: true });
      Object.entries(extra).forEach(([key,value]) => Object.defineProperty(event,key,{value}));
      track.dispatchEvent(event);
      return event.defaultPrevented;
    };
    await Promise.all([...document.images].map(img => img.decode()));
    track.scrollLeft = track.clientWidth * 2;
  });
  await expect.poll(() => page.evaluate(() => track.scrollLeft)).toBe(await page.evaluate(() => track.clientWidth * 2));
}

test('last-edge motion keeps native snap bounds and resumes the painted return', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const before = slides[2].getBoundingClientRect().x;
    touch('touchstart'); touch('touchmove', -100);
    return { before, after: slides[2].getBoundingClientRect().x,
      offset: parseFloat(getComputedStyle(slides[2].firstElementChild).translate),
      transform: getComputedStyle(slides[2]).transform, left: track.scrollLeft, width: track.clientWidth };
  });
  expect(result.after).toBe(result.before);
  expect(result.offset).toBe(-44);
  expect(result.transform).toBe('none');
  expect(result.left).toBe(result.width * 2);
  await page.evaluate(() => touch('touchend'));
  await page.waitForTimeout(50);
  const resumed = await page.evaluate(() => {
    const content = slides[2].firstElementChild;
    const before = parseFloat(getComputedStyle(content).translate);
    touch('touchstart');
    return { before, after: parseFloat(getComputedStyle(content).translate) };
  });
  expect(resumed.before).toBeLessThan(0);
  expect(resumed.after).toBeCloseTo(resumed.before, 2);
  await page.evaluate(() => { touch('touchmove', 500); touch('touchcancel'); });
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => ({ left: track.scrollLeft / track.clientWidth, translate: slides[2].firstElementChild.style.translate }))).toEqual({ left: 2, translate: '' });
});

test('native-owned events, vertical gestures and zoom never start content translation', async ({ page }) => {
  await setup(page);
  const results = await page.evaluate(() => {
    const results = [];
    for (const mode of ['vertical','inward','native','zoom','pinch']) {
      zoomed = mode === 'zoom'; touch('touchstart');
      if (mode === 'vertical') touch('touchmove', 100, 200);
      if (mode === 'inward') touch('touchmove', 200, 100);
      if (mode === 'native') touch('touchmove', 0, 100, { cancelable: false });
      if (mode === 'pinch') touch('touchmove', 0, 100, { touches: [{identifier:1},{identifier:2}] });
      touch('touchmove', -200);
      results.push(slides[2].firstElementChild.style.translate);
      touch('touchcancel');
    }
    return results;
  });
  expect(results).toEqual(['','','','','']);
});

test('slow original retains a decoded preview and cannot reset native edge position', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    window.pending = switcher.activate(0, () => new Promise(resolve => { window.ready = resolve; }), { scroll: false });
    touch('touchstart'); touch('touchmove', -200); touch('touchend');
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => ({
    index: VniipoPhotoGallery.helpers.resolveActiveIndex(track, slides),
    imageReady: slides[2].firstElementChild.complete && slides[2].firstElementChild.naturalWidth > 0,
    source: slides[2].firstElementChild.currentSrc.startsWith('data:image/'),
  }))).toEqual({ index: 2, imageReady: true, source: true });
  await page.evaluate(async () => { ready(true); await pending; });
  expect(await page.evaluate(() => track.scrollLeft / track.clientWidth)).toBe(2);
});

for (const phase of ['drag', 'return']) {
  test(`image replacement during ${phase} strips transient translation and restores rollback`, async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(async (phase) => {
      const old = slides[2].firstElementChild;
      touch('touchstart'); touch('touchmove', -100);
      if (phase === 'return') touch('touchend');
      let replacement;
      try {
        await VniipoPhotoGallery.replaceFullscreenImageSource(old, old.src, {
          onReplaced(image) { replacement = image; },
          afterPaint() { throw new Error('force rollback'); },
        });
      } catch (error) {
        if (error.message !== 'force rollback') throw error;
      }
      touch('touchend');
      return {
        restored: slides[2].firstElementChild === old,
        oldTranslate: old.style.translate,
        newTranslate: replacement.style.translate,
        newClasses: replacement.className,
        transform: replacement.style.transform,
        index: track.scrollLeft / track.clientWidth,
      };
    }, phase);
    expect(result.restored).toBe(true);
    expect(result.oldTranslate).toBe('');
    expect(result.newTranslate).toBe('');
    expect(result.newClasses).not.toContain('vpg-edge');
    expect(result.index).toBe(2);
  });
}
