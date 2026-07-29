# VNIIPO Photo Gallery

Framework-agnostic runtime for inline photo galleries shared by OVIK, Bikepacking, WIC, and future applications.

## Browser contract

The stable script publishes `window.VniipoPhotoGallery`:

- `version` and `contractVersion`;
- `bindInlineGalleries(root, options)`;
- `destroyInlineGalleries(root)`;
- pure gesture helpers under `helpers`.

The current contract is `1`. A gallery uses `[data-photo-gallery]`, a `.vpg-track`, `.vpg-slide` elements, and `[data-vpg-dot]` buttons. Pass `openLightbox({ image, gallery, index })` to retain application-specific full-size/offline photo resolution.

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

Applications keep a bundled copy of the last compatible runtime and request `stable.js` asynchronously. The shared request must never be awaited during boot. On failure or offline startup, the bundled copy remains active. The stable loader uses a one-hour cache window and validates `contractVersion === 1` before using a new runtime.

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
