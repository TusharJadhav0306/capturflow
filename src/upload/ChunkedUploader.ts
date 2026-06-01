import type { UploadConfig } from '../types.js';

export interface UploadResult {
    response: unknown;
    durationMs: number;
}

/**
 * Splits a Blob into fixed-size chunks and uploads them in parallel with retry.
 * Each chunk is sent as a multipart/form-data POST with metadata fields:
 *   - chunkIndex  (0-based)
 *   - totalChunks
 *   - mimeType
 */
export class ChunkedUploader {
    private config: Required<Omit<UploadConfig, 'onProgress'>> & Pick<UploadConfig, 'onProgress'>;

    constructor(config: UploadConfig) {
        this.config = {
            url:       config.url,
            chunkSize: config.chunkSize  ?? 2 * 1024 * 1024,
            parallel:  config.parallel   ?? 3,
            retries:   config.retries    ?? 3,
            // Strip any Content-Type: fetch must set multipart/form-data with its
            // own boundary, and a user-supplied Content-Type would silently break
            // every chunk upload server-side.
            headers:   Object.fromEntries(
                Object.entries(config.headers ?? {}).filter(
                    ([k]) => k.toLowerCase() !== 'content-type',
                ),
            ),
            onProgress: config.onProgress,
        };
    }

    async upload(blob: Blob, mimeType: string): Promise<UploadResult> {
        const startedAt    = Date.now();
        const { chunkSize } = this.config;
        const totalChunks  = Math.ceil(blob.size / chunkSize);
        let uploadedBytes  = 0;
        let completed      = 0;
        let finalResponse: unknown = null;

        const uploadChunk = async (index: number): Promise<void> => {
            const start = index * chunkSize;
            const chunk = blob.slice(start, start + chunkSize);

            const body = new FormData();
            body.append('chunk',       chunk,           `chunk-${index}`);
            body.append('chunkIndex',  String(index));
            body.append('totalChunks', String(totalChunks));
            body.append('mimeType',    mimeType);

            for (let attempt = 0; attempt <= this.config.retries; attempt++) {
                try {
                    const res = await fetch(this.config.url, {
                        method: 'POST',
                        headers: this.config.headers,
                        body,
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    uploadedBytes += chunk.size;
                    this.config.onProgress?.(
                        Math.round((uploadedBytes / blob.size) * 100),
                        uploadedBytes,
                        blob.size,
                    );
                    // The server can only finalize once every chunk has arrived,
                    // so capture the response from the LAST chunk to complete in
                    // wall-clock order (not the highest index — chunks upload in
                    // parallel and a low index may finish last after a retry).
                    if (++completed === totalChunks) {
                        try { finalResponse = await res.clone().json(); }
                        catch { try { finalResponse = await res.text(); } catch { /* no body */ } }
                    }
                    return;
                } catch (err) {
                    if (attempt === this.config.retries) throw err;
                    await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
                }
            }
        };

        // Upload in parallel windows
        const queue = Array.from({ length: totalChunks }, (_, i) => i);
        const inFlight: Promise<void>[] = [];

        while (queue.length > 0 || inFlight.length > 0) {
            while (inFlight.length < this.config.parallel && queue.length > 0) {
                const idx = queue.shift()!;
                const p = uploadChunk(idx).then(() => {
                    inFlight.splice(inFlight.indexOf(p), 1);
                });
                inFlight.push(p);
            }
            if (inFlight.length > 0) await Promise.race(inFlight);
        }

        return { response: finalResponse, durationMs: Date.now() - startedAt };
    }
}
