import type { PipConfig, PipStrategy } from '../types.js';
import { detect } from '../detect/BrowserOS.js';

export interface PipCallbacks {
    onOpen:  (strategy: PipStrategy) => void;
    onClose: () => void;
}

/**
 * PipManager — picks the right PiP strategy for the current browser/OS and
 * manages the lifecycle of the overlay window / element.
 *
 * Strategies (in priority order):
 *
 * 1. document-pip  — Chrome/Edge/Opera desktop (Chromium 116+); not Firefox/Safari
 *    Opens a real always-on-top OS window containing arbitrary HTML.
 *    MUST be called AFTER getDisplayMedia resolves on Chrome (the "Share"
 *    click grants fresh user activation; calling before puts the PiP window
 *    in the share picker list).
 *
 * 2. popup  — Mac Firefox/Opera/Safari
 *    Uses window.open() which MUST be called synchronously before the async
 *    getDisplayMedia call (transient user activation is consumed by the
 *    async permission dialog on Mac).
 *
 * 3. floating  — Universal fallback
 *    Injects a fixed-position draggable overlay inside the main document.
 */
export class PipManager {
    private config: PipConfig;
    private env = detect();
    private strategy: PipStrategy;
    private pipWin: Window | null = null;
    private floatEl: HTMLElement | null = null;
    private callbacks: PipCallbacks;
    /** Guards onClose so a normal stop + a window 'close' don't double-fire it. */
    private closeNotified = false;
    /** Poll handle that watches for the user closing a popup window. */
    private popupWatch: ReturnType<typeof setInterval> | null = null;
    /** Popup readiness timers — tracked so a failed start can't leave them running. */
    private setupCheck: ReturnType<typeof setInterval> | null = null;
    private setupTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor(config: PipConfig, callbacks: PipCallbacks) {
        this.config = config;
        this.callbacks = callbacks;

        const requested = config.strategy ?? 'auto';
        let strat: PipStrategy = requested === 'auto'
            ? this.env.recommendedPipStrategy
            : requested as PipStrategy;
        // Coerce an explicit but unsupported strategy to a working one instead of
        // aborting recording later (e.g. 'document-pip' requested on Firefox/Safari,
        // where openDocumentPip() would throw and fail the whole start()).
        if (strat === 'document-pip' && !this.env.documentPipSupported) {
            strat = this.env.recommendedPipStrategy === 'document-pip'
                ? 'floating'
                : this.env.recommendedPipStrategy;
        }
        this.strategy = strat;
    }

    get currentStrategy(): PipStrategy { return this.strategy; }
    get isOpen(): boolean {
        return this.strategy === 'floating'
            ? this.floatEl !== null
            : this.pipWin !== null && !this.pipWin.closed;
    }

    /**
     * For Mac popup strategy: call this SYNCHRONOUSLY (no await) before
     * getDisplayMedia — opens the popup window while user activation is live.
     * Returns a Promise that resolves once the popup is ready.
     */
    openPopupSync(): Promise<Window> {
        const w = this.config.width  ?? 240;
        const h = this.config.height ?? 220;
        const left = Math.max(0, (screen.availWidth - w - 20));
        const top  = 40;

        const win = window.open(
            'about:blank',
            'CapturFlowWidget',
            `popup=yes,width=${w},height=${h},left=${left},top=${top},` +
            'menubar=no,toolbar=no,location=no,status=no',
        );
        if (!win) return Promise.reject(new Error('Popup blocked'));
        this.pipWin = win;
        this.closeNotified = false;
        this.clearSetupTimers();

        return new Promise((resolve, reject) => {
            this.setupTimeout = setTimeout(() => {
                this.clearSetupTimers();
                reject(new Error('Popup setup timeout'));
            }, 5000);
            this.setupCheck = setInterval(() => {
                // Bail if this window is no longer the active one (a failed start
                // closed it and nulled pipWin) — prevents firing onOpen on, or
                // re-watching, an orphaned/closed window.
                if (this.pipWin !== win) { this.clearSetupTimers(); return; }
                if (win.document.readyState === 'complete') {
                    this.clearSetupTimers();
                    this.initWindow(win);
                    // Fire the same lifecycle event as the other strategies.
                    this.callbacks.onOpen('popup');
                    // Detect the user closing the popup window (no pagehide on
                    // some browsers for popups) so recording can be stopped.
                    if (this.popupWatch) clearInterval(this.popupWatch);
                    this.popupWatch = setInterval(() => {
                        if (!this.pipWin || this.pipWin.closed) {
                            this.pipWin = null;
                            this.notifyClose();
                        }
                    }, 500);
                    resolve(win);
                }
            }, 50);
        });
    }

    /** Stop the popup readiness poller/timeout (idempotent). */
    private clearSetupTimers(): void {
        if (this.setupCheck)   { clearInterval(this.setupCheck);   this.setupCheck = null; }
        if (this.setupTimeout) { clearTimeout(this.setupTimeout);  this.setupTimeout = null; }
    }

    /**
     * For document-pip strategy: call this AFTER getDisplayMedia resolves.
     * Chrome grants fresh activation from the "Share" button click.
     */
    async openDocumentPip(): Promise<Window> {
        const pip = (window as any).documentPictureInPicture;
        if (!pip) throw new Error('Document PiP not supported');

        const w = this.config.width  ?? 240;
        const h = this.config.height ?? 220;

        const win = await Promise.race([
            pip.requestWindow({ width: w, height: h }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Document PiP requestWindow timed out (8s)')), 8000),
            ),
        ]) as Window;

        // Set title immediately — prevents the URL from flashing in the OS taskbar
        win.document.title = this.config.title ?? 'Recording';
        this.pipWin = win;
        this.closeNotified = false;
        this.initWindow(win);

        // Detect genuine close (macOS fires spurious pagehide on focus shifts)
        win.addEventListener('pagehide', () => {
            setTimeout(() => {
                if (!this.pipWin || this.pipWin.closed) {
                    this.pipWin = null;
                    this.notifyClose();
                }
            }, 250);
        });

        this.callbacks.onOpen('document-pip');
        return win;
    }

    /** Mount the floating in-page overlay (universal fallback). */
    openFloating(container: HTMLElement): void {
        this.floatEl = container;
        this.closeNotified = false;
        const w = this.config.width  ?? 240;
        const h = this.config.height ?? 220;
        container.style.cssText =
            'position:fixed;right:24px;bottom:24px;z-index:9997;' +
            `width:${w}px;height:${h}px;border-radius:14px;overflow:hidden;` +
            'box-shadow:0 20px 50px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.07);' +
            'background:rgba(15,23,42,.92);pointer-events:auto;';
        document.body.appendChild(container);
        this.callbacks.onOpen('floating');
    }

    /** Move a DOM element into the active pip/popup window. */
    async mountWidget(el: HTMLElement): Promise<void> {
        if (this.strategy === 'floating') {
            this.floatEl?.appendChild(el);
            return;
        }
        if (!this.pipWin) throw new Error('PiP window not open');
        this.pipWin.document.body.appendChild(el);
        // Force wait one rAF so the browser processes the DOM move before
        // the caller tries to re-attach media streams
        await new Promise(r => this.pipWin!.requestAnimationFrame(r));
    }

    /** Copy main document stylesheets into the pip/popup window. */
    copyStyles(win: Window): void {
        for (const sheet of Array.from(document.styleSheets)) {
            try {
                const css = Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
                const style = win.document.createElement('style');
                style.textContent = css;
                win.document.head.appendChild(style);
            } catch {
                if ((sheet as any).href) {
                    const link = win.document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = (sheet as any).href;
                    win.document.head.appendChild(link);
                }
            }
        }
    }

    close(): void {
        if (this.pipWin && !this.pipWin.closed) {
            this.pipWin.close();
            this.pipWin = null;
        }
        if (this.floatEl?.parentNode) {
            this.floatEl.parentNode.removeChild(this.floatEl);
            this.floatEl = null;
        }
        this.notifyClose();
    }

    /** Fire onClose exactly once per open/close cycle (popup poll, pagehide, and
     *  an explicit close() can all race to report the same close). */
    private notifyClose(): void {
        this.clearSetupTimers();
        if (this.popupWatch) { clearInterval(this.popupWatch); this.popupWatch = null; }
        if (this.closeNotified) return;
        this.closeNotified = true;
        this.callbacks.onClose();
    }

    private initWindow(win: Window): void {
        this.copyStyles(win);
        win.document.documentElement.style.cssText = 'height:100%;margin:0;';
        win.document.body.style.cssText =
            'height:100vh;margin:0;padding:0;overflow:hidden;' +
            'background:rgba(15,23,42,.92);color-scheme:dark;';
        // Sync dark/light class
        win.document.documentElement.classList.add(
            document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        );
    }
}
