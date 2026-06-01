import type { OutputConfig } from '../types.js';

export interface RecorderOptions extends OutputConfig {
    mimeType: string;
    onChunk: (chunk: Blob, index: number) => void;
}

/**
 * Thin, typed wrapper around the browser's MediaRecorder API with:
 *   - pause / resume
 *   - chunk accumulation + callbacks
 *   - elapsed time tracking (paused time excluded)
 *   - final Blob assembly + optional WebM duration fix
 */
export class Recorder {
    private mr: MediaRecorder | null = null;
    private chunks: Blob[] = [];
    private chunkIndex = 0;
    private startedAt = 0;
    private pausedAt  = 0;
    private totalPausedMs = 0;
    private opts: RecorderOptions;

    constructor(opts: RecorderOptions) {
        this.opts = opts;
    }

    start(stream: MediaStream): void {
        const bits = {
            videoBitsPerSecond: this.opts.videoBitsPerSecond ?? 2_500_000,
            audioBitsPerSecond: this.opts.audioBitsPerSecond ?? 128_000,
        };
        // Construct defensively: isTypeSupported can report a codec the browser
        // then refuses to encode for this particular stream (seen on Safari with
        // canvas captureStream + mp4). Fall back through safe types, then let the
        // browser choose. Sync this.opts.mimeType to whatever actually starts so
        // stop()'s blob type and the WebM duration-fix gate stay consistent.
        const candidates = [
            this.opts.mimeType,
            'video/webm;codecs=vp8,opus',
            'video/webm',
            'video/mp4',
        ];
        let mr: MediaRecorder | null = null;
        for (const type of candidates) {
            if (!type) continue;
            try {
                mr = new MediaRecorder(stream, { mimeType: type, ...bits });
                this.opts.mimeType = mr.mimeType || type;
                break;
            } catch { /* unsupported for this stream — try the next */ }
        }
        if (!mr) {
            // Last resort: let the browser pick container + codecs itself.
            mr = new MediaRecorder(stream);
            this.opts.mimeType = mr.mimeType || 'video/webm';
        }

        mr.ondataavailable = (e) => {
            if (!e.data || e.data.size === 0) return;
            this.chunks.push(e.data);
            this.opts.onChunk(e.data, this.chunkIndex++);
        };

        mr.start(1000); // 1-second slices for chunked upload
        this.startedAt = Date.now();
        this.mr = mr;
    }

    pause(): void {
        if (this.mr?.state === 'recording') {
            this.mr.pause();
            this.pausedAt = Date.now();
        }
    }

    resume(): void {
        if (this.mr?.state === 'paused') {
            this.mr.resume();
            this.totalPausedMs += Date.now() - this.pausedAt;
            this.pausedAt = 0;
        }
    }

    /** Stop recording and return the final Blob (with optional duration fix). */
    async stop(): Promise<{ blob: Blob; durationMs: number; mimeType: string }> {
        const durationMs = this.elapsedMs();

        await new Promise<void>((resolve) => {
            if (!this.mr || this.mr.state === 'inactive') { resolve(); return; }
            this.mr.onstop = () => resolve();
            this.mr.stop();
        });

        let blob = new Blob(this.chunks, { type: this.opts.mimeType });

        // Fix WebM duration metadata (MediaRecorder does not write it)
        if (this.opts.fixDuration !== false && this.opts.mimeType.includes('webm')) {
            try {
                const fixWebmDuration = (await import('fix-webm-duration')).default;
                blob = await fixWebmDuration(blob, durationMs, { logger: false });
            } catch {
                // fix-webm-duration not installed or failed — return as-is
            }
        }

        return { blob, durationMs, mimeType: this.opts.mimeType };
    }

    /** Elapsed recording time in ms (paused periods excluded). */
    elapsedMs(): number {
        if (!this.startedAt) return 0;
        const now = Date.now();
        const paused = this.totalPausedMs + (this.pausedAt ? now - this.pausedAt : 0);
        return now - this.startedAt - paused;
    }

    /** The mimeType actually in use (may differ from the requested one after fallback). */
    get mimeType(): string { return this.opts.mimeType; }

    get state(): MediaRecorder['state'] | 'unstarted' {
        return this.mr?.state ?? 'unstarted';
    }

    get isRecording(): boolean { return this.mr?.state === 'recording'; }
    get isPaused():    boolean { return this.mr?.state === 'paused'; }
}
