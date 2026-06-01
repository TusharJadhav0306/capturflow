import type { CaptureConfig } from '../types.js';

export interface AcquiredStreams {
    displayStream: MediaStream | null;
    webcamStream:  MediaStream | null;
    micStream:     MediaStream | null;
}

/**
 * Manages getDisplayMedia + getUserMedia acquisition.
 *
 * Key cross-browser constraints baked in:
 *   - displaySurface: 'window'  → multi-tab capture (user can switch tabs)
 *   - monitorTypeSurfaces: 'exclude' → hides "Entire Screen" in Chrome picker
 *   - selfBrowserSurface: 'include'  → allows capturing own browser window
 *   - Audio requested on getDisplayMedia for tab/system audio
 */
export class StreamManager {
    private config: Required<CaptureConfig>;
    private _display: MediaStream | null = null;
    private _webcam:  MediaStream | null = null;
    private _mic:     MediaStream | null = null;

    constructor(config: CaptureConfig = {}) {
        this.config = {
            screen:         config.screen         ?? true,
            webcam:         config.webcam          ?? true,
            audio:          config.audio           ?? true,
            composite:      config.composite       ?? true,
            displaySurface: config.displaySurface  ?? 'window',
            allowSelfBrowser: config.allowSelfBrowser ?? true,
            excludeMonitor:   config.excludeMonitor   ?? true,
            hideBrowserChrome: config.hideBrowserChrome ?? false,
        };
    }

    /**
     * Build and return the getDisplayMedia constraints object.
     * Exposed so callers can inspect before starting.
     */
    displayConstraints(): DisplayMediaStreamOptions {
        const c = this.config;
        return {
            video: {
                displaySurface: c.displaySurface,
                frameRate: 30,
                width:  { ideal: 1920 },
                height: { ideal: 1080 },
            } as MediaTrackConstraints,
            audio: c.audio,
            // Chrome-specific constraints — ignored by other browsers
            ...(c.allowSelfBrowser  ? { selfBrowserSurface: 'include' }   : {}),
            ...(c.excludeMonitor    ? { monitorTypeSurfaces: 'exclude' }   : {}),
        } as DisplayMediaStreamOptions;
    }

    /**
     * Request screen stream via getDisplayMedia. Returns a Promise that resolves
     * ONLY after the user clicks "Share" in the OS picker (or rejects on denial).
     *
     * IMPORTANT (Chrome): Do NOT open a Document PiP window before awaiting this —
     * the PiP window will appear as an option in the share picker.
     * Open PiP AFTER this resolves.
     */
    async acquireDisplay(): Promise<MediaStream> {
        const stream = await navigator.mediaDevices.getDisplayMedia(this.displayConstraints());
        this._display = stream;
        return stream;
    }

    /** Request webcam stream. Safe to call before or after acquireDisplay. */
    async acquireWebcam(): Promise<MediaStream> {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 320, height: 240, facingMode: 'user' },
            audio: false,
        });
        this._webcam = stream;
        return stream;
    }

    /** Request microphone-only stream. */
    async acquireMic(): Promise<MediaStream> {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: false,
        });
        this._mic = stream;
        return stream;
    }

    /** Stop and release all tracks. */
    releaseAll(): void {
        for (const stream of [this._display, this._webcam, this._mic]) {
            stream?.getTracks().forEach(t => t.stop());
        }
        this._display = this._webcam = this._mic = null;
    }

    get displayStream() { return this._display; }
    get webcamStream()  { return this._webcam; }
    get micStream()     { return this._mic; }
}
