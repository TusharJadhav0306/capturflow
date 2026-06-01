import { detect, pickMimeType, checkSupport } from './detect/BrowserOS.js';
import { StreamManager }   from './core/StreamManager.js';
import { Compositor }      from './core/Compositor.js';
import { Recorder }        from './core/Recorder.js';
import { PipManager }      from './pip/PipManager.js';
import { DefaultWidget }   from './ui/DefaultWidget.js';
import { ChunkedUploader } from './upload/ChunkedUploader.js';
import { classifyStartError } from './core/errors.js';
import { clamp01, nonNeg } from './core/validate.js';
import type {
    CapturFlowConfig, CapturFlowEvents,
    RecordingStatus, PipStrategy, BrowserEnv,
    CheckSupportOptions, SupportReport,
} from './types.js';

type EventMap = CapturFlowEvents;
type EventName = keyof EventMap;

export class CapturFlow {
    // ── static ───────────────────────────────────────────────────
    static detect(): BrowserEnv { return detect(); }
    /** Structured capability check — call before showing a Record button. */
    static checkSupport(opts?: CheckSupportOptions): SupportReport { return checkSupport(opts); }

    // ── state ────────────────────────────────────────────────────
    private _status: RecordingStatus = 'idle';
    private _config: CapturFlowConfig;

    // ── modules ──────────────────────────────────────────────────
    private streams!: StreamManager;
    private compositor: Compositor | null = null;
    private recorder:   Recorder   | null = null;
    private pip!: PipManager;
    private widget: DefaultWidget | null = null;
    private uploader: ChunkedUploader | null = null;

    // ── runtime ──────────────────────────────────────────────────
    private chunks:  Blob[] = [];
    private elapsedTimer: ReturnType<typeof setInterval> | null = null;
    private _elapsedMs = 0;
    private listeners = new Map<EventName, Function[]>();

    constructor(config: CapturFlowConfig = {}) {
        this._config = config;
        this.streams = new StreamManager(config.capture);
        this.pip = new PipManager(config.pip ?? {}, {
            onOpen:  (s) => this.emit('pip-open', { strategy: s }),
            onClose: ()  => {
                this.emit('pip-close');
                // Closing the overlay window is the user's "I'm done" gesture —
                // stop recording so mic/cam/screen don't keep running invisibly.
                // stop() sets status to 'stopping' first, so the close() it
                // triggers internally won't re-enter here.
                if (this._status === 'recording' || this._status === 'paused') {
                    void this.stop();
                }
            },
        });
        if (config.upload) {
            this.uploader = new ChunkedUploader({
                ...config.upload,
                onProgress: (pct, up, total) => this.emit('upload-progress', pct, up, total),
            });
        }
    }

    // ── public control ───────────────────────────────────────────

    async start(): Promise<void> {
        // Allow a fresh attempt after a previous failure (e.g. the user denied
        // the permission prompt) — 'error' is a recoverable resting state.
        if (this._status !== 'idle' && this._status !== 'completed' && this._status !== 'error') return;

        const env = detect();
        const captureConfig = this._config.capture ?? {};
        const pipConfig     = this._config.pip     ?? {};
        const outputConfig  = this._config.output  ?? {};
        const pipEnabled    = pipConfig.enabled !== false;

        // Fail fast & clearly where screen capture is impossible (mobile browsers
        // expose no getDisplayMedia) instead of throwing deep in the pipeline.
        if (captureConfig.screen !== false && !env.screenCaptureSupported) {
            this.setStatus('error');
            this.emit('error', {
                message: 'Screen capture is unavailable in this browser. getDisplayMedia is not supported on mobile (iOS Safari, Android Chrome) or some embedded webviews.',
                code: 'SCREEN_CAPTURE_UNSUPPORTED',
                recoverable: false,
            });
            return;
        }

        this.setStatus('starting');

        try {
            // ── Step 0: Mac popup must open BEFORE getDisplayMedia ──
            let popupReady: Promise<Window> | null = null;
            if (pipEnabled && this.pip.currentStrategy === 'popup') {
                popupReady = this.pip.openPopupSync();
            }

            // ── Step 1: Screen picker (Chrome activation consumed here) ──
            let displayStream: MediaStream | null = null;
            if (captureConfig.screen !== false) {
                displayStream = await this.streams.acquireDisplay();
                // The browser's native "Stop sharing" bar ends the screen track —
                // treat that as a stop, mirroring closing the overlay window.
                displayStream.getVideoTracks().forEach((t) => {
                    t.addEventListener('ended', () => {
                        if (this._status === 'recording' || this._status === 'paused') void this.stop();
                    });
                });
            }

            // ── Step 1.5: Chrome/Edge — open Document PiP AFTER picker ──
            if (pipEnabled && this.pip.currentStrategy === 'document-pip' && displayStream) {
                await this.pip.openDocumentPip();
            }

            // ── Step 2: Webcam ──
            let webcamStream: MediaStream | null = null;
            if (captureConfig.webcam !== false) {
                webcamStream = await this.streams.acquireWebcam();
            }

            // ── Step 3: Microphone ──
            if (captureConfig.audio !== false) {
                await this.streams.acquireMic();
            }

            // ── Step 4: Compositor ──
            // Run the compositor when we have a webcam to overlay, OR when chrome
            // cropping is requested (cropping needs the canvas pipeline). The
            // compositor handles a null webcam, so screen-only cropping works too.
            const cropTop = captureConfig.hideBrowserChrome === true
                ? 'auto'
                : (typeof captureConfig.hideBrowserChrome === 'number' ? captureConfig.hideBrowserChrome : 0);
            // Cropping always needs the canvas pipeline — force it even when the
            // caller set composite:false, otherwise hideBrowserChrome would be
            // silently ignored and the toolbar would leak into the recording.
            const needsCompositor = !!displayStream
                && (cropTop !== 0 || (captureConfig.composite !== false && !!webcamStream));

            let recordingStream: MediaStream;
            if (needsCompositor && displayStream) {
                const wc = outputConfig.webcam ?? {};
                this.compositor = new Compositor({
                    frameRate: outputConfig.frameRate ?? 30,
                    cropTop,
                    webcamPosition:     wc.position,                 // undefined → Compositor default
                    webcamScale:        clamp01(wc.scale),
                    webcamBorderRadius: nonNeg(wc.borderRadius),
                    webcamPadding:      nonNeg(wc.padding),
                });
                recordingStream = await this.compositor.start(displayStream, webcamStream);
            } else if (displayStream) {
                recordingStream = displayStream;
            } else {
                throw new Error('No streams available for recording');
            }

            // Add mic audio track to recording stream
            const micStream = this.streams.micStream;
            if (micStream) {
                micStream.getAudioTracks().forEach(t => recordingStream.addTrack(t));
            }

            // ── Step 5: Widget (skipped when pip.enabled === false; the consumer
            //    then drives pause/resume/stop/toggles via the instance API) ──
            if (pipEnabled) {
                // Pick the element to mount: the consumer's customWidget, or the
                // built-in DefaultWidget. With customWidget, this.widget stays null
                // so internal setPaused/setMicMuted/etc. safely no-op.
                let mountEl: HTMLElement;
                if (pipConfig.customWidget) {
                    mountEl = pipConfig.customWidget;
                } else {
                    this.widget = new DefaultWidget(
                        {
                            onPause:     () => this.pause(),
                            onResume:    () => this.resume(),
                            onStop:      () => this.stop(),
                            onMicToggle: () => this.toggleMic(),
                            onCamToggle: () => this.toggleCam(),
                        },
                        { theme: pipConfig.theme, labels: pipConfig.labels },
                    );
                    this.widget.updateMetadata(pipConfig.metadata ?? {});
                    mountEl = this.widget.root;
                }

                // Mount into PiP / floating (same flow for both widget kinds).
                if (this.pip.currentStrategy === 'floating') {
                    const floatContainer = document.createElement('div');
                    this.pip.openFloating(floatContainer);
                    floatContainer.appendChild(mountEl);
                } else {
                    if (popupReady) await popupReady;
                    await this.pip.mountWidget(mountEl);
                }

                // Attach camera AFTER mounting (element may have crossed document boundary).
                if (this.widget) {
                    this.widget.attachCamera(webcamStream);
                } else if (pipConfig.customWidget) {
                    this.attachCameraToCustom(pipConfig.customWidget, webcamStream);
                }
            }

            // ── Step 6: Recorder ──
            // Honor output.format ('webm' | 'mp4' | 'auto'); 'auto' prefers WebM
            // so fix-webm-duration applies, falling back to MP4 for Safari.
            const mimeType = pickMimeType(outputConfig.format ?? 'auto');
            this.recorder = new Recorder({
                mimeType,
                fixDuration: outputConfig.fixDuration ?? true,
                videoBitsPerSecond: outputConfig.videoBitsPerSecond,
                audioBitsPerSecond: outputConfig.audioBitsPerSecond,
                onChunk: (chunk, idx) => {
                    this.chunks.push(chunk);
                    this.emit('chunk', chunk, idx);
                },
            });
            this.recorder.start(recordingStream);

            // ── Step 7: Elapsed timer ──
            this._elapsedMs = 0;
            this.elapsedTimer = setInterval(() => {
                if (this.recorder?.isRecording) {
                    this._elapsedMs = this.recorder.elapsedMs();
                }
            }, 250);

            this.setStatus('recording');
            // Report the type the Recorder actually started with (it may have
            // fallen back from the requested one).
            this.emit('started', { mimeType: this.recorder.mimeType, pipStrategy: this.pip.currentStrategy });

        } catch (err: any) {
            this.setStatus('error');
            // Classify into a stable code; recoverable — start() can retry from 'error'.
            const { code, recoverable, message } = classifyStartError(err);
            this.emit('error', { message, code, recoverable });
            this.cleanup();
        }
    }

    pause(): void {
        if (this._status !== 'recording') return;
        this.recorder?.pause();
        this.widget?.setPaused(true);
        this.setStatus('paused');
        this.emit('paused');
    }

    resume(): void {
        if (this._status !== 'paused') return;
        this.recorder?.resume();
        this.widget?.setPaused(false);
        this.setStatus('recording');
        this.emit('resumed');
    }

    async stop(): Promise<void> {
        if (this._status !== 'recording' && this._status !== 'paused') return;
        this.setStatus('stopping');

        if (this.elapsedTimer) { clearInterval(this.elapsedTimer); this.elapsedTimer = null; }

        let blob: Blob;
        let durationMs: number;
        let mimeType: string;

        if (this.recorder) {
            ({ blob, durationMs, mimeType } = await this.recorder.stop());
        } else {
            blob = new Blob(this.chunks, { type: 'video/webm' });
            durationMs = this._elapsedMs;
            mimeType = 'video/webm';
        }

        const url = URL.createObjectURL(blob);
        this.emit('stopped', { blob, url, durationMs, mimeType });

        this.cleanup();
        this.setStatus('completed');

        // Upload if configured
        if (this.uploader) {
            try {
                const result = await this.uploader.upload(blob, mimeType);
                this.emit('uploaded', result);
            } catch (err: any) {
                this.emit('error', { message: err?.message ?? String(err), code: 'UPLOAD_FAILED', recoverable: true });
            }
        }
    }

    toggleMic(): void {
        const tracks = this.streams.micStream?.getAudioTracks() ?? [];
        const muted = tracks.length > 0 && !tracks[0].enabled;
        tracks.forEach(t => (t.enabled = muted));
        this.widget?.setMicMuted(!muted);
    }

    toggleCam(): void {
        const tracks = this.streams.webcamStream?.getVideoTracks() ?? [];
        const hidden = tracks.length > 0 && !tracks[0].enabled;
        tracks.forEach(t => (t.enabled = hidden));
        this.widget?.setCamHidden(!hidden);
    }

    // ── events ───────────────────────────────────────────────────

    on<E extends EventName>(event: E, handler: EventMap[E]): this {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event)!.push(handler as Function);
        return this;
    }

    off<E extends EventName>(event: E, handler: EventMap[E]): this {
        const arr = this.listeners.get(event);
        if (arr) {
            const idx = arr.indexOf(handler as Function);
            if (idx !== -1) arr.splice(idx, 1);
        }
        return this;
    }

    private emit<E extends EventName>(event: E, ...args: Parameters<EventMap[E]>): void {
        this.listeners.get(event)?.forEach(fn => fn(...args));
    }

    // ── getters ──────────────────────────────────────────────────

    get status(): RecordingStatus { return this._status; }
    get elapsedMs(): number { return this._elapsedMs; }
    get isRecording(): boolean { return this._status === 'recording'; }
    get isPaused(): boolean { return this._status === 'paused'; }

    // ── internals ────────────────────────────────────────────────

    private setStatus(s: RecordingStatus): void {
        this._status = s;
        this.emit('status-change', s);
    }

    /** Attach the webcam stream to a consumer's <video data-capturflow-camera>, if present. */
    private attachCameraToCustom(host: HTMLElement, stream: MediaStream | null): void {
        // Query AFTER the mount — the element may now live in the PiP/popup document.
        const vid = host.querySelector<HTMLVideoElement>('video[data-capturflow-camera]');
        if (!vid) return;
        vid.srcObject = stream;   // force-reassign: crossing documents severs the pipeline
        vid.muted = true;
        vid.playsInline = true;
        if (stream) void vid.play().catch(() => {});
    }

    private cleanup(): void {
        // Close any open overlay window first (idempotent) so a failed start that
        // already opened a popup/PiP window doesn't orphan it before a retry.
        this.pip.close();
        if (this.elapsedTimer) { clearInterval(this.elapsedTimer); this.elapsedTimer = null; }
        this.compositor?.stop();
        this.compositor = null;
        this.streams.releaseAll();
        this.widget = null;
        this.chunks = [];
        this.recorder = null;
        this._elapsedMs = 0;
    }
}
