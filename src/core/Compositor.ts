/**
 * Canvas compositor — merges a screen stream and a webcam stream into a
 * single composite MediaStream using requestAnimationFrame.
 *
 * Layout: screen fills the canvas; webcam appears as a PiP thumbnail in the
 * bottom-right corner (configurable).
 *
 * Cross-browser quirk baked in:
 *   Chrome requires screen video elements to be attached to the live DOM to
 *   fire 'loadeddata'. We append a 1×1 invisible element to document.body.
 */
export interface CompositorOptions {
    frameRate?: number;
    /** Width of composite canvas. Default: 1920 */
    width?: number;
    /** Height of composite canvas. Default: 1080 */
    height?: number;
    webcamPosition?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    /** Webcam thumbnail size as fraction of canvas width. Default: 0.22 */
    webcamScale?: number;
    webcamBorderRadius?: number;
    webcamPadding?: number;
    /**
     * Crop browser chrome (toolbar) off the top of the screen frame.
     *   'auto'   → estimate from window.outerHeight - innerHeight
     *   <number> → explicit CSS pixels to crop
     *   0/undef  → no crop
     */
    cropTop?: number | 'auto';
}

export class Compositor {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private screenEl: HTMLVideoElement | null = null;
    private webcamEl: HTMLVideoElement | null = null;
    private rafId = 0;
    private opts: Required<CompositorOptions>;
    private _stream: MediaStream | null = null;
    /** Pixels cropped off the top of the source frame (computed in start()). */
    private cropTopPx = 0;
    /** displaySurface of the captured track ('window' | 'monitor' | 'browser' | undefined). */
    private surface: string | undefined;

    constructor(opts: CompositorOptions = {}) {
        this.opts = {
            frameRate:          opts.frameRate          ?? 30,
            width:              opts.width              ?? 1920,
            height:             opts.height             ?? 1080,
            webcamPosition:     opts.webcamPosition     ?? 'bottom-right',
            webcamScale:        opts.webcamScale        ?? 0.22,
            webcamBorderRadius: opts.webcamBorderRadius ?? 12,
            webcamPadding:      opts.webcamPadding      ?? 16,
            cropTop:            opts.cropTop            ?? 0,
        };
        this.canvas = document.createElement('canvas');
        this.canvas.width  = this.opts.width;
        this.canvas.height = this.opts.height;
        this.ctx = this.canvas.getContext('2d')!;
    }

    /** Build the composite stream. Call after streams are ready. */
    async start(displayStream: MediaStream, webcamStream: MediaStream | null): Promise<MediaStream> {
        // ── screen video ────────────────────────────────────────────
        this.screenEl = document.createElement('video');
        this.screenEl.srcObject = displayStream;
        this.screenEl.muted = true;
        this.screenEl.playsInline = true;
        // Chrome: element must be in the live DOM to fire 'loadeddata'.
        this.screenEl.style.cssText =
            'position:fixed;left:-2px;top:-2px;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;';
        document.body.appendChild(this.screenEl);

        // Remember which surface was actually shared — chrome cropping only makes
        // sense for the page's own browser window, not a monitor/tab/other window.
        const dtrack = displayStream.getVideoTracks()[0];
        this.surface = (dtrack?.getSettings?.() as any)?.displaySurface;

        await new Promise<void>((resolve) => {
            const el = this.screenEl!;
            if (el.readyState >= 2 || el.videoWidth > 0) { resolve(); return; }
            // Resolve as soon as dimensions are known (loadedmetadata) or a frame
            // is decoded (loadeddata), so computeCrop() runs with real dimensions
            // BEFORE captureStream() — the canvas is never resized mid-recording.
            el.addEventListener('loadedmetadata', () => resolve(), { once: true });
            el.addEventListener('loadeddata',     () => resolve(), { once: true });
            el.addEventListener('error',          () => resolve(), { once: true });
            setTimeout(resolve, 3000);
        });
        await this.screenEl.play().catch(() => {});

        // ── compute browser-chrome crop (constant for the whole session) ──
        this.computeCrop();

        // ── webcam video ────────────────────────────────────────────
        if (webcamStream) {
            this.webcamEl = document.createElement('video');
            this.webcamEl.srcObject = webcamStream;
            this.webcamEl.muted = true;
            this.webcamEl.playsInline = true;
            await this.webcamEl.play().catch(() => {});
        }

        // ── compositing loop ────────────────────────────────────────
        this.draw();

        this._stream = this.canvas.captureStream(this.opts.frameRate);
        return this._stream;
    }

    /**
     * Work out how many source pixels to crop off the top to remove the browser
     * toolbar (tab strip + address bar + bookmarks). The toolbar height is fixed
     * for a session, so this is computed once. When cropping, the canvas is
     * resized to the cropped content so the recording isn't vertically stretched.
     */
    private computeCrop(): void {
        const el = this.screenEl;
        if (!el) return;
        const ct = this.opts.cropTop;
        if (ct === 0) { this.cropTopPx = 0; return; }

        // Only crop the page's OWN browser window. A monitor or a single tab
        // ('browser' surface) has no toolbar band to remove, and cropping there
        // would slice real content. If the surface is unknown (engine doesn't
        // report it), honor the explicit opt-in as best-effort.
        if (this.surface === 'monitor' || this.surface === 'browser') {
            this.cropTopPx = 0;
            return;
        }

        const vw = el.videoWidth;
        const vh = el.videoHeight;
        if (!vw || !vh) {
            // No real frame yet — skip cropping rather than guessing from fallback
            // dimensions. We deliberately do NOT recompute later: resizing the
            // canvas after captureStream() would corrupt the live MediaRecorder
            // track. Worst case is an un-cropped (but valid) recording.
            this.cropTopPx = 0;
            return;
        }

        let cropCss = 0;
        if (ct === 'auto') {
            // outerHeight - innerHeight ≈ the browser's own chrome in CSS px.
            cropCss = Math.max(0, window.outerHeight - window.innerHeight);
        } else if (typeof ct === 'number') {
            cropCss = Math.max(0, ct);
        }

        if (cropCss > 0) {
            // Scale CSS px → source frame px (capture device-pixel ratio).
            const scale = vh / (window.outerHeight || vh);
            // Clamp so we never crop the whole frame away.
            this.cropTopPx = Math.min(Math.round(cropCss * scale), Math.max(0, vh - 100));
        } else {
            this.cropTopPx = 0;
        }

        // Resize canvas to the cropped content to avoid distortion — only while
        // no stream has been captured yet. Never resize a canvas that is already
        // feeding a live MediaRecorder (it corrupts the encoded track).
        if (this.cropTopPx > 0 && !this._stream) {
            this.canvas.width  = vw;
            this.canvas.height = vh - this.cropTopPx;
        }
    }

    private draw(): void {
        const { ctx, canvas, screenEl, webcamEl } = this;
        const opts = this.opts;
        if (!screenEl) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Screen — crop the browser chrome off the top (cropTopPx is 0 when disabled).
        const sw = screenEl.videoWidth  || canvas.width;
        const sh = screenEl.videoHeight || canvas.height;
        const sy = this.cropTopPx;
        ctx.drawImage(screenEl, 0, sy, sw, sh - sy, 0, 0, canvas.width, canvas.height);

        // Webcam overlay — skip when the camera is hidden. toggleCam() disables
        // the track (track.enabled=false), which feeds black frames rather than
        // pausing the element, so we must check the track, not webcamEl.paused.
        const camTrack = webcamEl?.srcObject instanceof MediaStream
            ? webcamEl.srcObject.getVideoTracks()[0]
            : null;
        const camVisible = !!webcamEl && !webcamEl.paused
            && !!camTrack && camTrack.enabled && camTrack.readyState === 'live';
        if (camVisible && webcamEl) {
            const tw = Math.round(canvas.width * opts.webcamScale);
            const th = Math.round(tw * (webcamEl.videoHeight / (webcamEl.videoWidth || 1)));
            const pad = opts.webcamPadding;
            const [tx, ty] = this.thumbPosition(tw, th, pad, canvas.width, canvas.height);

            ctx.save();
            if (opts.webcamBorderRadius > 0) {
                ctx.beginPath();
                ctx.roundRect(tx, ty, tw, th, opts.webcamBorderRadius);
                ctx.clip();
            }
            // Mirror webcam (natural front-cam look)
            ctx.translate(tx + tw, ty);
            ctx.scale(-1, 1);
            ctx.drawImage(webcamEl, 0, 0, tw, th);
            ctx.restore();
        }

        this.rafId = requestAnimationFrame(() => this.draw());
    }

    private thumbPosition(tw: number, th: number, pad: number, cw: number, ch: number): [number, number] {
        switch (this.opts.webcamPosition) {
            case 'bottom-left':  return [pad, ch - th - pad];
            case 'top-right':    return [cw - tw - pad, pad];
            case 'top-left':     return [pad, pad];
            case 'bottom-right':
            default:             return [cw - tw - pad, ch - th - pad];
        }
    }

    get stream(): MediaStream | null { return this._stream; }

    stop(): void {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
        if (this.screenEl) {
            this.screenEl.srcObject = null;
            document.body.removeChild(this.screenEl);
            this.screenEl = null;
        }
        if (this.webcamEl) {
            this.webcamEl.srcObject = null;
            this.webcamEl = null;
        }
        this._stream?.getTracks().forEach(t => t.stop());
        this._stream = null;
    }
}
