(function installVniipoPhotoGallery(global) {
  "use strict";

  const VERSION = "2.3.0";
  const CONTRACT_VERSION = 2;
  const bindings = new WeakMap();
  const edgePresentations = new WeakMap();
  const styleId = "vniipo-photo-gallery-v2-styles";
  const fullscreenControlStyleId = "vniipo-photo-gallery-v2-fullscreen-controls";
  const edgeStyleId = "vniipo-photo-gallery-v2-edge-content";
  const pagingStyleId = "vniipo-photo-gallery-v2-controlled-paging";

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

  function resolveSlideLeft(track, slide, index = 0) {
    if (!slide) return 0;
    const left = Number(slide.offsetLeft);
    if (Number.isFinite(left)) {
      if (slide.offsetParent && slide.offsetParent !== track && slide.offsetParent === track?.offsetParent) {
        return left - (Number(track.offsetLeft) || 0) - (Number(track.clientLeft) || 0);
      }
      return left;
    }
    return (Number(track?.clientWidth) || 0) * index;
  }

  function resolveActiveIndex(track, slides) {
    if (!track || !slides.length) return 0;
    const maxLeft = Math.max(0, Number.isFinite(Number(track.scrollWidth))
      ? Number(track.scrollWidth) - track.clientWidth
      : resolveSlideLeft(track, slides[slides.length - 1], slides.length - 1));
    const center = clamp(track.scrollLeft, 0, maxLeft) + track.clientWidth / 2;
    let index = 0;
    let distance = Number.POSITIVE_INFINITY;
    slides.forEach((slide, candidate) => {
      const slideCenter = resolveSlideLeft(track, slide, candidate) + (Number(slide.offsetWidth) || track.clientWidth) / 2;
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

  function resolveFullscreenImagePresentation({
    naturalWidth = 0,
    naturalHeight = 0,
    availableWidth = 0,
    availableHeight = 0,
    preventUpscale = true,
    preventUpscaleMaxPixels = Number.POSITIVE_INFINITY,
  } = {}) {
    const width = Math.max(0, Number(naturalWidth) || 0);
    const height = Math.max(0, Number(naturalHeight) || 0);
    const viewportWidth = Math.max(0, Number(availableWidth) || 0);
    const viewportHeight = Math.max(0, Number(availableHeight) || 0);
    if (!width || !height || !viewportWidth || !viewportHeight) {
      return {
        known: false,
        preventUpscale: false,
        width: 0,
        height: 0,
      };
    }
    const pixelLimit = Number(preventUpscaleMaxPixels);
    const withinPolicy = !Number.isFinite(pixelLimit) || width * height <= Math.max(0, pixelLimit);
    const fit = Math.min(viewportWidth / width, viewportHeight / height);
    const shouldPreventUpscale = Boolean(preventUpscale) && withinPolicy && fit > 1;
    const scale = Math.min(1, fit);
    return {
      known: true,
      preventUpscale: shouldPreventUpscale,
      width: shouldPreventUpscale ? width : Math.max(1, width * scale),
      height: shouldPreventUpscale ? height : Math.max(1, height * scale),
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
.vpg-edge-rubber-band-dragging{will-change:transform;transition:none!important}
.vpg-edge-rubber-band-returning{will-change:transform;transition:transform 180ms cubic-bezier(.22,.8,.32,1)!important}
`;
    doc.head.appendChild(style);
  }

  function ensureFullscreenControlStyles(doc) {
    if (!doc?.createElement || !doc?.head || doc.getElementById?.(fullscreenControlStyleId)) return;
    const style = doc.createElement("style");
    style.id = fullscreenControlStyleId;
    style.textContent = `
.vpg-fullscreen-control,.vpg-fullscreen-close,.vpg-fullscreen-nav{border:1px solid rgba(255,255,255,.28);border-radius:10px;color:#fff;background:rgba(8,15,13,.62);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);transition:background-color .14s ease,border-color .14s ease,opacity .14s ease;-webkit-tap-highlight-color:transparent}
.vpg-fullscreen-control:hover,.vpg-fullscreen-close:hover,.vpg-fullscreen-nav:hover{border-color:rgba(255,255,255,.44);background:rgba(8,15,13,.78)}
.vpg-fullscreen-control:active,.vpg-fullscreen-close:active,.vpg-fullscreen-nav:active{border-color:rgba(255,255,255,.36);background:rgba(8,15,13,.88)}
.vpg-fullscreen-control:focus-visible,.vpg-fullscreen-close:focus-visible,.vpg-fullscreen-nav:focus-visible{outline:2px solid rgba(255,255,255,.9);outline-offset:2px}
.vpg-fullscreen-control:disabled,.vpg-fullscreen-close:disabled,.vpg-fullscreen-nav:disabled{opacity:.42}
`;
    doc.head.appendChild(style);
  }

  function mergeSelectors(custom) {
    return { ...defaults, ...(custom || {}) };
  }

  function createEdgeRubberBandController(options = {}) {
    const track = options.track;
    const getSlides = typeof options.getSlides === "function"
      ? options.getSlides
      : () => Array.from(options.slides || track?.children || []);
    const scheduleTimer = options.setTimeout || setTimeout;
    const cancelTimer = options.clearTimeout || clearTimeout;
    const resistance = Math.max(0.05, Math.min(0.5, Number(options.resistance) || 0.24));
    const maxOffset = Math.max(12, Math.min(72, Number(options.maxOffset) || 44));
    let gesture = null;
    let release = null;
    let destroyed = false;
    const allowed = (event) => !options.disabled && options.canRubberBand?.(event) !== false;
    const computedStyle = options.getComputedStyle || ((element) => element?.ownerDocument?.defaultView?.getComputedStyle?.(element));
    const doc = track?.ownerDocument;
    if (!options.disabled && doc?.head && doc.createElement && !doc.getElementById?.(edgeStyleId)) {
      const style = doc.createElement("style");
      style.id = edgeStyleId;
      style.textContent = ".vpg-edge-content-dragging{will-change:translate;transition:none!important}.vpg-edge-content-returning{will-change:translate;transition:translate 180ms cubic-bezier(.22,.8,.32,1)!important}";
      doc.head.appendChild(style);
    }

    function translation(element) {
      const value = computedStyle(element)?.translate || element?.style?.translate || "none";
      if (value === "none") return { x: 0, y: 0 };
      const parts = value.trim().split(/\s+/);
      if (!parts.every((part) => /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/.test(part))) return null;
      return { x: Number.parseFloat(parts[0]) || 0, y: Number.parseFloat(parts[1]) || 0 };
    }

    function restore(state) {
      const content = state?.content;
      if (!content) return;
      edgePresentations.delete(content);
      content.classList?.remove("vpg-edge-content-dragging", "vpg-edge-content-returning");
      if (!content.style) return;
      if (state.previousTranslate) content.style.translate = state.previousTranslate;
      else content.style.removeProperty?.("translate");
    }

    function clear() {
      if (release) cancelTimer(release.timer);
      restore(release);
      restore(gesture);
      release = null;
      gesture = null;
    }

    function finish() {
      const ended = gesture;
      gesture = null;
      if (!ended) return false;
      if (!ended.moved || !ended.content?.style) {
        restore(ended);
        return false;
      }
      ended.content.classList?.remove("vpg-edge-content-dragging");
      ended.content.classList?.add("vpg-edge-content-returning");
      ended.content.style.translate = `${ended.base.x}px ${ended.base.y}px`;
      const pending = { ...ended, timer: 0 };
      pending.timer = scheduleTimer(() => {
        if (release !== pending) return;
        restore(pending);
        release = null;
      }, 220);
      release = pending;
      return true;
    }

    const onTouchStart = (event) => {
      const returning = release;
      const rendered = returning ? translation(returning.content) : null;
      clear();
      if (destroyed || !allowed(event) || event.touches?.length !== 1) return;
      const slides = getSlides();
      if (!slides.length) return;
      // Requested/app indices can lag a native swipe or point at a still-loading image.
      const index = resolveActiveIndex(track, slides);
      const slide = slides[index];
      // Move content, never the snap target. Transforming the slide changes its
      // snap area and lets the browser snap while a return animation is running.
      const content = slide?.firstElementChild;
      if (!content?.style) return;
      const base = translation(content);
      if (!base) return;
      const left = resolveSlideLeft(track, slide, index);
      const aligned = Math.abs((Number(track?.scrollLeft) || 0) - left) <= 2;
      const atStart = aligned && index === 0;
      const atEnd = aligned && index === slides.length - 1;
      if (!atStart && !atEnd) return;
      gesture = {
        side: atStart && atEnd ? "both" : atStart ? "start" : "end",
        startX: Number(event.touches[0].clientX) || 0,
        startY: Number(event.touches[0].clientY) || 0,
        identifier: event.touches[0].identifier,
        previousTranslate: content.style.translate || "",
        content,
        base,
        initialOffset: returning?.content === content && rendered ? rendered.x - base.x : 0,
        slide,
        left,
        moved: false,
      };
      edgePresentations.set(content, { previousTranslate: gesture.previousTranslate, clear });
      if (gesture.initialOffset) {
        content.classList?.add("vpg-edge-content-dragging");
        content.style.translate = `${base.x + gesture.initialOffset}px ${base.y}px`;
        gesture.moved = true;
      }
    };
    const onTouchMove = (event) => {
      if (!gesture) return;
      // Never add a second motion once Safari or the application's zoom owns it.
      if (event.touches?.length !== 1 || !allowed(event) || event.cancelable === false || event.defaultPrevented) {
        clear();
        return;
      }
      const point = Array.from(event.touches).find((touch) => touch.identifier === gesture.identifier);
      if (!point) { clear(); return; }
      const dx = (Number(point.clientX) || 0) - gesture.startX;
      const dy = (Number(point.clientY) || 0) - gesture.startY;
      const outward = gesture.side === "both" || (gesture.side === "start" ? dx > 0 : dx < 0);
      if (!gesture.moved) {
        if (Math.hypot(dx, dy) < 7) return;
        if (!outward || Math.abs(dx) <= Math.abs(dy) * 1.05
          || Math.abs((Number(track?.scrollLeft) || 0) - gesture.left) > 2) {
          clear();
          return;
        }
      }
      // After capture, reversal belongs to this gesture until release. Handing it
      // back midway causes a native jump while the old transform is still painted.
      event.preventDefault?.();
      const requestedOffset = gesture.initialOffset + dx * resistance;
      const offset = gesture.side === "start" ? clamp(requestedOffset, 0, maxOffset)
        : gesture.side === "end" ? clamp(requestedOffset, -maxOffset, 0)
        : clamp(requestedOffset, -maxOffset, maxOffset);
      gesture.content.classList?.add("vpg-edge-content-dragging");
      gesture.content.style.translate = `${gesture.base.x + offset}px ${gesture.base.y}px`;
      gesture.moved = true;
    };
    const onTouchEnd = (event) => {
      if (finish()) event.preventDefault?.();
    };
    const onTouchCancel = () => clear();

    if (!options.manual) {
      track?.addEventListener?.("touchstart", onTouchStart, { passive: true });
      track?.addEventListener?.("touchmove", onTouchMove, { passive: false });
      track?.addEventListener?.("touchend", onTouchEnd, { passive: false });
      track?.addEventListener?.("touchcancel", onTouchCancel, { passive: true });
    }

    return {
      clear,
      setOffset(index, offset) {
        if (destroyed || !options.manual) return;
        const content = getSlides()[index]?.firstElementChild;
        if (!offset || !content?.style) { clear(); return; }
        if (gesture?.content !== content) {
          clear();
          const base = translation(content);
          if (!base) return;
          gesture = { content, base, previousTranslate: content.style.translate || "" };
          edgePresentations.set(content, { previousTranslate: gesture.previousTranslate, clear });
        }
        content.classList?.add("vpg-edge-content-dragging");
        content.style.translate = `${gesture.base.x + clamp(offset, -maxOffset, maxOffset)}px ${gesture.base.y}px`;
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        clear();
        track?.removeEventListener?.("touchstart", onTouchStart, { passive: true });
        track?.removeEventListener?.("touchmove", onTouchMove, { passive: false });
        track?.removeEventListener?.("touchend", onTouchEnd, { passive: false });
        track?.removeEventListener?.("touchcancel", onTouchCancel, { passive: true });
      },
    };
  }

  function createControlledTouchPaging(options) {
    const { track, slides, edge } = options;
    const win = options.windowRef || global;
    const raf = options.requestAnimationFrame || win.requestAnimationFrame?.bind(win) || ((fn) => setTimeout(fn, 16));
    const caf = options.cancelAnimationFrame || win.cancelAnimationFrame?.bind(win) || clearTimeout;
    const now = options.now || (() => win.performance?.now?.() ?? Date.now());
    const leftAt = (index) => resolveSlideLeft(track, slides[index], index);
    const last = () => Math.max(0, slides.length - 1);
    const max = () => leftAt(last());
    const resistance = clamp(options.edgeResistance ?? 0.24, 0.05, 0.5);
    const edgeLimit = clamp(options.edgeMaxOffset ?? 44, 12, 72);
    let position = leftAt(clamp(options.initialIndex, 0, last()));
    let frame = null, generation = 0, gesture = null, settling = false, destroyed = false;
    let suppressClick = false;
    const nearest = () => {
      let index = 0, distance = Infinity;
      slides.forEach((slide, i) => {
        const next = Math.abs(leftAt(i) - position);
        if (next < distance) { distance = next; index = i; }
      });
      return index;
    };
    function paint(value, notify = true) {
      const token = generation;
      position = value;
      track.scrollLeft = clamp(position, 0, max());
      edge.setOffset(position < 0 ? 0 : last(), position < 0 ? -position : position > max() ? max() - position : 0);
      const index = nearest();
      options.onIndex(index, notify);
      if (!destroyed && token === generation) options.onTouchPagingPosition?.({ index, position, dragging: Boolean(gesture), settling });
    }
    function stop() {
      generation++;
      if (frame !== null) caf(frame);
      frame = null;
      settling = false;
      gesture = null;
      // A consumer can proxy a drag from navigation controls outside the track.
      // Adopt an actual external scroll write, but preserve logical edge offset
      // when physical scrollLeft still equals our own clamped painted position.
      const actual = clamp(track.scrollLeft, 0, max());
      if (Math.abs(actual - clamp(position, 0, max())) > 1) {
        position = actual;
        edge.clear();
      }
      return nearest();
    }
    function goTo(index, behavior = "smooth", notify = true) {
      if (destroyed) return nearest();
      stop();
      const target = clamp(index, 0, last()), to = leftAt(target), from = position;
      const token = generation;
      const reduced = options.reducedMotion ?? win.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      const finish = () => {
        settling = false; frame = null;
        paint(to, notify);
        if (token === generation && !destroyed) options.onTouchPagingSettle?.({ index: target, position });
      };
      if (behavior !== "smooth" || reduced || Math.abs(to - from) < 0.5) { finish(); return target; }
      settling = true;
      const started = now();
      const step = () => {
        if (destroyed || token !== generation) return;
        const progress = clamp((now() - started) / 260, 0, 1);
        if (progress >= 1) { finish(); return; }
        paint(from + (to - from) * (1 - Math.pow(1 - progress, 3)), notify);
        if (!destroyed && token === generation) frame = raf(step);
      };
      frame = raf(step);
      return target;
    }
    const allowed = (event) => options.canTouchPage?.(event) !== false;
    const point = (touches, id) => Array.from(touches || []).find((touch) => touch.identifier === id);
    const start = (event) => {
      const index = stop(), token = generation;
      suppressClick = false;
      options.onTouchPagingStart?.({ index, position, event });
      if (destroyed || token !== generation || event.touches?.length !== 1 || !allowed(event)) return;
      const p = event.touches[0];
      gesture = { id: p.identifier, x: p.clientX, y: p.clientY, base: position, index,
        rawBase: position < 0 ? position / resistance : position > max() ? max() + (position - max()) / resistance : position,
        lastX: p.clientX, lastTime: now(), velocity: 0, axis: null };
    };
    const move = (event) => {
      if (!gesture) return;
      if (event.touches?.length !== 1 || !allowed(event)) { stop(); return; }
      const p = point(event.touches, gesture.id);
      if (!p) { stop(); return; }
      const dx = p.clientX - gesture.x, dy = p.clientY - gesture.y;
      if (!gesture.axis && Math.hypot(dx, dy) >= 7) gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.05 ? "x" : "y";
      if (gesture.axis !== "x") return;
      if (event.cancelable !== false) event.preventDefault?.();
      suppressClick = true;
      const time = now(), elapsed = time - gesture.lastTime;
      if (elapsed > 0) gesture.velocity = (gesture.lastX - p.clientX) / elapsed;
      gesture.lastX = p.clientX; gesture.lastTime = time;
      let next = gesture.rawBase - dx;
      if (next < 0) next = -Math.min(edgeLimit, -next * resistance);
      else if (next > max()) next = max() + Math.min(edgeLimit, (next - max()) * resistance);
      next = clamp(next, gesture.index === 0 ? -edgeLimit : leftAt(gesture.index - 1),
        gesture.index === last() ? max() + edgeLimit : leftAt(gesture.index + 1));
      paint(next);
    };
    const end = (event) => {
      if (!gesture) return;
      const ended = gesture;
      gesture = null;
      if (event.touches?.length || !allowed(event)) { stop(); return; }
      if (ended.axis !== "x") { goTo(nearest(), "smooth"); return; }
      if (event.cancelable !== false) event.preventDefault?.();
      const delta = position - ended.base;
      const fast = now() - ended.lastTime <= 100 && Math.abs(ended.velocity) >= 0.35 && Math.abs(delta) >= 12;
      const far = Math.abs(delta) >= Math.max(28, (Number(track.clientWidth) || 360) * 0.22);
      const direction = fast ? Math.sign(ended.velocity) : Math.sign(delta);
      const target = fast || far ? ended.index + direction : nearest();
      goTo(clamp(target, Math.max(0, ended.index - 1), Math.min(last(), ended.index + 1)), "smooth");
    };
    const cancel = () => {
      // A pinch already owns the gesture after multitouch takeover. Its cancel
      // must not snap the track or emit a spurious paging Settle callback.
      if (!gesture && !settling) return;
      const index = stop(); goTo(index, "auto");
    };
    const click = (event) => {
      if (!suppressClick) return;
      suppressClick = false; event.preventDefault?.(); event.stopImmediatePropagation?.();
    };
    const listeners = [["touchstart", start, { capture: true, passive: true }],
      ["touchmove", move, { capture: true, passive: false }],
      ["touchend", end, { capture: true, passive: false }],
      ["touchcancel", cancel, { capture: true, passive: true }],
      ["click", click, { capture: true }]];
    listeners.forEach(([type, fn, config]) => track.addEventListener?.(type, fn, config));
    // Initialization has no callbacks: applications often finish declaring their
    // pinch/image state only after createFullscreenSwitcher has returned.
    track.scrollLeft = clamp(position, 0, max());
    return { goTo, stop, get position() { return position; }, get isSettling() { return settling; },
      destroy() { destroyed = true; stop(); edge.clear(); listeners.forEach(([type, fn, config]) => track.removeEventListener?.(type, fn, config)); } };
  }

  function createFullscreenSwitcher(options = {}) {
    const root = options.root;
    const track = options.track;
    const slides = Array.from(options.slides || track?.children || []);
    const directDesktop = options.directDesktop ?? isDirectDesktop(options.windowRef || global);
    const controlled = options.touchPaging === "controlled" && !directDesktop;
    let activeIndex = clamp(options.initialIndex, 0, Math.max(0, slides.length - 1));
    let presentedIndex = activeIndex;
    let presentationGeneration = 0;
    let presentationController = null;
    const waitForReady = options.waitForReady === true;
    let destroyed = false;
    let edgeRubberBand = null;
    let paging = null;
    const pagingStyles = [];

    const doc = root?.ownerDocument || track?.ownerDocument || global.document;
    ensureStyles(doc);
    ensureFullscreenControlStyles(doc);
    root?.classList?.add("vpg-fullscreen");
    root?.classList?.toggle("vpg-direct-desktop", directDesktop);
    track?.classList?.add("vpg-fullscreen-track");
    slides.forEach((slide) => slide.classList?.add("vpg-fullscreen-slide"));
    if (controlled) {
      root?.classList?.add("vpg-controlled-touch");
      // Inline important also wins against consumer-specific important rules.
      // Restore exact values/priorities when this binding is destroyed.
      for (const [property, value] of Object.entries({
        "overflow-x": "hidden", "overflow-y": "hidden", "touch-action": "none",
        "scroll-snap-type": "none", "scroll-behavior": "auto", "overscroll-behavior-x": "none", "overscroll-behavior-y": "none",
        "-webkit-overflow-scrolling": "auto",
      })) {
        if (!track?.style?.setProperty) continue;
        pagingStyles.push([property, track.style.getPropertyValue(property), track.style.getPropertyPriority(property)]);
        track.style.setProperty(property, value, "important");
      }
      if (doc?.head && doc.createElement && !doc.getElementById?.(pagingStyleId)) {
        const style = doc.createElement("style");
        style.id = pagingStyleId;
        style.textContent = ".vpg-fullscreen.vpg-controlled-touch .vpg-fullscreen-track{overflow:hidden!important;scroll-snap-type:none!important;scroll-behavior:auto!important;touch-action:none!important;overscroll-behavior:none!important;-webkit-overflow-scrolling:auto!important}";
        doc.head.appendChild(style);
      }
    }

    function renderPresentation() {
      slides.forEach((slide, candidate) => {
        const active = candidate === presentedIndex;
        slide.classList?.toggle("vpg-fullscreen-active", active);
        if (directDesktop) slide.setAttribute?.("aria-hidden", active ? "false" : "true");
        else slide.removeAttribute?.("aria-hidden");
      });
    }

    function cancelPresentation() {
      presentationGeneration += 1;
      presentationController?.abort();
      presentationController = null;
    }

    function render(index, notify = true) {
      if (destroyed) return activeIndex;
      const previousIndex = activeIndex;
      activeIndex = clamp(index, 0, Math.max(0, slides.length - 1));
      if (activeIndex !== previousIndex) {
        cancelPresentation();
        if (!controlled) edgeRubberBand?.clear();
      }
      if (!directDesktop || !waitForReady) presentedIndex = activeIndex;
      renderPresentation();
      if (notify && typeof options.onActiveIndexChange === "function") {
        options.onActiveIndexChange({ root, track, slides, index: activeIndex, directDesktop });
      }
      return activeIndex;
    }

    // The application resolves/decodes/sizes its image; the shared switcher
    // owns retention of the last bitmap, latest-request wins, and disposal.
    // render/goTo/resize cannot expose an unready desktop slide in this mode.
    async function activate(index, prepare, { behavior = "smooth", notify = true, scroll = true } = {}) {
      if (destroyed || !slides.length) return false;
      render(index, notify);
      cancelPresentation();
      const generation = presentationGeneration;
      const requestedIndex = activeIndex;
      const controller = createAbortController();
      presentationController = controller;
      if (scroll) scrollActiveIntoPlace(behavior);
      let ready = false;
      try {
        ready = typeof prepare === "function" && await prepare({
          index: requestedIndex,
          slide: slides[requestedIndex],
          signal: controller.signal,
        }) === true;
      } catch (error) {
        if (!controller.signal.aborted && typeof options.onPresentationError === "function") {
          options.onPresentationError(error, { index: requestedIndex });
        }
      }
      if (destroyed || controller.signal.aborted || generation !== presentationGeneration) return false;
      presentationController = null;
      if (!ready) return false;
      const previousIndex = presentedIndex;
      presentedIndex = requestedIndex;
      renderPresentation();
      if (typeof options.onPresented === "function") {
        options.onPresented({ index: presentedIndex, previousIndex, slide: slides[presentedIndex] });
      }
      return true;
    }

    function activeSlideLeft() {
      const slide = slides[activeIndex];
      if (!slide) return 0;
      return resolveSlideLeft(track, slide, activeIndex);
    }

    function scrollActiveIntoPlace(behavior = "auto", force = false) {
      if (destroyed || directDesktop || !track || !slides[activeIndex]) return activeIndex;
      if (paging) return paging.goTo(activeIndex, behavior);
      const left = activeSlideLeft();
      track.scrollTo?.({ left, behavior });
      if (force && Math.abs((Number(track.scrollLeft) || 0) - left) > 1) {
        track.scrollLeft = left;
      }
      return activeIndex;
    }

    function goTo(index, behavior = "smooth", notify = true) {
      if (paging) return paging.goTo(index, behavior, notify);
      const next = render(index, notify);
      scrollActiveIntoPlace(behavior);
      return next;
    }

    edgeRubberBand = createEdgeRubberBandController({
      track,
      slides,
      getActiveIndex: () => activeIndex,
      disabled: directDesktop,
      manual: controlled,
      canRubberBand: options.canRubberBand,
      getComputedStyle: options.getComputedStyle,
      resistance: options.edgeResistance,
      maxOffset: options.edgeMaxOffset,
      setTimeout: options.setTimeout,
      clearTimeout: options.clearTimeout,
    });
    if (controlled) paging = createControlledTouchPaging({
      ...options, track, slides, edge: edgeRubberBand,
      onIndex: (index, notify) => render(index, notify && index !== activeIndex),
    });

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelPresentation();
      paging?.destroy();
      pagingStyles.forEach(([property, value, priority]) => {
        if (value) track.style.setProperty(property, value, priority);
        else track.style.removeProperty(property);
      });
      edgeRubberBand?.destroy();
      root?.classList?.remove("vpg-fullscreen", "vpg-direct-desktop", "vpg-controlled-touch");
      track?.classList?.remove("vpg-fullscreen-track");
      slides.forEach((slide) => {
        slide.classList?.remove("vpg-fullscreen-slide", "vpg-fullscreen-active");
        slide.removeAttribute?.("aria-hidden");
      });
    }

    render(activeIndex, false);
    return {
      directDesktop,
      touchPaging: controlled ? "controlled" : "native",
      get position() { return paging?.position ?? Number(track?.scrollLeft || 0); },
      get isSettling() { return paging?.isSettling ?? false; },
      stopTouchPaging: () => paging?.stop(),
      get activeIndex() { return activeIndex; },
      get presentedIndex() { return presentedIndex; },
      activate,
      goTo,
      render,
      settle: () => scrollActiveIntoPlace("auto", true),
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

  function fullscreenAbortError(message = "Fullscreen image replacement was aborted") {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
  }

  function throwIfFullscreenAborted(signal) {
    if (signal?.aborted) throw fullscreenAbortError();
  }

  function normalizeFullscreenImageSource(value, image) {
    const source = String(value || "");
    if (!source) return "";
    const Url = global.URL;
    if (typeof Url !== "function") return source;
    try {
      return new Url(source, image?.ownerDocument?.baseURI || global.document?.baseURI).href;
    } catch {
      return source;
    }
  }

  function fullscreenImageUsesSource(image, src) {
    const expected = normalizeFullscreenImageSource(src, image);
    const actual = normalizeFullscreenImageSource(
      image?.currentSrc || image?.src || image?.getAttribute?.("src"),
      image,
    );
    return Boolean(expected && actual === expected);
  }

  async function decodeFullscreenImage(image, { signal } = {}) {
    throwIfFullscreenAborted(signal);
    if (typeof image?.decode === "function") await image.decode();
    throwIfFullscreenAborted(signal);
    if ("complete" in image && image.complete !== true) {
      throw new Error("fullscreen-image-not-complete");
    }
    if ("naturalWidth" in image && Number(image.naturalWidth) <= 0) {
      throw new Error("fullscreen-image-decode-empty");
    }
    return image;
  }

  function loadAndDecodeFullscreenImage(image, src, {
    signal,
    decode = decodeFullscreenImage,
  } = {}) {
    return new Promise((resolve, reject) => {
      if (!image || !src) {
        reject(new Error("fullscreen-image-load-missing"));
        return;
      }
      if (signal?.aborted) {
        reject(fullscreenAbortError());
        return;
      }
      let settled = false;
      const cleanup = () => {
        image.removeEventListener?.("load", onLoad);
        image.removeEventListener?.("error", onError);
        signal?.removeEventListener?.("abort", onAbort);
      };
      const finish = async () => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          throwIfFullscreenAborted(signal);
          await decode(image, { signal });
          throwIfFullscreenAborted(signal);
          if (!fullscreenImageUsesSource(image, src)) {
            throw new Error("fullscreen-image-source-not-selected");
          }
          resolve(image);
        } catch (error) {
          reject(error);
        }
      };
      const onLoad = () => { void finish(); };
      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("fullscreen-image-load-failed"));
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(fullscreenAbortError());
      };
      image.addEventListener?.("load", onLoad, { once: true });
      image.addEventListener?.("error", onError, { once: true });
      signal?.addEventListener?.("abort", onAbort, { once: true });
      image.src = String(src);
      if (image.complete) {
        if (!("naturalWidth" in image) || Number(image.naturalWidth) > 0) void finish();
        else onError();
      }
    });
  }

  function afterFullscreenImagePaint() {
    if (typeof global.requestAnimationFrame !== "function") return Promise.resolve();
    return new Promise((resolve) => {
      global.requestAnimationFrame(() => global.requestAnimationFrame(resolve));
    });
  }

  async function replaceFullscreenImageSource(currentImage, src, options = {}) {
    if (!currentImage || !src) throw new Error("fullscreen-image-replacement-missing");
    const createReplacement = options.createReplacement
      || ((image) => image.cloneNode(false));
    const loadAndDecode = options.loadAndDecode || loadAndDecodeFullscreenImage;
    const decode = options.decode || decodeFullscreenImage;
    const afterPaint = options.afterPaint || afterFullscreenImagePaint;
    const shouldCommit = options.shouldCommit || (() => true);
    const onReplaced = options.onReplaced || (() => {});
    const onRollback = options.onRollback || (() => {});
    const signal = options.signal;
    const replacement = createReplacement(currentImage);
    if (!replacement || replacement === currentImage) {
      throw new Error("fullscreen-image-replacement-must-be-detached");
    }
    // cloneNode copies transient edge classes/styles. The detached replacement
    // must start at the application's baseline even if decode outlives the drag.
    const edgePresentation = edgePresentations.get(currentImage);
    const clonedEdge = replacement.classList?.contains?.("vpg-edge-content-dragging")
      || replacement.classList?.contains?.("vpg-edge-content-returning");
    replacement.classList?.remove("vpg-edge-content-dragging", "vpg-edge-content-returning");
    if ((edgePresentation || clonedEdge) && replacement.style) {
      // Adapters can pre-create the clone during decode and hand it back after
      // the old edge controller has already restored and forgotten the gesture.
      const baseline = edgePresentation ? edgePresentation.previousTranslate : currentImage.style?.translate;
      if (baseline) replacement.style.translate = baseline;
      else replacement.style.removeProperty?.("translate");
    }
    replacement.removeAttribute?.("src");
    replacement.removeAttribute?.("srcset");
    replacement.removeAttribute?.("sizes");
    replacement.removeAttribute?.("loading");
    replacement.decoding = "async";
    throwIfFullscreenAborted(signal);
    await loadAndDecode(replacement, src, { signal, decode });
    throwIfFullscreenAborted(signal);
    if (!fullscreenImageUsesSource(replacement, src)) {
      throw new Error("fullscreen-image-source-not-selected");
    }
    if (await shouldCommit({ phase: "before-replace", currentImage, replacement, src, signal }) === false) {
      throw new Error("fullscreen-image-replacement-superseded");
    }
    throwIfFullscreenAborted(signal);
    edgePresentations.get(currentImage)?.clear();
    currentImage.replaceWith(replacement);
    try {
      await onReplaced(replacement, { currentImage, src, signal });
      await afterPaint({ currentImage, replacement, src, signal });
      throwIfFullscreenAborted(signal);
      if (await shouldCommit({ phase: "after-paint", currentImage, replacement, src, signal }) === false) {
        throw new Error("fullscreen-image-replacement-superseded");
      }
      await decode(replacement, { signal });
      throwIfFullscreenAborted(signal);
      if (!fullscreenImageUsesSource(replacement, src)) {
        throw new Error("fullscreen-image-source-not-visible");
      }
    } catch (error) {
      if (replacement.isConnected && !currentImage.isConnected) {
        replacement.replaceWith(currentImage);
        try {
          await onRollback(currentImage, { replacement, src, signal, error });
        } catch {
          // Rollback observers cannot hide the original replacement failure.
        }
      }
      throw error;
    }
    return replacement;
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
    let edgeRubberBand = null;

    const listen = (target, type, listener, listenerOptions) => {
      target.addEventListener(type, listener, listenerOptions);
      listeners.push(() => target.removeEventListener(type, listener, listenerOptions));
    };

    function collect() {
      edgeRubberBand?.clear();
      slides = Array.from(track.querySelectorAll(selectors.slide));
      dots = Array.from(gallery.querySelectorAll(selectors.dot));
      gallery.classList.toggle("vpg-has-dots", dots.length > 1);
      activeIndex = clamp(activeIndex, 0, Math.max(0, slides.length - 1));
      updateDots(activeIndex, false);
    }

    function updateDots(nextIndex, notify = true) {
      const previousIndex = activeIndex;
      activeIndex = clamp(nextIndex, 0, Math.max(0, slides.length - 1));
      if (activeIndex !== previousIndex) edgeRubberBand?.clear();
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
        const reachedTarget = Boolean(target) && Math.abs(track.scrollLeft - resolveSlideLeft(track, target, pendingScrollIndex)) <= 1;
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
      track.scrollTo({ left: resolveSlideLeft(track, slide, next), behavior });
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

    edgeRubberBand = createEdgeRubberBandController({
      track,
      getSlides: () => slides,
      getActiveIndex: () => activeIndex,
      canRubberBand: options.canRubberBand,
      getComputedStyle: options.getComputedStyle,
      resistance: options.edgeResistance,
      maxOffset: options.edgeMaxOffset,
      setTimeout: options.setTimeout,
      clearTimeout: options.clearTimeout,
    });

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
        if (!gesture.vertical) scrollToIndex(resolveActiveIndex(track, slides));
      }
    }, { passive: false });

    listen(track, "touchcancel", () => {
      const canceled = touch;
      touch = null;
      suppressClickUntil = Date.now() + 300;
      if (!canceled) return;
      const gesture = resolveSwipe(
        canceled.x, canceled.y, canceled.lastX, canceled.lastY, options.swipeThreshold,
      );
      if (!gesture.vertical) scrollToIndex(resolveActiveIndex(track, slides));
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
        edgeRubberBand?.destroy();
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
    capabilities: Object.freeze({
      fullscreenSourceLifecycle: 1,
      safeFullscreenImageReplace: 1,
      fullscreenControlStyles: 1,
      fullscreenImagePresentation: 1,
      fullscreenEdgeSettling: 2,
      fullscreenEdgeRubberBand: 2,
      readyFullscreenNavigation: 1,
      controlledTouchPaging: 1,
    }),
    bindInlineGalleries,
    createFullscreenSourceController,
    createFullscreenSwitcher,
    decodeFullscreenImage,
    destroyInlineGalleries,
    ensureFullscreenControlStyles,
    ensureStyles,
    fullscreenImageUsesSource,
    loadAndDecodeFullscreenImage,
    replaceFullscreenImageSource,
    helpers: Object.freeze({
      clamp,
      isDirectDesktop,
      resolveActiveIndex,
      resolveSlideLeft,
      resolveNavigationIndex,
      resolveFullscreenImagePresentation,
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
