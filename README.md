# VNIIPO Photo Gallery

[English](#english) | [Русский](#русский)

## English

Framework-agnostic runtime for inline photo galleries shared by OVIK, Bikepacking, WIC, and future applications.

## Browser contract

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

Приложение хранит совместимый fallback и загружает `stable.js` асинхронно, не
задерживая старт. Перед релизом выполняются `npm test` и `npm run build`, затем
сверяется SHA-256 из `dist/manifest.json`.
