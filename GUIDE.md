# CapturFlow — Integration Guide

A practical guide to integrating CapturFlow into your app across browsers and operating systems. For the full option/event reference see [README.md](./README.md); for the per-platform test matrix see [TESTING.md](./TESTING.md).

- [1. Requirements (read first)](#1-requirements-read-first)
- [2. Capability detection](#2-capability-detection)
- [3. Framework quick-starts](#3-framework-quick-starts) — [Vanilla](#vanilla-js) · [React](#react) · [Vue](#vue) · [Svelte](#svelte)
- [4. Customizing the overlay](#4-customizing-the-overlay)
- [5. Error handling](#5-error-handling)
- [6. Cross-browser / OS behavior](#6-cross-browser--os-behavior)
- [7. Upload endpoint](#7-upload-endpoint)
- [8. Troubleshooting & pitfalls](#8-troubleshooting--pitfalls)
- [9. Known limitations & roadmap](#9-known-limitations--roadmap)

---

## 1. Requirements (read first)

These three trip up almost everyone — handle them before anything else:

1. **Secure context.** `getDisplayMedia`/`getUserMedia` only exist over **HTTPS** or **`http://localhost`**. Plain HTTP → `navigator.mediaDevices` is `undefined`.
2. **User gesture.** Call `recorder.start()` **directly inside a click/tap handler**. Calling it from a `setTimeout`, a promise chain after an `await`, or on page load will fail — the transient user activation is gone.
   ```js
   // Wrong — activation is lost by the time the timeout runs:
   btn.onclick = () => setTimeout(() => rec.start(), 0);
   // Right — call synchronously in the handler:
   btn.onclick = () => rec.start();
   ```
3. **Screen permission is not persistent.** Unlike camera/mic, the browser re-asks for screen share **every** time by design. Don't expect it to be remembered.

## 2. Capability detection

Call `CapturFlow.checkSupport()` *before* showing a Record button so you can disable it (and explain why) on unsupported platforms — instead of letting `start()` fail.

```js
import { CapturFlow } from 'capturflow';

const report = CapturFlow.checkSupport();          // or checkSupport({ screen: false }) if screen isn't required
if (!report.supported) {
  recordBtn.disabled = true;
  recordBtn.title = report.reasons.join(' ');      // e.g. "Screen capture is unavailable on mobile browsers."
}
```

`report` is:
```ts
{ supported, screen, webcam, audio, secureContext, reasons: string[], env: BrowserEnv }
```
- `supported` is gated by what you *require* (the `{screen,webcam,audio}` opts, all default `true`).
- `screen`/`webcam`/`audio` are raw capability flags — so you can offer "webcam only" when screen isn't available.
- `env` is the full `CapturFlow.detect()` result (browser, os, isMobile, recommended PiP strategy, mimeType, …).

> It reports **API capability**, not whether a physical camera/mic is plugged in (that needs a permission prompt). It's SSR-safe (returns all-false, never throws, on the server).

## 3. Framework quick-starts

The core API is framework-agnostic: construct, subscribe to events, call methods from user gestures.

```ts
const rec = new CapturFlow(config?);
rec.on('stopped', ({ blob, url, durationMs, mimeType }) => { /* play/upload */ });
rec.on('error',   ({ code, message, recoverable }) => { /* show message */ });
await rec.start();   // from a click
rec.pause(); rec.resume(); rec.toggleMic(); rec.toggleCam();
await rec.stop();
rec.status; rec.isRecording; rec.isPaused; rec.elapsedMs;
```

### Vanilla JS

```html
<button id="rec">Record</button>
<video id="out" controls></video>
<script type="module">
  import { CapturFlow } from 'capturflow';

  const rec = new CapturFlow({ capture: { hideBrowserChrome: true } });
  let recording = false;

  rec.on('stopped', ({ url }) => { document.getElementById('out').src = url; });
  rec.on('error',   ({ code, message }) => alert(`${code}: ${message}`));
  rec.on('status-change', (s) => { recording = (s === 'recording' || s === 'paused'); });

  const support = CapturFlow.checkSupport();
  const btn = document.getElementById('rec');
  btn.disabled = !support.supported;
  btn.onclick = () => recording ? rec.stop() : rec.start();   // called from the gesture
</script>
```

### React

```tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import { CapturFlow, type RecordingStatus } from 'capturflow';

export function useCapturFlow(config?: ConstructorParameters<typeof CapturFlow>[0]) {
  const ref = useRef<CapturFlow>();
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!ref.current) ref.current = new CapturFlow(config);

  useEffect(() => {
    const rec = ref.current!;
    const onStatus = (s: RecordingStatus) => setStatus(s);
    const onStopped = ({ url }: { url: string }) => setUrl(url);
    const onError = (e: { code: string; message: string }) => setError(`${e.code}: ${e.message}`);
    rec.on('status-change', onStatus).on('stopped', onStopped).on('error', onError);
    return () => { rec.off('status-change', onStatus).off('stopped', onStopped).off('error', onError); };
  }, []);

  return {
    status, url, error,
    isRecording: status === 'recording' || status === 'paused',
    start: useCallback(() => ref.current!.start(), []),
    stop:  useCallback(() => ref.current!.stop(), []),
    pause: useCallback(() => ref.current!.pause(), []),
    resume: useCallback(() => ref.current!.resume(), []),
  };
}

export function Recorder() {
  const { isRecording, url, error, start, stop } = useCapturFlow({ capture: { hideBrowserChrome: true } });
  const support = CapturFlow.checkSupport();
  return (
    <>
      <button disabled={!support.supported} onClick={() => (isRecording ? stop() : start())}>
        {isRecording ? 'Stop' : 'Record'}
      </button>
      {error && <p role="alert">{error}</p>}
      {url && <video src={url} controls />}
    </>
  );
}
```

### Vue

```vue
<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { CapturFlow } from 'capturflow';

const rec = new CapturFlow({ capture: { hideBrowserChrome: true } });
const status = ref(rec.status);
const url = ref<string | null>(null);
const supported = CapturFlow.checkSupport().supported;

const onStatus = (s: string) => (status.value = s);
const onStopped = (r: { url: string }) => (url.value = r.url);
rec.on('status-change', onStatus).on('stopped', onStopped);
onBeforeUnmount(() => rec.off('status-change', onStatus).off('stopped', onStopped));

const recording = () => status.value === 'recording' || status.value === 'paused';
const toggle = () => (recording() ? rec.stop() : rec.start());
</script>

<template>
  <button :disabled="!supported" @click="toggle">{{ recording() ? 'Stop' : 'Record' }}</button>
  <video v-if="url" :src="url" controls />
</template>
```

### Svelte

```svelte
<script>
  import { onDestroy } from 'svelte';
  import { CapturFlow } from 'capturflow';

  const rec = new CapturFlow({ capture: { hideBrowserChrome: true } });
  let status = rec.status, url = null;
  const supported = CapturFlow.checkSupport().supported;

  const onStatus = (s) => (status = s);
  const onStopped = (r) => (url = r.url);
  rec.on('status-change', onStatus).on('stopped', onStopped);
  onDestroy(() => rec.off('status-change', onStatus).off('stopped', onStopped));

  $: recording = status === 'recording' || status === 'paused';
</script>

<button disabled={!supported} on:click={() => (recording ? rec.stop() : rec.start())}>
  {recording ? 'Stop' : 'Record'}
</button>
{#if url}<video src={url} controls />{/if}
```

### CDN / no build step

No bundler? Load CapturFlow straight from a CDN.

**ESM** (modern browsers — recommended):
```html
<script type="module">
  import { CapturFlow } from 'https://esm.sh/capturflow';
  // or: import { CapturFlow } from 'https://cdn.jsdelivr.net/npm/capturflow/+esm';
  const rec = new CapturFlow();
  document.querySelector('#start').onclick = () => rec.start();
</script>
```

**Classic global `<script>`** (exposes `window.CapturFlow`):
```html
<script src="https://cdn.jsdelivr.net/npm/capturflow"></script>
<!-- or: https://unpkg.com/capturflow -->
<script>
  const { CapturFlow } = window.CapturFlow;       // the global namespace holds the class + helpers
  const support = window.CapturFlow.checkSupport();
  const rec = new CapturFlow();
  document.querySelector('#start').onclick = () => rec.start();
</script>
```

The global build is a single self-contained file (`fix-webm-duration` is bundled in). **Pin a version in production** — `https://cdn.jsdelivr.net/npm/capturflow@0.1.0` — so a future release can't change behavior under you. Both jsDelivr and unpkg support `@version` and Subresource Integrity (SRI).

## 4. Customizing the overlay

Four levels, pick what you need:

**a) Theme the built-in widget** — recolor + relabel without replacing it:
```js
new CapturFlow({
  pip: {
    theme:  { accent: '#7c3aed', background: '#0b1120', text: '#e2e8f0', mutedBg: 'rgba(255,255,255,.1)' },
    labels: { stop: 'End session', pause: 'Hold' },
  },
});
```

**b) Webcam overlay layout** — move/resize the camera thumbnail in the composite:
```js
new CapturFlow({ output: { webcam: { position: 'bottom-left', scale: 0.28, borderRadius: 16, padding: 20 } } });
```

**c) Headless (build your own UI)** — hide the built-in widget, drive everything via the instance API + events:
```js
const rec = new CapturFlow({ pip: { enabled: false } });
rec.on('status-change', renderMyToolbar);
myStopButton.onclick = () => rec.stop();      // see examples/headless-custom-ui.html
```

**d) Bring your own element** — your HTML is mounted into the PiP/popup window; you drive controls via the API. Add `data-capturflow-camera` to a `<video>` for a live preview:
```js
const el = document.querySelector('#my-overlay');     // contains <video data-capturflow-camera>
new CapturFlow({ pip: { customWidget: el } });        // see examples/custom-widget.html
```
> With `customWidget`, `theme`/`labels` are ignored, and `pip.enabled:false` takes precedence (no overlay at all). The element is owned by CapturFlow's mount lifecycle — don't assume it stays in the DOM after `stop()`.

## 5. Error handling

CapturFlow never throws from `start()`/`stop()` — it emits an `error` event with a stable `code`:

| `code` | Meaning | What to do |
| --- | --- | --- |
| `SCREEN_CAPTURE_UNSUPPORTED` | No `getDisplayMedia` (mobile / insecure context). Emitted before any prompt. | Hide the feature; use `checkSupport()` up front. |
| `PERMISSION_DENIED` | User dismissed the share/camera/mic prompt. | Show "allow access to record"; `start()` again is allowed. |
| `NO_SOURCE` | No capturable source / device found. | Ask the user to connect a device / pick a source. |
| `DEVICE_IN_USE` | Camera/mic busy in another app. | Ask to close the other app, retry. |
| `NO_USER_GESTURE` | No live user activation — `start()` wasn't called straight from a click, or a popup stole focus first (Safari is strict). | Call `start()` directly in the click handler; on Safari use `pip.strategy:'floating'`. |
| `POPUP_BLOCKED` | The popup-strategy overlay (Mac Firefox/Opera) was blocked. | Tell the user to allow popups for your site. |
| `ABORTED` | The request was aborted. | Retry. |
| `START_FAILED` | Anything else. | Show `message`; retry. |
| `UPLOAD_FAILED` | A chunk upload failed after retries (recording is safe — you got `stopped`). | Re-upload the blob from the `stopped` event. |

All are recoverable: the instance returns to `error` state and `start()` can be called again.

**Non-fatal `warning` event** — if the **camera or microphone is denied/unavailable**, CapturFlow no longer aborts; it records the **screen only** and emits a `warning` instead (recording still completes and `stopped` fires):

| `warning.code` | Meaning | What to do |
| --- | --- | --- |
| `WEBCAM_UNAVAILABLE` | Camera blocked/denied — recording continues without the webcam overlay. | Optionally prompt the user to allow the camera, then offer to re-record. |
| `MIC_UNAVAILABLE` | Microphone blocked/denied — recording continues without audio. | Optionally prompt to allow the mic. |

```js
recorder.on('warning', ({ code, message }) => console.warn(code, message)); // recording is still happening
```

## 6. Cross-browser / OS behavior

| Browser / OS | Screen capture | Overlay (auto) | Output |
| --- | --- | --- | --- |
| Chrome/Edge/Opera — Win/Linux/Mac | window + monitor | Document PiP (after picker) | WebM |
| Firefox — Win/Linux | window + monitor | floating (in-page) | WebM |
| Firefox — Mac | window + monitor | popup (before picker) | WebM |
| Safari — Mac | **screen only** | floating | **MP4** |
| iOS Safari / Android Chrome | **unsupported** | — | — |

Takeaways: **Safari** records MP4 (not WebM), can't share a single window/tab, and uses the in-page **floating** overlay (a popup would steal focus and break `getDisplayMedia` on WebKit); the floating overlay is in-page so it's hidden while another tab/app is focused; **mobile** has no screen capture. `hideBrowserChrome` applies only when the page's own window is shared (skipped for monitor/tab/Safari). Full per-platform checklist: [TESTING.md](./TESTING.md).

## 7. Upload endpoint

Set `upload.url` and CapturFlow POSTs the recording in chunks. Each request is `multipart/form-data` with:

| field | value |
| --- | --- |
| `chunk` | the binary slice (file part) |
| `chunkIndex` | 0-based index |
| `totalChunks` | total count |
| `mimeType` | recording MIME type |

Minimal Express receiver:
```js
import express from 'express';
import multer from 'multer';
const upload = multer({ dest: 'tmp/' });
const app = express();

app.post('/upload', upload.single('chunk'), (req, res) => {
  const { chunkIndex, totalChunks, mimeType } = req.body;
  appendChunkToSession(req.file, Number(chunkIndex));        // your storage
  if (Number(chunkIndex) === Number(totalChunks) - 1 || allChunksReceived()) {
    const asset = finalizeRecording(mimeType);                // assemble
    return res.json({ id: asset.id, url: asset.url });        // ← surfaced to you
  }
  res.json({ ok: true });
});
```
The body of the **last chunk to complete** is parsed (JSON, else text) and delivered as the `uploaded` event's `response`:
```js
rec.on('uploaded', ({ response, durationMs }) => console.log('saved:', response));
```
Notes: do **not** set a `Content-Type` header in `upload.headers` (it would break the multipart boundary — CapturFlow strips it). Use `upload.headers` for `Authorization` etc. Tune `chunkSize`/`parallel`/`retries` as needed.

## 8. Troubleshooting & pitfalls

| Symptom | Cause & fix |
| --- | --- |
| `navigator.mediaDevices` is undefined | Not a secure context — serve over HTTPS or `localhost`. |
| `start()` does nothing / `PERMISSION_DENIED` immediately | Not called from a user gesture (called after `await`/timeout). Call it directly in the click handler. |
| Recording plays but shows `0:00` / can't seek | WebM duration metadata. Keep `output.fixDuration: true` (default); it's repaired via `fix-webm-duration`. MP4 (Safari) is unaffected. |
| Safari produces a different file type | Safari records **MP4/H.264**, never WebM. Expect both; handle server-side. CapturFlow also falls back across codecs if one is rejected at construction (Safari `isTypeSupported` can lie). |
| Mobile shows no record option | `getDisplayMedia` is unsupported on iOS/Android web — `checkSupport().screen` is `false`. Offer webcam-only or a native path. |
| Overlay disappears when switching tabs (Firefox/older) | The `floating` strategy is an in-page element; it's hidden when its tab is backgrounded. Document PiP (Chromium) and popup stay on top. |
| Tab strip / URL bar visible in the recording | Set `capture.hideBrowserChrome: true`, and share the **window running the app**. |
| Popup overlay blocked on Mac Firefox/Opera | `POPUP_BLOCKED` — allow popups for your origin. |
| `getDisplayMedia` denied / `NO_USER_GESTURE` on Safari | A window opened before capture and stole focus. Use `pip.strategy:'floating'` on Safari (the default since v0.1.1). Call `start()` directly from the click. |
| **Safari records the screen but no webcam/mic** (`WEBCAM_UNAVAILABLE`/`MIC_UNAVAILABLE`, or `PERMISSION_DENIED` pre-0.1.3) | Safari **camera/microphone are per-site permissions** and Safari does **not** re-prompt after a deny. Fix in **Safari → Settings → Websites → Camera** (and **Microphone**) → set the site to **Allow**, then reload. Note: Safari is a built-in app, so it does **not** appear under macOS System Settings → Privacy & Security → Camera (that list is only for Chrome/Firefox/etc.). Since v0.1.3 a denied camera/mic no longer aborts — you get a `warning` and a screen-only recording. |

## 9. Known limitations & roadmap

- **Camera/microphone device selection is not yet built.** You currently can't pass a `deviceId` to choose a specific camera/mic; CapturFlow uses the browser default. (Planned.)
- The built-in widget's hero gradient and the green "Case #" accent are fixed; `theme` covers background, text, accent (Stop), and control-button background.
- Output/canvas resolution is fixed at 1920×1080 (cropped when `hideBrowserChrome` is active). Webcam capture resolution is fixed.
- **Mobile screen capture** is a platform limitation with no browser workaround.
