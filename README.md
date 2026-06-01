# CapturFlow

Cross-browser screen + webcam recording for the web — Document Picture-in-Picture overlay, canvas compositing of webcam over screen, pause/resume, browser-chrome cropping, and chunked upload.

![npm](https://img.shields.io/badge/npm-v0.1.0-blue) ![types](https://img.shields.io/badge/types-included-blue) ![license](https://img.shields.io/badge/license-MIT-green)

## Features

- **Screen + webcam capture** via `getDisplayMedia` and `getUserMedia`, with microphone audio.
- **Composite webcam-over-screen** — a canvas pipeline draws the screen full-frame and overlays a mirrored, rounded webcam thumbnail (configurable corner/size). Falls back to recording the raw screen stream when compositing is off.
- **Cross-browser Picture-in-Picture strategies**, auto-selected per browser/OS:
  - `document-pip` — native Document PiP window (Chrome/Edge/Opera desktop), opened *after* the screen picker.
  - `popup` — `window.open()` popup, opened *synchronously before* the picker (required on Mac Firefox/Opera/Safari, where the permission dialog consumes the user activation a popup needs).
  - `floating` — in-page draggable overlay (universal fallback; used wherever Document PiP is unavailable, e.g. Firefox/Safari desktop).
- **Pause / resume** recording, plus live mic and camera toggles. Closing the overlay window or hitting the browser's native "Stop sharing" bar stops the recording cleanly.
- **`hideBrowserChrome` crop** — crops the browser's own UI (tab strip, address bar, bookmarks) off the top of a `window` capture while still recording every tab the user switches to. Auto-estimates the toolbar height from window metrics, or takes an explicit pixel value.
- **Chunked upload** — parallel chunk POSTs with per-chunk retries and progress callbacks.
- **Resilient by design** — recovers from a denied permission (retry `start()` again), falls back across MIME types if a codec is rejected, and fails fast with a clear error where screen capture is impossible (mobile).
- **SSR-safe detection** — all environment detection runs at call time (not module load), so importing in a server/SSR context never throws.
- **TypeScript-first** with full type definitions; ships dual ESM + CJS builds.

> 📖 **New here?** The [**Integration Guide**](./GUIDE.md) has framework quick-starts (Vanilla / React / Vue / Svelte), capability detection, overlay customization, an error-code table, the upload-endpoint contract, and troubleshooting.

## Install

```bash
npm i capturflow
```

CapturFlow depends on [`fix-webm-duration`](https://www.npmjs.com/package/fix-webm-duration) at runtime to inject correct duration metadata into WebM output. It is a regular dependency and is installed automatically.

> **Browser only.** CapturFlow uses `getDisplayMedia`, `getUserMedia`, `MediaRecorder`, `documentPictureInPicture`, and Canvas. It is not intended to run in Node.

## Quick start

```js
import { CapturFlow } from 'capturflow';

const recorder = new CapturFlow();

recorder.on('stopped', ({ url }) => {
  document.querySelector('video').src = url; // object URL of the recorded blob
});
recorder.on('error', ({ code, message }) => console.warn(code, message));

// Must be called from a user gesture (e.g. a click) on a secure context (https or localhost).
document.querySelector('#start').addEventListener('click', () => recorder.start());
document.querySelector('#stop').addEventListener('click', () => recorder.stop());
```

Gate the UI on capability first (mobile has no screen capture, HTTP isn't secure):

```js
const { supported, reasons } = CapturFlow.checkSupport();
startBtn.disabled = !supported;
if (!supported) startBtn.title = reasons.join(' ');
```

With configuration:

```js
const recorder = new CapturFlow({
  capture: {
    displaySurface: 'window',
    hideBrowserChrome: true,      // record every tab, crop the toolbar out
  },
  pip: {
    title: 'Session recording',
    metadata: { name: 'Jane Doe', caseId: 'A-1024' },
  },
  output: { format: 'auto', frameRate: 30 },
  upload: {
    url: 'https://example.com/api/upload',
    onProgress: (pct) => console.log(`${pct}%`),
  },
});
```

## API

### `new CapturFlow(config?)`

Creates a recorder. All config is optional — see [Configuration](#configuration).

### Methods

| Method | Description |
| --- | --- |
| `start(): Promise<void>` | Acquires streams, opens the PiP overlay, begins recording. No-op unless status is `idle`, `completed`, or `error` (so you can retry after a denied permission). Must run in a secure context from a user gesture. |
| `pause(): void` | Pauses recording (only while `recording`). |
| `resume(): void` | Resumes recording (only while `paused`). |
| `stop(): Promise<void>` | Stops recording, emits `stopped` with the final blob, closes the overlay, and (if configured) uploads. |
| `toggleMic(): void` | Mutes/unmutes the microphone track. |
| `toggleCam(): void` | Hides/shows the webcam (removed from the recording while hidden, not blacked out). |
| `on(event, handler): this` | Subscribe to an event. |
| `off(event, handler): this` | Unsubscribe. |
| `CapturFlow.detect(): BrowserEnv` | *(static)* Detect the current browser/OS, MIME type, recommended PiP strategy, and whether screen capture is supported. SSR-safe. |
| `CapturFlow.checkSupport(opts?): SupportReport` | *(static)* Structured capability check to run before showing a Record button — `{ supported, screen, webcam, audio, secureContext, reasons[], env }`. SSR-safe. |

### Getters

| Getter | Type | Description |
| --- | --- | --- |
| `status` | `RecordingStatus` | `idle` \| `starting` \| `recording` \| `paused` \| `stopping` \| `completed` \| `error`. |
| `elapsedMs` | `number` | Elapsed recording time in ms (paused time excluded). |
| `isRecording` | `boolean` | `true` while `recording`. |
| `isPaused` | `boolean` | `true` while `paused`. |

## Configuration

`CapturFlowConfig` has four optional sections: `capture`, `pip`, `output`, `upload`.

### `capture`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `screen` | `boolean` | `true` | Capture the screen via `getDisplayMedia`. |
| `webcam` | `boolean` | `true` | Capture the webcam via `getUserMedia`. |
| `audio` | `boolean` | `true` | Capture microphone audio. |
| `composite` | `boolean` | `true` | Composite webcam over screen on a canvas. When `false`, only the screen stream is recorded (unless `hideBrowserChrome` forces the compositor). |
| `displaySurface` | `'window' \| 'monitor' \| 'browser'` | — | Capture-surface hint. `'window'` = multi-tab capture of the browser window (recommended); `'monitor'` = full screen. Honored by Chromium/Firefox; ignored by Safari (screen-only). |
| `allowSelfBrowser` | `boolean` | `true` | Allow sharing the user's own browser window in the picker (Chrome `selfBrowserSurface: 'include'`). |
| `excludeMonitor` | `boolean` | `true` | Hide "Entire Screen" from Chrome's picker (`monitorTypeSurfaces: 'exclude'`). |
| `hideBrowserChrome` | `boolean \| number` | `false` | Crop the browser toolbar off the top of a `window` capture. `true` = auto-estimate; `<number>` = explicit CSS-pixel crop. Enables the compositor automatically. Only applied when the page's own window is shared; skipped for monitor/tab shares and on Safari. |

### `pip`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | Show the built-in overlay widget. When `false`, drive pause/resume/stop/toggles via the instance API. |
| `strategy` | `'auto' \| 'document-pip' \| 'popup' \| 'floating'` | `'auto'` | PiP strategy. `'auto'` picks the best for the browser/OS. An explicit strategy the browser can't support is coerced to a working one. |
| `width` | `number` | `240` | PiP window width in px. |
| `height` | `number` | `220` | PiP window height in px. |
| `metadata` | `PipMetadata` | — | `{ name?, caseId?, tags? }` shown in the overlay. |
| `theme` | `PipTheme` | — | Recolor the built-in widget: `{ accent?, background?, text?, mutedBg? }` (any CSS color). Ignored when `customWidget` is set. |
| `labels` | `PipLabels` | — | Override control-button tooltips: `{ mute?, unmute?, hideCam?, showCam?, pause?, resume?, stop? }`. |
| `customWidget` | `HTMLElement` | — | Mount your own element instead of the built-in widget (drive controls via the instance API). Add `<video data-capturflow-camera>` inside for a live preview. |
| `title` | `string` | `'Recording'` | Title of the PiP window / popup. |

### `output`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `format` | `'webm' \| 'mp4' \| 'auto'` | `'auto'` | Output container. `'auto'` prefers WebM (so duration metadata can be repaired), falling back to MP4 on Safari. Each choice is gated by `MediaRecorder.isTypeSupported`. |
| `videoBitsPerSecond` | `number` | `2_500_000` | Video bitrate. |
| `audioBitsPerSecond` | `number` | `128_000` | Audio bitrate. |
| `fixDuration` | `boolean` | `true` | Post-process WebM to inject correct duration metadata (via `fix-webm-duration`). No effect on MP4. |
| `frameRate` | `number` | `30` | Composite canvas frame rate. |
| `webcam` | `WebcamOverlayConfig` | — | Webcam overlay layout: `{ position?, scale?(0..1), borderRadius?, padding? }`. |

### `upload`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | `string` | *(required)* | POST endpoint. Each chunk is sent as `multipart/form-data` with `chunk`, `chunkIndex`, `totalChunks`, `mimeType` fields. |
| `chunkSize` | `number` | `2 MB` | Chunk size in bytes. |
| `parallel` | `number` | `3` | Parallel chunk uploads. |
| `retries` | `number` | `3` | Per-chunk retry attempts. |
| `headers` | `Record<string, string>` | — | Extra headers (e.g. `Authorization`). Any `Content-Type` is ignored — it's managed automatically for multipart. |
| `onProgress` | `(percent, uploadedBytes, totalBytes) => void` | — | Progress callback (`percent` 0–100). |

The `uploaded` event's `response` is the parsed body (JSON, else text) of the **final** chunk's response — typically your server's finalize payload (asset id / URL).

## Events

```js
recorder.on('stopped', ({ blob, url, durationMs, mimeType }) => { /* ... */ });
```

| Event | Payload | Fired when |
| --- | --- | --- |
| `status-change` | `(status: RecordingStatus)` | Status transitions. |
| `started` | `({ mimeType, pipStrategy })` | Recording has begun (`mimeType` is the type actually in use). |
| `paused` / `resumed` | `()` | Recording paused / resumed. |
| `stopped` | `({ blob, url, durationMs, mimeType })` | Recording stopped; `url` is an object URL for the blob. |
| `chunk` | `(chunk: Blob, index: number)` | Each 1-second recorded chunk. |
| `upload-progress` | `(percent, uploadedBytes, totalBytes)` | Upload progresses. |
| `uploaded` | `({ response, durationMs })` | Upload completed. |
| `pip-open` / `pip-close` | `({ strategy })` / `()` | Overlay opened / closed. |
| `error` | `({ message, code, recoverable })` | Error. Codes: `SCREEN_CAPTURE_UNSUPPORTED`, `PERMISSION_DENIED`, `NO_SOURCE`, `DEVICE_IN_USE`, `POPUP_BLOCKED`, `ABORTED`, `START_FAILED`, `UPLOAD_FAILED`. See the [error table in GUIDE.md](./GUIDE.md#5-error-handling). |

## Cross-browser support

PiP strategy is chosen automatically by `CapturFlow.detect()`. See [TESTING.md](./TESTING.md) for the full per-platform verification matrix.

| Browser / OS | Screen capture | Auto PiP strategy | Output |
| --- | --- | --- | --- |
| Chrome / Edge / Opera — Windows, Linux | Yes (window/monitor) | `document-pip` (opened after the picker) | WebM |
| Chrome / Edge / Opera — macOS | Yes | `document-pip` | WebM |
| Firefox — Windows, Linux | Yes (window/monitor) | `floating` (no Document PiP) | WebM |
| Firefox — macOS | Yes | `popup` (opened before the picker) | WebM |
| Safari — macOS | Yes — **screen-only** (no per-window/tab share) | `popup` | **MP4** |
| Mobile — iOS Safari, Android Chrome | **No** — `getDisplayMedia` unsupported | n/a — `start()` emits `SCREEN_CAPTURE_UNSUPPORTED` | — |

**Notes**
- **Safari** records MP4 (H.264/AAC), never WebM; the compositor still works but per-window chrome cropping does not apply (screen-only). `MediaRecorder` construction falls back across types if a codec is rejected.
- **Mobile** browsers have no screen-capture API; `start()` reports `SCREEN_CAPTURE_UNSUPPORTED` instead of failing deep in the pipeline. Detect ahead of time with `CapturFlow.detect().screenCaptureSupported`.
- **Document PiP** is Chromium-desktop-only as of 2026. Firefox/Safari use the popup or floating overlay; the floating overlay lives in the page, so it is hidden while another tab is focused.

### The `hideBrowserChrome` trade-off

Capturing `displaySurface: 'window'` records the **entire browser window**, following the user across every tab — but it also includes the browser's own UI (tabs, address bar) at the top of the frame. `hideBrowserChrome: true` routes the screen through the canvas compositor and crops that toolbar band off the top (auto-estimated from `window.outerHeight − window.innerHeight`, or an explicit pixel value), so you keep multi-tab capture without the chrome.

It is **best-effort**: it only applies when the page's *own* window is shared (skipped for monitor/tab/other-window shares), assumes a constant window size for the session (switching tabs is fine; resizing the window mid-recording can misalign the crop), and has no effect on Safari.

## Requirements & notes

- `getDisplayMedia` / `getUserMedia` require a **secure context** (HTTPS, or `localhost` in dev) and a **user gesture**. Call `start()` directly from a click handler.
- The compositor defaults to 1920×1080 at 30 fps; when chrome-cropping is active the canvas is resized to the cropped content to avoid distortion.

## License

MIT — see [LICENSE](./LICENSE).
