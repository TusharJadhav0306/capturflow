import type { BrowserEnv, PipStrategy, OutputFormat, CheckSupportOptions, SupportReport } from '../types.js';

/**
 * Detect the current browser/OS environment and determine the best
 * PiP strategy + MIME type. All detection is done at call time (not module
 * load) so SSR environments don't throw.
 */
export function detect(): BrowserEnv {
    if (typeof navigator === 'undefined') {
        return {
            browser: 'unknown', os: 'unknown', isMobile: false,
            documentPipSupported: false, recommendedPipStrategy: 'floating',
            mimeType: 'video/webm', screenCaptureSupported: false,
        };
    }

    const ua = navigator.userAgent;
    const platform = (navigator as any).platform ?? '';
    // navigator.platform is deprecated; userAgentData.platform is the modern,
    // non-deprecated source (Chromium only). Use it as a fallback signal.
    const uaPlatform: string = (navigator as any).userAgentData?.platform ?? '';

    // ── Browser ──────────────────────────────────────────────────
    const isOpera   = /opr\//i.test(ua);
    const isEdge    = /edg\//i.test(ua) && !isOpera;
    const isChrome  = /chrome\/[\d.]+/i.test(ua) && !isEdge && !isOpera;
    const isFirefox = /firefox\//i.test(ua);
    const isSafari  = /^((?!chrome).)*safari/i.test(ua) && !isFirefox;

    const browser = isChrome ? 'chrome'
        : isFirefox ? 'firefox'
        : isSafari  ? 'safari'
        : isEdge    ? 'edge'
        : isOpera   ? 'opera'
        : 'unknown';

    // ── OS ───────────────────────────────────────────────────────
    const isIOS     = /iphone|ipad|ipod/i.test(ua);
    const isAndroid = /android/i.test(ua);
    // Mac detection no longer relies solely on the deprecated navigator.platform:
    // also consult userAgentData.platform and the UA string. Exclude iOS (iPadOS
    // Safari reports a Mac-like UA, but it has no getDisplayMedia anyway).
    const isMac     = (/mac/i.test(platform) || /mac/i.test(uaPlatform) || /mac os x|macintosh/i.test(ua))
        && !isIOS && !isAndroid;
    const isWindows = /win/i.test(platform) || /win/i.test(uaPlatform) || /windows/i.test(ua);
    const isMobile  = isIOS || isAndroid || /mobile/i.test(ua);

    const os = isWindows ? 'windows'
        : isMac     ? 'mac'
        : isIOS     ? 'ios'
        : isAndroid ? 'android'
        : (/linux/i.test(platform) || /linux/i.test(ua)) ? 'linux'
        : 'unknown';

    // ── Document PiP support ─────────────────────────────────────
    // window.documentPictureInPicture is Chromium-desktop only (Chrome/Edge/
    // Opera 116+). Not shipped in Firefox or Safari as of 2026, and not on
    // mobile. Feature-detected, so unsupported engines fall back automatically.
    const documentPipSupported = typeof window !== 'undefined'
        && 'documentPictureInPicture' in window;

    // ── PiP strategy ─────────────────────────────────────────────
    //
    // Key insight from production use:
    //   - Mac + Firefox/Opera/Safari: window.open() popup MUST be called
    //     synchronously before getDisplayMedia, because the async permission
    //     dialog consumes the transient user activation needed for popups.
    //   - Chrome/Edge (any OS): Document PiP opens AFTER getDisplayMedia
    //     resolves — the "Share" click grants a fresh activation.
    //   - Everything else: in-page floating overlay.
    //
    const needsPopup = isMac && (isFirefox || isOpera || isSafari);
    const recommendedPipStrategy: PipStrategy =
        needsPopup           ? 'popup'
        : documentPipSupported ? 'document-pip'
        : 'floating';

    // ── MIME type ─────────────────────────────────────────────────
    const mimeType = pickMimeType();

    // ── Screen capture ────────────────────────────────────────────
    // getDisplayMedia is unavailable on mobile browsers (iOS Safari, Android
    // Chrome) even though the method may be defined — guard on both.
    const screenCaptureSupported = typeof navigator.mediaDevices?.getDisplayMedia === 'function'
        && !isMobile;

    return {
        browser, os, isMobile,
        documentPipSupported,
        recommendedPipStrategy,
        mimeType,
        screenCaptureSupported,
    };
}

/**
 * Choose a MediaRecorder mimeType, gated by MediaRecorder.isTypeSupported().
 *
 * Ordering matters:
 *   - 'auto'  → prefer WebM (so fix-webm-duration can repair duration on
 *               Chrome/Firefox), fall back to MP4 for Safari (WebM-incapable).
 *   - 'webm'  → force WebM, fall back to MP4 only if no WebM type is supported.
 *   - 'mp4'   → force MP4, fall back to WebM only if no MP4 type is supported.
 *
 * Returns a best-effort default if nothing reports as supported; Recorder also
 * guards construction with its own fallback.
 */
/**
 * Structured capability check to run BEFORE showing a "Record" button.
 * Reports raw capability per modality plus a `supported` verdict gated by what
 * the caller actually needs (opts), with human-readable `reasons`. SSR-safe.
 */
export function checkSupport(opts: CheckSupportOptions = {}): SupportReport {
    const env = detect();
    const wantScreen = opts.screen !== false;
    const wantWebcam = opts.webcam !== false;
    const wantAudio  = opts.audio  !== false;

    const secureContext = typeof window !== 'undefined' && window.isSecureContext === true;
    const hasRecorder   = typeof MediaRecorder !== 'undefined';
    const hasGetUserMedia = typeof navigator !== 'undefined'
        && typeof navigator.mediaDevices?.getUserMedia === 'function';

    const screen = env.screenCaptureSupported;          // getDisplayMedia present AND not mobile
    const webcam = hasGetUserMedia;                      // capability, not device presence
    const audio  = hasGetUserMedia;

    const reasons: string[] = [];
    if (!secureContext)        reasons.push('Not a secure context — HTTPS or localhost is required.');
    if (!hasRecorder)          reasons.push('MediaRecorder API is unavailable in this browser.');
    if (wantScreen && !screen) reasons.push(env.isMobile
        ? 'Screen capture is unavailable on mobile browsers (no getDisplayMedia).'
        : 'getDisplayMedia (screen capture) is unavailable in this browser.');
    if (wantWebcam && !webcam) reasons.push('getUserMedia (camera) is unavailable.');
    if (wantAudio  && !audio)  reasons.push('getUserMedia (microphone) is unavailable.');

    const supported = secureContext && hasRecorder
        && (!wantScreen || screen)
        && (!wantWebcam || webcam)
        && (!wantAudio  || audio);

    return { supported, screen, webcam, audio, secureContext, reasons, env };
}

export function pickMimeType(format: OutputFormat = 'auto'): string {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
        return format === 'mp4' ? 'video/mp4' : 'video/webm';
    }
    const webm = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=h264,opus',
        'video/webm',
    ];
    const mp4 = [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=avc1',
        'video/mp4',
    ];
    const primary  = format === 'mp4' ? mp4 : format === 'webm' ? webm : [...webm, ...mp4];
    const fallback = format === 'mp4' ? webm : format === 'webm' ? mp4 : [];
    for (const t of [...primary, ...fallback]) {
        if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return format === 'mp4' ? 'video/mp4' : 'video/webm';
}
