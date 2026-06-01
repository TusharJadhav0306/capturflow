# CapturFlow — cross-browser / cross-platform test matrix

CapturFlow leans on browser APIs (`getDisplayMedia`, `MediaRecorder`, Document PiP) whose behavior differs sharply by browser **and** OS. Automated unit tests cover the pure logic (`detect()`, MIME ordering — run `npm test`), but the capture/record/PiP flow can only be verified on real devices.

## How to run a manual test

1. `npm run build`
2. Serve the package root over `localhost` (a secure context — required for `getDisplayMedia`):
   ```bash
   npx serve .        # or: python -m http.server 5500
   ```
3. **Capabilities first:** open `examples/diagnostics.html` — it prints `detect()` + every capability check (no recording needed). Confirm the row matches the expectation below for the device you're on.
4. **Full flow:** open `examples/index.html`, click **Start**, share the **window running the app**, and walk the checklist.
5. **DX features:** also exercise `examples/themed.html`, `examples/headless-custom-ui.html`, and `examples/custom-widget.html` (see the Consumer-DX checklist below).

For HTTPS on a phone/another machine, use `npx serve --ssl` or a tunnel (e.g. `ngrok http 5500`) — `getDisplayMedia`/`getUserMedia` need HTTPS off `localhost`.

## Expected behavior per platform

Legend: ✅ works · ⚠️ works with a caveat · ❌ not supported by the platform (CapturFlow degrades gracefully).

| # | OS | Browser | Screen capture | Auto PiP strategy | Recording container | Notes to verify |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Windows | Chrome / Edge | ✅ window+monitor | `document-pip` | WebM | PiP opens **after** the picker; tab-switching captured; `hideBrowserChrome` crops toolbar. |
| 2 | Windows | Firefox | ✅ window+monitor | `floating` | WebM | Overlay is in-page → hidden while another tab is focused (expected). |
| 3 | Windows | Opera | ✅ | `document-pip` | WebM | Same as Chrome. |
| 4 | macOS | Chrome / Edge | ✅ | `document-pip` | WebM | Same as #1. |
| 5 | macOS | Firefox | ✅ | `popup` | WebM | Popup opens **before** the picker (sync). Verify it isn't blocked. |
| 6 | macOS | Safari | ⚠️ **screen-only** | `popup` | **MP4** | No per-window/tab share; `hideBrowserChrome` has no effect. Confirm MP4 plays & seeks. |
| 7 | macOS | Opera | ✅ | `popup` | WebM | Mac Opera uses popup. |
| 8 | Linux | Chrome | ✅ | `document-pip` | WebM | Same as #1 (Wayland may restrict window capture). |
| 9 | Linux | Firefox | ✅ | `floating` | WebM | Same as #2. |
| 10 | iOS | Safari | ❌ | n/a | — | `start()` → `error` `SCREEN_CAPTURE_UNSUPPORTED`. No crash. |
| 11 | Android | Chrome | ❌ | n/a | — | Same as #10. |

## Per-test checklist (run on each desktop row 1–9)

- [ ] **Start**: pick the app's own window → recording begins; `started` fires with the expected `mimeType`.
- [ ] **PiP overlay** shows the camera + name/case; controls (mic, cam, pause/resume, stop) are all visible and not clipped.
- [ ] **Tab switching** (`displaySurface: 'window'`): switch tabs while recording → playback shows each tab.
- [ ] **hideBrowserChrome: true**: playback has the tab strip / address bar cropped off the top, no content clipped, no vertical stretch.
- [ ] **Hide camera** (toggleCam): the webcam thumbnail disappears from the recording (it is **not** a black box).
- [ ] **Mute mic**: audio stops in playback.
- [ ] **Pause / resume**: timer freezes; `durationMs` excludes paused time; playback has no paused gap.
- [ ] **Stop button** → `stopped` fires; playback `<video>` plays and is **seekable** (duration shown, not 0:00).
- [ ] **Close the overlay window directly** (its OS close button) → recording **stops** automatically; mic/cam indicators turn off. (Was a leak before.)
- [ ] **Browser "Stop sharing" bar** → recording stops automatically.
- [ ] **Deny the permission** (cancel the picker) → `error` `PERMISSION_DENIED` with `recoverable: true`; clicking **Start again works** (instance is not bricked).
- [ ] **Upload** (if testing): chunks POST with progress; `uploaded` fires with the server's final response.

## Consumer-DX features (new example pages)

- [ ] **`diagnostics.html`** — capability report matches the platform row above; on mobile/insecure shows the right reason. `checkSupport().supported` gates correctly.
- [ ] **`themed.html`** — pick colors → the built-in PiP widget uses the accent/background/text; the un-themed default still looks normal; `labels.stop` changes the Stop tooltip.
- [ ] **`headless-custom-ui.html`** — `pip.enabled:false` → no built-in widget appears; the page's own buttons start/pause/resume/stop; status + timer update via events.
- [ ] **`custom-widget.html`** — `pip.customWidget` element is mounted into the PiP/popup window; `<video data-capturflow-camera>` shows the live webcam; the element's own Pause/Stop buttons drive recording.
- [ ] **Webcam overlay layout** — set `output.webcam: { position, scale }` → the composite thumbnail moves/resizes in playback.

## Known platform limitations (by design, not bugs)

- **Firefox/Safari floating or popup overlay** is not a native always-on-top window; the floating variant is hidden when its tab is backgrounded.
- **Safari** is screen-only (no window/tab selection) and records MP4; toolbar cropping does not apply.
- **Mobile web** has no screen-capture API at all — there is no workaround in a browser; use a native SDK if mobile capture is required.
- **`hideBrowserChrome`** auto-estimate assumes the app's own window is shared at a constant size; resizing mid-recording or DevTools docked top/bottom can skew the crop — pass an explicit pixel value for a fixed setup.
