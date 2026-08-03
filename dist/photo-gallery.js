(function installVniipoPhotoGallery(global) {
  "use strict";

  const VERSION = "2.1.1";
  const CONTRACT_VERSION = 2;
  const bindings = new WeakMap();
  const styleId = "vniipo-photo-gallery-v2-styles";

  const defaults = Object.freeze({
    gallery: "[data-photo-gallery]",
    track: ".vpg-track, .photo-gallery-track, .solution-photo-track, [data-photo-track]",
    slide: ".vpg-slide, [data-photo-open]",
    dot: "[data-vpg-dot], .photo-gallery-dot, [data-photo-dot]",
    image: "img",
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  function resolveActiveIndex(track, slides) {
    if (!track || !slides.length) return 0;
    const center = track.scrollLeft + track.clientWidth / 2;
    let index = 0;
    let distance = Number.POSITIVE_INFINITY;
    slides.forEach((slide, candidate) => {
      const slideCenter = slide.offsetLeft + slide.offsetWidth / 2;
      const nextDistance = Math.abs(slideCenter - center);
      if (nextDistance < distance) {
        distance = nextDistance;
        index = candidate;
      }
    });
    return index;
  }

  function resolveNavigationIndex(pendingIndex, measuredIndex, reachedTarget = false) {
    const measured = Math.max(0, Number(measuredIndex) || 0);
    if (pendingIndex === null || pendingIndex === undefined) {
      return { activeIndex: measured, pendingIndex: null };
    }
    const pending = Math.max(0, Number(pendingIndex) || 0);
    return {
      activeIndex: pending,
      pendingIndex: reachedTarget ? null : pending,
    };
  }

  function isDirectDesktop(windowRef = global) {
    return Boolean(
      windowRef?.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches
      && Number(windowRef?.innerWidth || 0) > 760
    );
  }

  function resolveSwipe(startX, startY, endX, endY, threshold) {
    const dx = Number(endX) - Number(startX);
    const dy = Number(endY) - Number(startY);
    const limit = Math.max(8, Number(threshold) || 28);
    const moved = Math.hypot(dx, dy) >= 7;
    const horizontal = Math.abs(dx) >= limit && Math.abs(dx) > Math.abs(dy) * 1.15;
    const vertical = Math.abs(dy) >= 7 && Math.abs(dy) >= Math.abs(dx);
    return {
      dx,
      dy,
      moved,
      horizontal,
      vertical,
      direction: horizontal ? (dx < 0 ? 1 : -1) : 0,
      tap: !moved,
    };
  }

  function stepInertia({
    x = 0,
    y = 0,
    velocityX = 0,
    velocityY = 0,
    elapsedMs = 16,
    friction = 0.0075,
  } = {}) {
    const elapsed = clamp(Number(elapsedMs) || 16, 1, 32);
    const damping = Math.exp(-Math.max(0, Number(friction) || 0) * elapsed);
    return {
      x: (Number(x) || 0) + (Number(velocityX) || 0) * elapsed,
      y: (Number(y) || 0) + (Number(velocityY) || 0) * elapsed,
      velocityX: (Number(velocityX) || 0) * damping,
      velocityY: (Number(velocityY) || 0) * damping,
    };
  }

  function ensureStyles(doc) {
    if (!doc?.createElement || !doc?.head || doc.getElementById?.(styleId)) return;
    const style = doc.createElement("style");
    style.id = styleId;
    style.textContent = `
.vpg-gallery{position:relative;overflow:hidden}
.vpg-track{position:relative;z-index:1;display:flex;width:100%;height:100%;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-x:none;overscroll-behavior-y:auto;touch-action:pan-x pan-y;-webkit-overflow-scrolling:touch}
.vpg-gallery.vpg-has-dots .vpg-track{height:calc(100% - 22px)}
.vpg-track::-webkit-scrollbar{display:none}
.vpg-slide{position:relative;display:block;flex:0 0 100%;width:100%;height:100%;min-width:0;padding:0;border:0;background:transparent;scroll-snap-align:start;scroll-snap-stop:always;overflow:hidden;cursor:zoom-in}
.vpg-slide>img,.vpg-slide img{display:block;width:100%;height:100%;object-fit:contain;background:var(--vpg-image-background,#fff);pointer-events:none;user-select:none;-webkit-user-drag:none}
.vpg-dots{position:absolute;left:50%;bottom:0;z-index:10;display:flex;align-items:center;gap:0;min-height:22px;transform:translate3d(-50%,0,0);padding:0 6px;border-radius:999px;background:rgba(255,255,255,.96);box-shadow:0 1px 6px rgba(15,23,42,.18)}
.vpg-dot{display:inline-grid;place-items:center;flex:0 0 12px;width:12px;height:22px;min-width:0;min-height:0;margin:0;padding:0;border:0;background:transparent;cursor:pointer;-webkit-tap-highlight-color:transparent}
.vpg-dot-mark{display:block;width:8px;height:8px;border:1px solid var(--vpg-accent,#667327);border-radius:50%;background:transparent;transition:background-color .15s ease,border-color .15s ease}
.vpg-dot.active .vpg-dot-mark,.vpg-dot[aria-current="true"] .vpg-dot-mark{border-color:var(--vpg-accent,#667327);background:var(--vpg-accent,#667327)}
.vpg-fullscreen.vpg-direct-desktop .vpg-fullscreen-track{overflow:hidden!important;scroll-snap-type:none!important;touch-action:none!important}
.vpg-fullscreen.vpg-direct-desktop .vpg-fullscreen-slide{display:none!important;flex-basis:100%;scroll-snap-align:none!important}
.vpg-fullscreen.vpg-direct-desktop .vpg-fullscreen-slide.vpg-fullscreen-active{display:grid!important;place-items:center}
`;
    doc.head.appendChild(style);
  }

  function mergeSelectors(custom) {
    return { ...defaults, ...(custom || {}) };
  }

  function createFullscreenSwitcher(options = {}) {
    const root = options.root;
    const track = options.track;
    const slides = Array.from(options.slides || track?.children || []);
    const directDesktop = options.directDesktop ?? isDirectDesktop(options.windowRef || global);
    let activeIndex = clamp(options.initialIndex, 0, Math.max(0, slides.length - 1));
    let destroyed = false;

    ensureStyles(root?.ownerDocument || track?.ownerDocument || global.document);
    root?.classList?.add("vpg-fullscreen");
    root?.classList?.toggle("vpg-direct-desktop", directDesktop);
    track?.classList?.add("vpg-fullscreen-track");
    slides.forEach((slide) => slide.classList?.add("vpg-fullscreen-slide"));

    function render(index, notify = true) {
      if (destroyed) return activeIndex;
      activeIndex = clamp(index, 0, Math.max(0, slides.length - 1));
      slides.forEach((slide, candidate) => {
        const active = candidate === activeIndex;
        slide.classList?.toggle("vpg-fullscreen-active", active);
        if (directDesktop) slide.setAttribute?.("aria-hidden", active ? "false" : "true");
        else slide.removeAttribute?.("aria-hidden");
      });
      if (notify && typeof options.onActiveIndexChange === "function") {
        options.onActiveIndexChange({ root, track, slides, index: activeIndex, directDesktop });
      }
      return activeIndex;
    }

    function goTo(index, behavior = "smooth", notify = true) {
      const next = render(index, notify);
      const slide = slides[next];
      if (!directDesktop && track && slide) {
        const left = Number.isFinite(Number(slide.offsetLeft))
          ? Number(slide.offsetLeft)
          : Number(track.clientWidth || 0) * next;
        track.scrollTo?.({ left, behavior });
      }
      return next;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      root?.classList?.remove("vpg-fullscreen", "vpg-direct-desktop");
      track?.classList?.remove("vpg-fullscreen-track");
      slides.forEach((slide) => {
        slide.classList?.remove("vpg-fullscreen-slide", "vpg-fullscreen-active");
        slide.removeAttribute?.("aria-hidden");
      });
    }

    render(activeIndex, false);
    return {
      directDesktop,
      get activeIndex() { return activeIndex; },
      goTo,
      render,
      destroy,
    };
  }

  function createFallbackAbortController() {
    let aborted = false;
    const listeners = new Set();
    return {
      signal: {
        get aborted() { return aborted; },
        addEventListener(type, listener) {
          if (type === "abort" && typeof listener === "function") listeners.add(listener);
        },
        removeEventListener(type, listener) {
          if (type === "abort") listeners.delete(listener);
        },
      },
      abort() {
        if (aborted) return;
        aborted = true;
        listeners.forEach((listener) => listener());
        listeners.clear();
      },
    };
  }

  function createAbortController() {
    return typeof global.AbortController === "function"
      ? new global.AbortController()
      : createFallbackAbortController();
  }

  function normalizeFullscreenSource(value) {
    if (typeof value === "string") return value ? { src: value, dispose: null } : null;
    if (!value || typeof value !== "object" || !value.src) return null;
    return {
      src: String(value.src),
      dispose: typeof value.dispose === "function" ? value.dispose : null,
    };
  }

  function createFullscreenSourceController(options = {}) {
    let entries = Array.from(options.entries || []);
    let activeIndex = clamp(options.initialIndex, 0, Math.max(0, entries.length - 1));
    let activationGeneration = 0;
    let destroyed = false;
    const verifiedSources = new Map();
    const resolvedSources = new Map();
    const resolutionPromises = new Map();
    const decodePromises = new Map();
    const decodedSources = new Set();
    const pendingControllers = new Map();
    const disposers = new Map();

    const sourceKey = (index, src) => `${index}\u0000${src}`;

    function reportError(error, phase, index, prefetch = false) {
      if (error?.name === "AbortError") return;
      if (typeof options.onError === "function") {
        options.onError(error, { phase, index, entry: entries[index], prefetch });
      }
    }

    function rememberSource(index, result) {
      if (!result?.src || !result.dispose) return result;
      const key = sourceKey(index, result.src);
      if (!disposers.has(key)) {
        let disposed = false;
        disposers.set(key, () => {
          if (disposed) return;
          disposed = true;
          result.dispose();
        });
      }
      return result;
    }

    function disposeSource(index, result) {
      if (!result?.src || !result.dispose) return;
      const key = sourceKey(index, result.src);
      const dispose = disposers.get(key);
      if (dispose) {
        disposers.delete(key);
        dispose();
      } else {
        result.dispose();
      }
    }

    function readPreview(index) {
      if (index < 0 || index >= entries.length) return "";
      const value = typeof options.getPreviewSource === "function"
        ? options.getPreviewSource(entries[index], index)
        : entries[index]?.previewSrc;
      return typeof value === "string" ? value : value?.src || "";
    }

    function readVerifiedFull(index) {
      if (verifiedSources.has(index)) return verifiedSources.get(index);
      if (index < 0 || index >= entries.length) return null;
      const value = typeof options.getVerifiedFullSource === "function"
        ? options.getVerifiedFullSource(entries[index], index)
        : entries[index]?.verifiedFullSrc;
      if (value && typeof value.then === "function") return null;
      const result = rememberSource(index, normalizeFullscreenSource(value));
      if (result) verifiedSources.set(index, result);
      return result;
    }

    function initialSource(index = activeIndex) {
      const normalizedIndex = clamp(index, 0, Math.max(0, entries.length - 1));
      if (normalizedIndex === activeIndex) {
        const resolved = resolvedSources.get(normalizedIndex);
        if (resolved && decodedSources.has(sourceKey(normalizedIndex, resolved.src))) return resolved.src;
        const verified = readVerifiedFull(normalizedIndex);
        if (verified) return verified.src;
      }
      return readPreview(normalizedIndex);
    }

    async function resolveFull(index, prefetch) {
      const verified = readVerifiedFull(index);
      if (verified) return verified;
      if (resolvedSources.has(index)) return resolvedSources.get(index);
      if (resolutionPromises.has(index)) return resolutionPromises.get(index);
      if (typeof options.resolveFullSource !== "function") return null;

      const controller = createAbortController();
      const pendingKey = `resolve:${index}`;
      const pending = { index, controller };
      pendingControllers.set(pendingKey, pending);
      const promise = Promise.resolve().then(() => options.resolveFullSource(entries[index], index, {
        signal: controller.signal,
        prefetch,
      })).then((value) => {
        const result = rememberSource(index, normalizeFullscreenSource(value));
        if (controller.signal.aborted) {
          disposeSource(index, result);
          return null;
        }
        if (result) resolvedSources.set(index, result);
        return result;
      }).catch((error) => {
        reportError(error, "resolve", index, prefetch);
        return null;
      }).finally(() => {
        if (resolutionPromises.get(index) === promise) resolutionPromises.delete(index);
        if (pendingControllers.get(pendingKey) === pending) pendingControllers.delete(pendingKey);
      });
      resolutionPromises.set(index, promise);
      return promise;
    }

    async function decodeFull(index, result, prefetch) {
      if (!result?.src) return false;
      const key = sourceKey(index, result.src);
      if (decodedSources.has(key)) return true;
      if (decodePromises.has(key)) return decodePromises.get(key);
      if (typeof options.decodeSource !== "function") {
        decodedSources.add(key);
        return true;
      }

      const controller = createAbortController();
      const pendingKey = `decode:${key}`;
      const pending = { index, controller };
      pendingControllers.set(pendingKey, pending);
      const promise = Promise.resolve().then(() => options.decodeSource({
        entry: entries[index],
        index,
        src: result.src,
        signal: controller.signal,
        prefetch,
      })).then((success) => {
        const decoded = success === true && !controller.signal.aborted;
        if (decoded) decodedSources.add(key);
        return decoded;
      }).catch((error) => {
        reportError(error, "decode", index, prefetch);
        return false;
      }).finally(() => {
        if (decodePromises.get(key) === promise) decodePromises.delete(key);
        if (pendingControllers.get(pendingKey) === pending) pendingControllers.delete(pendingKey);
      });
      decodePromises.set(key, promise);
      return promise;
    }

    async function prefetch(index) {
      if (destroyed || index < 0 || index >= entries.length) return false;
      const result = await resolveFull(index, true);
      if (destroyed || !result) return false;
      return decodeFull(index, result, true);
    }

    function prefetchAdjacent(index) {
      if (options.prefetchAdjacent === false) return;
      [index - 1, index + 1].forEach((candidate) => {
        if (candidate >= 0 && candidate < entries.length) void prefetch(candidate);
      });
    }

    function cancelPending(index = null) {
      activationGeneration += 1;
      pendingControllers.forEach(({ index: pendingIndex, controller }, key) => {
        if (index === null || pendingIndex === index) {
          controller.abort();
          pendingControllers.delete(key);
        }
      });
      resolutionPromises.forEach((_promise, pendingIndex) => {
        if (index === null || pendingIndex === index) resolutionPromises.delete(pendingIndex);
      });
      decodePromises.forEach((_promise, key) => {
        const pendingIndex = Number(key.slice(0, key.indexOf("\u0000")));
        if (index === null || pendingIndex === index) decodePromises.delete(key);
      });
    }

    function cancelPendingExcept(index) {
      pendingControllers.forEach(({ index: pendingIndex, controller }, key) => {
        if (pendingIndex !== index) {
          controller.abort();
          pendingControllers.delete(key);
        }
      });
      resolutionPromises.forEach((_promise, pendingIndex) => {
        if (pendingIndex !== index) resolutionPromises.delete(pendingIndex);
      });
      decodePromises.forEach((_promise, key) => {
        const pendingIndex = Number(key.slice(0, key.indexOf("\u0000")));
        if (pendingIndex !== index) decodePromises.delete(key);
      });
    }

    async function activate(index) {
      if (destroyed || !entries.length) return { index: 0, src: "", success: false };
      activeIndex = clamp(index, 0, entries.length - 1);
      const activatedIndex = activeIndex;
      const generation = ++activationGeneration;
      cancelPendingExcept(activeIndex);
      const result = await resolveFull(activeIndex, false);
      if (destroyed || generation !== activationGeneration || !result) {
        return { index: activeIndex, src: result?.src || "", success: false };
      }
      const success = await decodeFull(activeIndex, result, false);
      if (destroyed || generation !== activationGeneration || activeIndex !== activatedIndex || !success) {
        return { index: activeIndex, src: result.src, success: false };
      }
      if (typeof options.commitSource === "function") {
        let committed = false;
        try {
          committed = await options.commitSource({
            entry: entries[activeIndex],
            index: activeIndex,
            src: result.src,
          }) !== false;
        } catch (error) {
          reportError(error, "commit", activeIndex, false);
        }
        if (!committed || destroyed || generation !== activationGeneration) {
          return { index: activeIndex, src: result.src, success: false };
        }
      }
      prefetchAdjacent(activeIndex);
      return { index: activeIndex, src: result.src, success: true };
    }

    function replaceEntries(nextEntries, nextIndex = 0) {
      cancelPending();
      disposers.forEach((dispose) => dispose());
      disposers.clear();
      verifiedSources.clear();
      resolvedSources.clear();
      resolutionPromises.clear();
      decodePromises.clear();
      decodedSources.clear();
      entries = Array.from(nextEntries || []);
      activeIndex = clamp(nextIndex, 0, Math.max(0, entries.length - 1));
      return activeIndex;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelPending();
      disposers.forEach((dispose) => dispose());
      disposers.clear();
      verifiedSources.clear();
      resolvedSources.clear();
      resolutionPromises.clear();
      decodePromises.clear();
      decodedSources.clear();
    }

    return {
      get activeIndex() { return activeIndex; },
      initialSource,
      activate,
      prefetch,
      cancel: cancelPending,
      replaceEntries,
      destroy,
    };
  }

  function bindGallery(gallery, options) {
    const existing = bindings.get(gallery);
    if (existing) {
      existing.refresh();
      return existing;
    }

    const selectors = mergeSelectors(options.selectors);
    const track = gallery.querySelector(selectors.track);
    if (!track) return null;
    const listeners = [];
    let slides = [];
    let dots = [];
    let activeIndex = Math.max(0, Number(gallery.dataset.photoInitialIndex) || 0);
    let pendingScrollIndex = null;
    let scrollFrame = 0;
    let scrollTimer = 0;
    let suppressClickUntil = 0;
    let touch = null;
    let destroyed = false;

    const listen = (target, type, listener, listenerOptions) => {
      target.addEventListener(type, listener, listenerOptions);
      listeners.push(() => target.removeEventListener(type, listener, listenerOptions));
    };

    function collect() {
      slides = Array.from(track.querySelectorAll(selectors.slide));
      dots = Array.from(gallery.querySelectorAll(selectors.dot));
      gallery.classList.toggle("vpg-has-dots", dots.length > 1);
      activeIndex = clamp(activeIndex, 0, Math.max(0, slides.length - 1));
      updateDots(activeIndex, false);
    }

    function updateDots(nextIndex, notify = true) {
      activeIndex = clamp(nextIndex, 0, Math.max(0, slides.length - 1));
      dots.forEach((dot, index) => {
        const active = index === activeIndex;
        dot.classList.toggle("active", active);
        dot.setAttribute("aria-current", active ? "true" : "false");
        if (!dot.getAttribute("aria-label")) {
          dot.setAttribute("aria-label", `Фото ${index + 1}`);
        }
      });
      if (notify && typeof options.onActiveIndexChange === "function") {
        options.onActiveIndexChange({ gallery, track, index: activeIndex });
      }
    }

    function cancelPendingScroll() {
      pendingScrollIndex = null;
      if (scrollFrame) {
        cancelAnimationFrame(scrollFrame);
        scrollFrame = 0;
      }
      if (scrollTimer) {
        clearTimeout(scrollTimer);
        scrollTimer = 0;
      }
    }

    function syncFromScroll() {
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        const measuredIndex = resolveActiveIndex(track, slides);
        const target = pendingScrollIndex === null ? null : slides[pendingScrollIndex];
        const reachedTarget = Boolean(target) && Math.abs(track.scrollLeft - target.offsetLeft) <= 1;
        const resolved = resolveNavigationIndex(pendingScrollIndex, measuredIndex, reachedTarget);
        pendingScrollIndex = resolved.pendingIndex;
        updateDots(resolved.activeIndex);
      });
    }

    function scrollToIndex(index, behavior = "smooth") {
      const next = clamp(index, 0, Math.max(0, slides.length - 1));
      const slide = slides[next];
      if (!slide) return;
      cancelPendingScroll();
      pendingScrollIndex = behavior === "smooth" ? next : null;
      updateDots(next);
      track.scrollTo({ left: slide.offsetLeft, behavior });
      scrollTimer = setTimeout(() => {
        scrollTimer = 0;
        pendingScrollIndex = null;
        updateDots(resolveActiveIndex(track, slides));
      }, behavior === "smooth" ? 600 : 0);
    }

    function openAt(index, trigger, event) {
      const slide = slides[clamp(index, 0, Math.max(0, slides.length - 1))];
      if (!slide || typeof options.openLightbox !== "function") return;
      const image = slide.matches(selectors.image) ? slide : slide.querySelector(selectors.image);
      options.openLightbox({
        gallery,
        track,
        slide,
        image,
        index: slides.indexOf(slide),
        trigger,
        event,
      });
    }

    function slideIndexForTarget(target) {
      const slide = target && target.closest ? target.closest(selectors.slide) : null;
      return slide ? slides.indexOf(slide) : -1;
    }

    listen(track, "scroll", syncFromScroll, { passive: true });
    listen(track, "wheel", cancelPendingScroll, { passive: true });

    listen(gallery, "click", (event) => {
      const dot = event.target.closest(selectors.dot);
      if (dot && gallery.contains(dot)) {
        event.preventDefault();
        event.stopPropagation();
        const index = Number(dot.dataset.photoIndex ?? dot.dataset.vpgIndex ?? dots.indexOf(dot));
        scrollToIndex(Number.isFinite(index) ? index : dots.indexOf(dot));
        return;
      }
      const index = slideIndexForTarget(event.target);
      if (index < 0) return;
      if (Date.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      openAt(index, "click", event);
    });

    listen(track, "touchstart", (event) => {
      cancelPendingScroll();
      if (event.touches.length !== 1) {
        touch = null;
        suppressClickUntil = Date.now() + 600;
        return;
      }
      const point = event.touches[0];
      touch = {
        x: point.clientX,
        y: point.clientY,
        lastX: point.clientX,
        lastY: point.clientY,
        slideIndex: slideIndexForTarget(event.target),
        activeIndex: resolveActiveIndex(track, slides),
      };
    }, { passive: true });

    listen(track, "touchmove", (event) => {
      if (!touch || event.touches.length !== 1) return;
      touch.lastX = event.touches[0].clientX;
      touch.lastY = event.touches[0].clientY;
      const gesture = resolveSwipe(touch.x, touch.y, touch.lastX, touch.lastY, options.swipeThreshold);
      if (gesture.moved) suppressClickUntil = Date.now() + 600;
    }, { passive: true });

    listen(track, "touchend", (event) => {
      if (!touch) return;
      const ended = touch;
      touch = null;
      const point = event.changedTouches && event.changedTouches[0];
      const endX = point ? point.clientX : ended.lastX;
      const endY = point ? point.clientY : ended.lastY;
      const gesture = resolveSwipe(ended.x, ended.y, endX, endY, options.swipeThreshold);
      if (gesture.horizontal) {
        suppressClickUntil = Date.now() + 600;
        scrollToIndex(ended.activeIndex + gesture.direction);
        return;
      }
      if (gesture.tap && ended.slideIndex >= 0) {
        suppressClickUntil = Date.now() + 600;
        event.preventDefault();
        openAt(ended.slideIndex, "tap", event);
        return;
      }
      if (gesture.moved) {
        suppressClickUntil = Date.now() + 600;
        scrollToIndex(resolveActiveIndex(track, slides));
      }
    }, { passive: false });

    listen(track, "touchcancel", () => {
      touch = null;
      suppressClickUntil = Date.now() + 300;
      scrollToIndex(resolveActiveIndex(track, slides));
    }, { passive: true });

    dots.forEach((dot) => {
      if (!dot.querySelector(".vpg-dot-mark, .photo-gallery-dot-mark")) {
        const marker = gallery.ownerDocument.createElement("span");
        marker.className = "vpg-dot-mark";
        marker.setAttribute("aria-hidden", "true");
        dot.appendChild(marker);
      }
    });

    const binding = {
      gallery,
      refresh() {
        if (destroyed) return;
        collect();
      },
      goTo(index, behavior) {
        if (!destroyed) scrollToIndex(index, behavior);
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        cancelPendingScroll();
        listeners.splice(0).forEach((remove) => remove());
        bindings.delete(gallery);
      },
    };
    bindings.set(gallery, binding);
    collect();
    if (activeIndex) {
      requestAnimationFrame(() => scrollToIndex(activeIndex, "auto"));
    }
    return binding;
  }

  function bindInlineGalleries(root, options = {}) {
    const scope = root && root.querySelectorAll ? root : global.document;
    if (!scope) return { refresh() {}, destroy() {}, bindings: [] };
    ensureStyles(scope.ownerDocument || scope);
    const selector = mergeSelectors(options.selectors).gallery;
    const galleries = [];
    if (scope.matches && scope.matches(selector)) galleries.push(scope);
    galleries.push(...scope.querySelectorAll(selector));
    const localBindings = galleries.map((gallery) => bindGallery(gallery, options)).filter(Boolean);
    let observer = null;
    const controller = {
      bindings: localBindings,
      refresh() {
        localBindings.forEach((binding) => binding.refresh());
        return controller;
      },
      destroy() {
        if (observer) observer.disconnect();
        localBindings.splice(0).forEach((binding) => binding.destroy());
      },
    };
    if (options.observe && typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(() => controller.refresh());
      observer.observe(scope, { childList: true, subtree: true });
    }
    return controller;
  }

  function destroyInlineGalleries(root) {
    const scope = root && root.querySelectorAll ? root : global.document;
    if (!scope) return;
    const selector = defaults.gallery;
    const galleries = [];
    if (scope.matches && scope.matches(selector)) galleries.push(scope);
    galleries.push(...scope.querySelectorAll(selector));
    galleries.forEach((gallery) => bindings.get(gallery)?.destroy());
  }

  const api = Object.freeze({
    version: VERSION,
    contractVersion: CONTRACT_VERSION,
    channel: "stable",
    capabilities: Object.freeze({ fullscreenSourceLifecycle: 1 }),
    bindInlineGalleries,
    createFullscreenSourceController,
    createFullscreenSwitcher,
    destroyInlineGalleries,
    ensureStyles,
    helpers: Object.freeze({
      clamp,
      isDirectDesktop,
      resolveActiveIndex,
      resolveNavigationIndex,
      resolveSwipe,
      stepInertia,
    }),
  });

  global.VniipoPhotoGallery = api;
  if (global.document && global.document.documentElement) {
    global.document.documentElement.dataset.photoGalleryVersion = VERSION;
    global.document.dispatchEvent(new CustomEvent("vniipo-photo-gallery:ready", {
      detail: { version: VERSION, contractVersion: CONTRACT_VERSION },
    }));
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
