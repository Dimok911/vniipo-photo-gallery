# VNIIPO Photo Gallery

[English](#english) | [Русский](#русский)

## English

Framework-agnostic runtime for inline photo galleries shared by OVIK, Bikepacking, WIC, and future applications.

## Browser contract

### Compositor settling candidate (2.4.1, pending device evaluation)

This candidate keeps the 2.4.0 held-drag path and existing explicit transform
opt-in. Fractional release speed uses touch event timestamps, a 60ms history,
an 8px reversal threshold and continuous decay during a stationary hold.
Delayed delivery cannot turn the same physical input into a much faster flick,
and a one-pixel reversal cannot send the gallery toward the opposite neighbor.

Settling uses a transform Web Animation with the same monotonic Hermite curve
expressed as cubic-bezier. Its start time is aligned with the document timeline
to avoid an extra pending-start frame. JavaScript still updates index callbacks
once per RAF, but no longer writes the strip transform or reads computed layout
on each settle frame. The position getter follows animation time. New gestures
sample the actual computed transform once, freeze it and cancel the animation
before the application handles pinch. Completion/destroy/resize retain generation
cancellation, image identity and reduced-motion behavior. Browsers without the
required animation/matrix APIs use the cancellable RAF fallback.

[Investigation and limitations](docs/controlled-motion-investigation.md) describe
measured delivery/release defects, compositor evidence, and why this is a test
candidate rather than confirmation that physical iPhone swiping is fixed.
Production publication for device evaluation requires review and CI; it does not
constitute user acceptance. No Experiment transfer is approved.

### Fractional strip presentation (2.4.0)

Negotiate `capabilities.controlledTouchPaging >= 2` and pass both
`touchPaging: "controlled"` and `touchPagingPresentation: "transform"`. The
returned `touchPagingPresentation` is `"transform"` only when this mode is active.
Without the new option, controlled consumers retain the 2.3 scrollLeft behavior;
native scrolling remains the default. This lets stable update before adapters.

The track is a fixed `overflow: clip` viewport. A new `.vpg-controlled-strip`
inside it holds the original slide nodes and translates by fractional CSS pixels.
The strip is positioned, flex, width/height 100%, with no shrinking; slide sizing
remains the adapter's responsibility. Avoid direct-child track/slide selectors.
Image transforms, sizes, sources and node identities are untouched. Bounded edge
overshoot moves this strip too, without a second image translation. Destroy
restores slide order using placeholders and restores previous inline policies.

Moves record only the latest logical coordinate and paint at most once per RAF.
`position` includes pending input; `activeIndex` and Position callbacks follow
painted frames. `stopTouchPaging()` synchronously flushes pending input, cancels
RAF/settling and returns the nearest index, without a Settle callback. Touch start
capture does this before Start callbacks and application pinch handlers. A new
two-finger gesture cannot be overwritten by an old drag/settle frame. End, explicit
navigation and layout refresh may flush synchronously at their boundaries.

```js
const switcher = VniipoPhotoGallery.createFullscreenSwitcher({
  root, track, slides, directDesktop: false,
  touchPaging: "controlled", touchPagingPresentation: "transform",
  canTouchPage: () => scale <= 1 && !pinching,
  onTouchPagingStart, onTouchPagingPosition, onTouchPagingSettle,
});
const unbind = switcher.bindTouchPagingTarget(nextButton);
// Before pinch selects an image (capture already does this for bound targets):
const index = switcher.stopTouchPaging();
switcher.goTo(index, "instant");
// After application layout changes:
switcher.refreshTouchPagingLayout();
```

`bindTouchPagingTarget(element)` installs the same capture touch handling on
external navigation controls and suppresses the click after a horizontal drag.
Taps retain their normal click. It sets touch-action none, returns an idempotent
unbind function, and automatically removes handlers/restores styles on destroy.
Binding nested targets does not process an event twice. The application still
owns click navigation and pinch/pan eligibility.

`refreshTouchPagingLayout()` stops motion, measures geometry, aligns the nearest
index from the old layout in the new layout, and emits Settle. `viewportWidth`
returns cached CSS pixels. A ResizeObserver automatically handles width changes;
height-only changes preserve motion. Adapters may refresh explicitly after their
own sizing. Use controller position/width instead of track.scrollLeft, disable
native scroll/settle paths, and use bound controls instead of writing scrollLeft.
Continue freezing image/source work during gestures and shared settling.

Regression coverage includes latest-input RAF batching, pending-input pinch,
reentrant navigation/destroy, fast release/reversal/edges, proxy controls and
resize. WebKit tests verify 12 distinct image rectangles and raster samples for
0.2 CSS-pixel input steps. These checks do not measure physical iPhone FPS.

### Responsive controlled paging (2.3.1)

The controlled mode caches slide geometry at gesture/navigation boundaries and
only updates slide presentation classes when the visible index changes. Dragging
still paints the latest finger coordinate synchronously; it adds no extra RAF
queue. The animation loop no longer reads each slide's layout after writing its
scroll position. Geometry is refreshed for the next gesture/navigation after a
resize. Paging callbacks and the contract remain unchanged.

Release settling uses remaining distance and recent finger speed instead of a
fixed 260ms duration. A monotonic Hermite curve preserves bounded initial speed
and ends at rest, with 70–220ms settling; navigation buttons and edge return use
a 100–220ms ease-out. One-slide limits, edge resistance, reduced motion and
immediate new-pinch cancellation remain in force. Adapters need no new API;
they should continue avoiding repeated expensive work when a position callback's
visible index has not changed.

Regression checks count layout reads and class changes during a 38-slide browser
drag, exercise fast/slow release and short remaining distance, compare simulated
60/120Hz cadence, and retain the new-pinch-during-settle checks. These are
deterministic work/behavior checks, not physical-device frame-rate claims.

### Interruptible controlled touch paging (2.3.0)

Opt in with `touchPaging: "controlled"`, `directDesktop: false`, and negotiate
`capabilities.controlledTouchPaging >= 1`. Native touch scrolling remains the
default for every other consumer. This mode avoids platform momentum entirely:
the track uses `overflow: hidden`, `touch-action: none`, no scroll snapping, and
no native smooth scrolling. Inline important policies override consumer CSS and
their previous values/priorities are restored on destroy.

The shared runtime drags and settles the existing image strip using synchronous
`scrollLeft` updates and a cancellable animation frame loop. It does not replace,
load, or resize images. A short fast flick advances one slide; an individual drag
cannot skip more than one slide or wrap. The shared content edge effect retains
its bounded resistance, with its return driven by the same cancellable loop.
Reduced motion makes settling immediate.

Every new `touchstart`, including a new two-finger gesture **after releasing a
swipe while its settle is still running**, cancels motion in capture phase before
application bubble handlers. Adding a second finger during a held drag also
hands control to the application. The application owns pinch, pan, image sources,
and when to align the visible slide for pinch; call `goTo(index, "instant")` for
that synchronous alignment. No constructor callback is emitted.

```js
const switcher = VniipoPhotoGallery.createFullscreenSwitcher({
  root, track, slides, initialIndex: 0, directDesktop: false,
  touchPaging: "controlled",
  canTouchPage: () => scale <= 1 && !pinching,
  onTouchPagingStart({ index, position, event }) { cancelAppSettleTimers(); },
  onTouchPagingPosition({ index, position, dragging, settling }) { updateDots(index); },
  onTouchPagingSettle({ index, position }) { prepareSelectedPhoto(index); },
});
switcher.goTo(1, "smooth"); // cancellable, including programmatic navigation
switcher.stopTouchPaging(); // stop at the currently painted position, no snap
switcher.goTo(switcher.activeIndex, "instant"); // cancel and align synchronously
```

`index`/`activeIndex` follow the nearest visible slide, not an animation's future
destination. `position` is logical pixels along the track and includes bounded
edge overshoot; physical `track.scrollLeft` stays clamped. `isSettling` is true
only during the shared animation. All callbacks are synchronous and never wait
for image readiness. `goTo` returns its clamped requested target; `auto` and
`instant` are immediate. `notify: false` (third positional argument of `goTo`)
suppresses the legacy `onActiveIndexChange`, not the paging lifecycle callbacks.
Consumer callbacks must not unconditionally call `goTo` again from `Settle`.

Adapters must disable their native scrollend/timer/touch navigation paths in this
mode, retain prepared adjacent previews, and avoid bitmap/source/size changes
while dragging or settling. A synchronous Settle may occur before the consumer's
bubble touchend handler, especially with reduced motion; adapters can defer their
own loading work until their gesture state is cleared. `stopTouchPaging` emits
no settle notification. Destroy cancels all pending frames and listeners.
Before a new touch, stop, or `goTo`, a consumer's external `scrollLeft` change
greater than one pixel is adopted as the current position. This supports proxy
drags on controls outside the track. Logical edge overshoot is retained when the
DOM still matches the controlled position; never enable native momentum for a
proxy drag, and cancel an existing animation before writing its position.

Motivation: WebKit intentionally suppresses DOM touches that interrupt platform
momentum ([WebKit 174300](https://bugs.webkit.org/show_bug.cgi?id=174300)).
The workaround avoids that momentum; synthetic browser regression tests cannot
certify physical iPhone behavior. The native default and desktop readiness
contract from 2.2 remain available.

### Native touch edge correction (2.2.1)

`capabilities.fullscreenEdgeRubberBand >= 2` preserves native fullscreen swipes.
The edge controller measures the visible track position, captures only an outward
cancelable gesture at an aligned edge, and never writes `scrollLeft`. Inward,
vertical, multi-touch, and already native-owned gestures cannot be recaptured.
Reversal after capture returns the offset toward zero without handing the same
gesture to native scrolling. `touchcancel` restores immediately.

Only the slide's first child receives a bounded CSS `translate`; the snap target
and the child's application-owned `transform` stay fixed. Touching during return
resumes the computed visual offset. Image replacement strips cloned edge state
and cancels the old content's effect before committing, including rollback.
Slides without a child or with non-pixel application `translate` use native edges.

Pass `canRubberBand: () => scale <= 1 && !pinching` to
`createFullscreenSwitcher` (or inline binding options) to exclude application zoom
and pan gestures. The callback runs on touch start and move. Contract 2 is
unchanged. Applications must still provide decoded adjacent previews before a
native swipe and avoid timer/resize snaps while a finger is down; publishing this
runtime alone cannot populate empty application slides.

Run `npm test`, `npm run build`, and `npm run test:browser`. Browser tests use
Playwright WebKit with a mobile viewport and synthesized touch events to verify
painted return offsets, stable native snap bounds, gesture ownership, and delayed
image readiness. They are not a physical iPhone or Safari beta certification.

Since 2.2.0, readiness-aware fullscreen presentation belongs to this shared
runtime. Applications provide their image sources and readiness signals rather
than duplicating the requested-versus-presented slide state machine.

### Ready fullscreen navigation (2.2.0)

Negotiate `capabilities.readyFullscreenNavigation >= 1` and create the switcher
with `waitForReady: true`. Use `activate(index, prepare, options)` for a new
selection. `prepare({ index, slide, signal })` loads, decodes, and sizes the
application's target image and returns exactly `true` when safe to display.
Return `false` or throw on failure. The switcher retains the previous desktop
slide, rejects obsolete completions (including same-index retries), and aborts
the signal on a new selection or destruction. `render`, `goTo`, and resize
cannot bypass readiness. `activeIndex` is the requested photo;
`presentedIndex` is the displayed photo. `onPresented` can align annotations or
other overlays with the actual displayed image.

```js
const switcher = VniipoPhotoGallery.createFullscreenSwitcher({
  root, track, slides, initialIndex: 0, waitForReady: true,
  onPresented: ({ index }) => updatePhotoOverlays(index),
});
await switcher.activate(nextIndex, async ({ index, signal }) => {
  await app.loadDecodeAndSizePhoto(index, signal);
  return true;
}, { notify: false });
```

Touch scrolling remains immediate/native. Pass `scroll: false` when the
application already owns native scrolling or calls `goTo` itself. This is a
one-time opt-in adapter migration: existing consumers keep contract 2 and the
legacy synchronous behavior until migrated. Future fixes to readiness and
atomic switching then live here. Never promise that publishing `stable.js`
alone migrates old application adapters. Keep a matching bundled fallback and
prefer it over an older cached stable script without the new capability.

2.2.0 also preserves the vertical-touch fix previously bundled as 2.1.8 in
Bike Packing: vertical page gestures must not snap the inline image track.

The stable script publishes `window.VniipoPhotoGallery`:

- `version`, `contractVersion`, and additive `capabilities`;
- `bindInlineGalleries(root, options)`;
- `createFullscreenSourceController(options)`;
- `createFullscreenSwitcher(options)`;
- `destroyInlineGalleries(root)`;
- pure gesture helpers under `helpers`.

The current contract is `2`. A gallery uses `[data-photo-gallery]`, a `.vpg-track`, `.vpg-slide` elements, and `[data-vpg-dot]` buttons. Pass `openLightbox({ image, gallery, index })` to retain application-specific full-size/offline photo resolution. Fullscreen viewers use `createFullscreenSwitcher`: desktop slides are replaced instantly, while touch devices retain their native horizontal swipe.

Release `2.0.1` keeps inline images contained without cropping, settles the
track after edge or interrupted swipes, and exposes `helpers.stepInertia` for
application fullscreen viewers. These additions preserve contract `2`.

Release `2.1.0` adds an application-neutral fullscreen source lifecycle while
preserving contract `2`. `createFullscreenSourceController` accepts preview,
verified-full, resolver, decoder, commit, and dispose callbacks. The selected
photo can therefore start directly from a verified local original; only its
original is decoded first, and adjacent originals are resolved and decoded
only after that active decode returns `true`. Repeated resolution/decode is
deduplicated, obsolete work is abortable, and disposable sources are released
exactly once. Storage, API, authentication, and application schemas remain in
the application adapter.
Adapters negotiate this addition with
`capabilities.fullscreenSourceLifecycle >= 1` (or the method presence) and keep
their bundled runtime when an older compatible stable alias is temporarily
cached.

Release `2.1.1` awaits an asynchronous `commitSource` callback. Returning
`false` (or throwing) prevents adjacent prefetch, so an application can keep a
post-paint visibility check and rollback without weakening the lifecycle.

Release `2.1.2` adds `replaceFullscreenImageSource`,
`loadAndDecodeFullscreenImage`, `decodeFullscreenImage`, and
`fullscreenImageUsesSource`. The safe replacement loads and decodes a detached
image, checks `shouldCommit`, replaces the visible image, waits two animation
frames, verifies decode and source again, and rolls the exact previous image
back on failure. Abort, callbacks, and injected browser primitives let
applications keep lifecycle ownership without duplicating this mechanism.
Adapters negotiate it with `capabilities.safeFullscreenImageReplace >= 1`.
Release `2.1.3` aligns the application-neutral visual classes
`.vpg-fullscreen-control`, `.vpg-fullscreen-close`, and
`.vpg-fullscreen-nav`, negotiated through
`capabilities.fullscreenControlStyles >= 1` with the original OVIK history
button: a 10px radius, `rgba(255,255,255,.28)` border,
`rgba(8,15,13,.62)` surface, white foreground, 8px blur fallback, and
coordinated hover/active/keyboard-focus treatment. Applications still own placement, dimensions, safe areas,
mobile arrow visibility, and unrelated controls.

Release `2.1.4` injects this control contract through its own idempotent style
block whenever a fullscreen switcher is created. A temporarily cached 2.0.1
base style therefore cannot suppress newer fullscreen controls.

Release `2.1.5` adds the pure
`helpers.resolveFullscreenImagePresentation` sizing contract. Applications can
use stored image dimensions to calculate the final contained base size before
the fullscreen dialog enters the DOM. This removes the first-frame stretch and
shrink jump while leaving each application in control of its auto-upscale
threshold and layout CSS. Adapters negotiate it through
`capabilities.fullscreenImagePresentation >= 1` and retain the bundled runtime
when an older stable alias is cached.

Release `2.1.6` introduced delayed post-touch settling. Release `2.1.7`
replaces that approach because it could interfere with an ordinary transition
between photos. A single shared edge controller now intercepts only an outward
horizontal drag on the first or last slide, applies a bounded resistant offset,
and animates that slide back. Normal inline and fullscreen swipes remain fully
native and receive no delayed `scrollTo`. Adapters negotiate the corrected
behavior through `capabilities.fullscreenEdgeRubberBand >= 1`; the retained
`fullscreenEdgeSettling: 2` value lets a 2.1.6 adapter prefer this fixed stable
runtime over its regressed bundled fallback.

```html
<script async src="https://vniipo-help.ru/shared-ui/photo-gallery/stable.js"></script>
```

```js
const binding = window.VniipoPhotoGallery.bindInlineGalleries(document, {
  openLightbox({ image, gallery, index }) {
    appLightbox.open({ image, gallery, index });
  },
});
// Later:
binding.destroy();
```

Applications keep a bundled copy of the last compatible runtime and request `stable.js` asynchronously. The shared request must never be awaited during boot. On failure or offline startup, the bundled copy remains active. The stable loader uses a one-hour cache window and validates `contractVersion === 2` before using a new runtime.

Since `1.0.1`, a dot-selected target remains active for the whole smooth-scroll
transition. Intermediate scroll frames cannot briefly reactivate the previous
dot, while touch or wheel interruption still hands control back to the current
visible slide.

## Release and rollback

1. Run `npm test` and `npm run build`.
2. Upload `dist/photo-gallery.js` to the immutable version path first.
3. Verify its SHA-256 against `dist/manifest.json`.
4. Upload the manifest.
5. Preserve the previous `stable.js`, then atomically replace the stable alias.
6. Verify the public stable hash and manifest.

Rollback only changes the `stable.js` alias and manifest to the preceding immutable release. Existing application bundles remain usable throughout.

## One-time adapter for another application

1. Add the common `vpg-*` classes and accessible dot buttons to existing gallery markup.
2. Keep the application's current lightbox and pass it as `openLightbox`.
3. Add a bundled compatible fallback and the non-blocking stable loader.
4. Re-run `bindInlineGalleries` after a render and destroy the returned binding before replacing the view.
5. Test vertical page scroll, horizontal swipe, dot navigation, synthetic click suppression, and offline boot.

No external npm or CDN dependency is used.

## Русский

В версии 2.2.0 ожидание готового кадра и переключение без пустого промежутка
реализованы в общем модуле. Приложение один раз подключает `waitForReady: true`
и `activate(index, prepare)`: callback загружает/декодирует фото и задаёт его
размер, а модуль сохраняет предыдущий кадр и отбрасывает устаревшие результаты.
`activeIndex` — выбранное фото, `presentedIndex` — фактически показанное.
Нативный свайп не задерживается. Для старых подключений сохранена совместимость;
они не получают новую политику показа автоматически до миграции адаптера.

`vniipo-photo-gallery` — общий браузерный runtime фотогалерей для OVIK,
Bikepacking, WIC и следующих приложений ВНИИПО. Текущий контракт `2` сохраняет
прикладные API, авторизацию, IndexedDB и схему данных в адаптерах приложений.

Runtime унифицирует встроенную ленту, точки навигации, горизонтальные свайпы,
полноэкранное переключение и инерцию увеличенного изображения. Миниатюры
показываются целиком через `object-fit: contain`; крайний и прерванный свайп
точно доводится до реального слайда.

`createFullscreenSourceController` обеспечивает общий жизненный цикл
preview/original: активный проверенный оригинал может стать начальным `src`,
декодируется только активное фото, а соседние загружаются лишь после его
успешного decode. Повторная работа устраняется, устаревшие операции отменяются,
а временные источники освобождаются один раз.

Начиная с `2.1.2`, `replaceFullscreenImageSource` безопасно загружает и
декодирует отдельный `<img>`, проверяет актуальность операции, подменяет видимое
изображение, ждёт два кадра отрисовки и повторно проверяет decode и фактический
source. При ошибке предыдущий элемент точно возвращается. Возможность
определяется через `capabilities.safeFullscreenImageReplace >= 1`.

Начиная с `2.1.3`, классы `.vpg-fullscreen-control`, `.vpg-fullscreen-close` и
`.vpg-fullscreen-nav` задают единое визуальное оформление кнопок закрытия и
стрелок в точности согласованы с исходной кнопкой истории OVIK: радиус 10px,
рамка `rgba(255,255,255,.28)`, подложка `rgba(8,15,13,.62)`, белый знак и blur 8px с
безопасным фоном, состояния hover/active и заметный `focus-visible`. Приложение
по-прежнему отвечает за расположение, размеры, safe-area и скрытие стрелок на
мобильных устройствах. Возможность определяется через
`capabilities.fullscreenControlStyles >= 1`.

В `2.1.5` чистый helper `helpers.resolveFullscreenImagePresentation`
вычисляет итоговый contained-размер по известным `width/height` до вставки
fullscreen-диалога в DOM. Это убирает прыжок от растянутого первого кадра к
нормальному размеру; порог автоувеличения и CSS остаются политикой
приложения. Возможность определяется через
`capabilities.fullscreenImagePresentation >= 1`.

В `2.1.6` появилась отложенная фиксация после touch-жеста. В `2.1.7` этот
подход заменён, потому что он мог вмешиваться в обычное перелистывание и
вызывать рывки. Теперь один общий edge-контроллер перехватывает только жест
наружу на первом или последнем слайде, показывает ограниченное сопротивление и
анимированно возвращает слайд. Обычные свайпы миниатюрной и полноэкранной ленты
остаются нативными и не получают отложенных `scrollTo`. Исправленный контракт
определяется через `capabilities.fullscreenEdgeRubberBand >= 1`; сохранённое
значение `fullscreenEdgeSettling: 2` позволяет адаптеру 2.1.6 выбрать новый
stable runtime вместо регрессивного встроенного fallback.

В `2.1.4` оформление контролов вынесено в отдельный идемпотентный style-блок,
который подключается при создании fullscreen switcher. Поэтому временно
закэшированный базовый стиль 2.0.1 больше не может скрыть новые контролы.

Приложение хранит совместимый fallback и загружает `stable.js` асинхронно, не
задерживая старт. Перед релизом выполняются `npm test` и `npm run build`, затем
сверяется SHA-256 из `dist/manifest.json`.
