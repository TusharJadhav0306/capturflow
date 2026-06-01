// ─── Public types ────────────────────────────────────────────────────────────

export type RecordingStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'completed' | 'error';

/** Which PiP strategy will be used on this browser/OS */
export type PipStrategy = 'document-pip' | 'popup' | 'floating';

/** Output container format */
export type OutputFormat = 'webm' | 'mp4' | 'auto';

/** Classified reason a start() attempt failed (carried in the 'error' event `code`). */
export type StartErrorCode =
    | 'PERMISSION_DENIED'          // user denied the screen/camera/mic prompt (NotAllowedError)
    | 'NO_USER_GESTURE'            // no live user activation — call start() from a click; not after a popup steals focus (InvalidStateError/InvalidAccessError)
    | 'NO_SOURCE'                  // no capturable source available (NotFoundError)
    | 'DEVICE_IN_USE'              // device busy / unreadable (NotReadableError)
    | 'ABORTED'                    // the request was aborted (AbortError)
    | 'POPUP_BLOCKED'              // the popup-strategy window was blocked
    | 'SCREEN_CAPTURE_UNSUPPORTED' // getDisplayMedia unavailable (mobile/insecure)
    | 'START_FAILED';              // anything else

/** Detected environment */
export interface BrowserEnv {
    browser: 'chrome' | 'firefox' | 'safari' | 'edge' | 'opera' | 'unknown';
    os: 'windows' | 'mac' | 'linux' | 'ios' | 'android' | 'unknown';
    isMobile: boolean;
    /** Document PiP API available */
    documentPipSupported: boolean;
    /** Best pip strategy for this env */
    recommendedPipStrategy: PipStrategy;
    /** MIME type that will actually be used */
    mimeType: string;
    /** Whether getDisplayMedia is available */
    screenCaptureSupported: boolean;
}

/** What `CapturFlow.checkSupport()` requires to consider the env "supported". */
export interface CheckSupportOptions {
    /** Need screen capture (getDisplayMedia). Default: true. */
    screen?: boolean;
    /** Need webcam capture (getUserMedia video). Default: true. */
    webcam?: boolean;
    /** Need microphone capture (getUserMedia audio). Default: true. */
    audio?: boolean;
}

/** Structured capability report from `CapturFlow.checkSupport()`. */
export interface SupportReport {
    /** True only if every required capability (per CheckSupportOptions) is available. */
    supported: boolean;
    /** Raw capability flags (independent of what was requested). */
    screen: boolean;
    webcam: boolean;
    audio: boolean;
    /** Running in a secure context (HTTPS or localhost). */
    secureContext: boolean;
    /** Human-readable reasons something required is unavailable (empty when supported). */
    reasons: string[];
    /** The detected environment. */
    env: BrowserEnv;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface CaptureConfig {
    /** Capture screen via getDisplayMedia (default: true) */
    screen?: boolean;
    /** Capture webcam via getUserMedia (default: true) */
    webcam?: boolean;
    /** Capture microphone audio (default: true) */
    audio?: boolean;
    /**
     * Composite webcam over screen on a canvas (default: true when both screen+webcam enabled).
     * When false, only the screen stream is recorded.
     */
    composite?: boolean;
    /**
     * displaySurface constraint for getDisplayMedia.
     * 'window' = multi-tab capture of the browser window (recommended).
     * 'monitor' = full screen capture.
     */
    displaySurface?: 'window' | 'monitor' | 'browser';
    /**
     * Allow the user to share their own browser tab in the picker (Chrome).
     * Default: true (sets selfBrowserSurface: 'include').
     */
    allowSelfBrowser?: boolean;
    /**
     * Hide "Entire Screen" from Chrome's picker to prevent accidental full-monitor share.
     * Default: true (sets monitorTypeSurfaces: 'exclude').
     */
    excludeMonitor?: boolean;
    /**
     * Crop the browser's own UI (tab strip, address bar, bookmarks) off the top
     * of a 'window' capture so only page content is recorded — while still
     * capturing every tab the user switches to.
     *
     * The toolbar height is constant for a session, so one crop value covers all tabs.
     *
     *   true     → auto-estimate the chrome height from window metrics (recommended)
     *   <number> → explicit crop height in CSS pixels (overrides auto)
     *   false    → no crop (default)
     *
     * Requires the canvas compositor (enabled automatically when this is set).
     *
     * Auto cropping is best-effort and only applied when the captured surface
     * is the recording page's OWN browser window (displaySurface === 'window');
     * for monitor/tab/other-window shares the crop is skipped. It assumes the
     * captured window keeps a constant size for the session — switching tabs is
     * fine, but resizing the window or moving it to a monitor with a different
     * device-pixel-ratio mid-recording can misalign the crop. No effect on
     * Safari (screen-only capture).
     */
    hideBrowserChrome?: boolean | number;
}

export interface PipMetadata {
    /** Patient / session name shown in PiP overlay */
    name?: string;
    /** Case ID shown in PiP overlay */
    caseId?: string;
    /** Additional key/value tags */
    tags?: Record<string, string>;
}

/**
 * Colors for the built-in widget (any CSS color). Omitted keys keep the
 * default look. Ignored when `customWidget` is provided.
 */
export interface PipTheme {
    /** Stop button / primary accent. Default: #ef4444 */
    accent?: string;
    /** Widget background. Default: rgba(15,23,42,.96) */
    background?: string;
    /** Text color. Default: #f8fafc */
    text?: string;
    /** Control button background (mic/cam/pause/resume). Default: rgba(255,255,255,.08) */
    mutedBg?: string;
}

/** Tooltip overrides for the built-in widget's control buttons. */
export interface PipLabels {
    mute?: string;
    unmute?: string;
    hideCam?: string;
    showCam?: string;
    pause?: string;
    resume?: string;
    stop?: string;
}

export interface PipConfig {
    /** Enable PiP overlay (default: true) */
    enabled?: boolean;
    /**
     * PiP strategy.
     * 'auto' = picks the best for current browser/OS (recommended).
     * 'document-pip' = native Document PiP window (Chrome/Edge/Opera desktop).
     * 'popup' = window.open() popup (Mac Firefox/Opera/Safari fallback).
     * 'floating' = in-page draggable overlay (universal fallback).
     *
     * An explicit strategy that the current browser cannot support is coerced
     * to a working one (it will not abort recording).
     */
    strategy?: PipStrategy | 'auto';
    /** PiP window width in px (default: 240) */
    width?: number;
    /** PiP window height in px (default: 220) */
    height?: number;
    /** Metadata displayed in the widget overlay */
    metadata?: PipMetadata;
    /** Recolor the built-in widget. Ignored when customWidget is set. */
    theme?: PipTheme;
    /** Override control-button tooltips on the built-in widget. */
    labels?: PipLabels;
    /**
     * Mount your own element as the overlay instead of the built-in widget
     * (honored only when enabled !== false). You drive controls via the
     * instance API (start/pause/resume/stop/toggleMic/toggleCam) + events.
     * Include a `<video data-capturflow-camera>` anywhere inside to get a live
     * webcam preview. When set, `theme`/`labels` are ignored.
     */
    customWidget?: HTMLElement;
    /**
     * Title shown in the PiP window / popup title bar.
     * Default: 'Recording'
     */
    title?: string;
}

/** Layout of the webcam thumbnail composited over the screen. */
export interface WebcamOverlayConfig {
    /** Corner of the canvas. Default: 'bottom-right'. */
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    /** Thumbnail width as a fraction of canvas width (0..1). Default: 0.22. */
    scale?: number;
    /** Corner radius in px. Default: 12. */
    borderRadius?: number;
    /** Padding from the canvas edge in px. Default: 16. */
    padding?: number;
}

export interface OutputConfig {
    /**
     * Output container format.
     * 'auto' = webm on Chrome/Firefox, mp4 on Safari.
     */
    format?: OutputFormat;
    videoBitsPerSecond?: number;
    audioBitsPerSecond?: number;
    /**
     * Post-process WebM to inject correct duration metadata.
     * Requires fix-webm-duration. Default: true.
     */
    fixDuration?: boolean;
    /** Frame rate for the composite canvas. Default: 30 */
    frameRate?: number;
    /** Webcam overlay layout (only used when compositing webcam over screen). */
    webcam?: WebcamOverlayConfig;
}

export interface UploadConfig {
    /** POST endpoint for upload */
    url: string;
    /** Chunk size in bytes. Default: 2MB */
    chunkSize?: number;
    /** Parallel chunk uploads. Default: 3 */
    parallel?: number;
    /** Per-chunk retry attempts. Default: 3 */
    retries?: number;
    /** Extra headers for every request */
    headers?: Record<string, string>;
    /** Called with 0-100 as upload progresses */
    onProgress?: (percent: number, uploadedBytes: number, totalBytes: number) => void;
}

export interface CapturFlowConfig {
    capture?: CaptureConfig;
    pip?: PipConfig;
    output?: OutputConfig;
    upload?: UploadConfig;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface CapturFlowEvents {
    'status-change': (status: RecordingStatus) => void;
    'started': (info: { mimeType: string; pipStrategy: PipStrategy }) => void;
    'paused': () => void;
    'resumed': () => void;
    'stopped': (result: { blob: Blob; url: string; durationMs: number; mimeType: string }) => void;
    'uploaded': (result: { response: unknown; durationMs: number }) => void;
    'upload-progress': (percent: number, uploadedBytes: number, totalBytes: number) => void;
    'pip-open': (info: { strategy: PipStrategy }) => void;
    'pip-close': () => void;
    'error': (err: { message: string; code: string; recoverable: boolean }) => void;
    'chunk': (chunk: Blob, index: number) => void;
}
