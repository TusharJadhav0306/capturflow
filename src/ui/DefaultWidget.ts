import type { PipMetadata, PipTheme, PipLabels } from '../types.js';

export interface WidgetCallbacks {
    onPause:  () => void;
    onResume: () => void;
    onStop:   () => void;
    onMicToggle: () => void;
    onCamToggle: () => void;
}

/** Inline SVG icons — render identically across every browser/OS, unlike emoji. */
const ICONS = {
    mic:    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>',
    micOff: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/></svg>',
    cam:    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
    camOff: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
    play:   '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
    pause:  '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
    stop:   '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
};

/**
 * Default PiP widget — built with vanilla JS + Shadow DOM so it renders
 * identically across browsers/OSes and survives being moved into a
 * Document-PiP / popup window (styles travel inside the shadow root).
 *
 * Layout (controls are pinned; the video shrinks to fit, never the reverse):
 *   ┌──────────────────────────────┐
 *   │  [camera feed — flexible]    │  ← grows/shrinks with window height
 *   │  John Smith       Case #123  │  ← info overlay, space-between
 *   ├──────────────────────────────┤
 *   │ 🎤 📷 ▶ ⏸          ■ Stop  │  ← controls, ALWAYS visible (fixed)
 *   └──────────────────────────────┘
 */
export class DefaultWidget {
    /** Host element — move THIS into the PiP window. Shadow DOM travels with it. */
    readonly root: HTMLElement;
    private shadow: ShadowRoot;
    private camVideoEl: HTMLVideoElement;
    private nameEl!: HTMLElement;
    private caseEl!: HTMLElement;
    private pauseBtn!: HTMLButtonElement;
    private resumeBtn!: HTMLButtonElement;
    private micBtn!: HTMLButtonElement;
    private camBtn!: HTMLButtonElement;

    constructor(
        private cbs: WidgetCallbacks,
        private opts: { theme?: PipTheme; labels?: PipLabels } = {},
    ) {
        this.root = document.createElement('div');
        this.root.className = 'cfpip-host';
        // Shadow DOM: full style isolation + styles move with the element
        // across document boundaries (Document PiP / popup windows).
        this.shadow = this.root.attachShadow({ mode: 'open' });

        this.camVideoEl = document.createElement('video');
        this.camVideoEl.autoplay = true;
        this.camVideoEl.playsInline = true;
        this.camVideoEl.muted = true;

        this.build();
        // Theme vars go on the HOST element (inline) — inline style travels with
        // the element into the PiP/popup document, and custom properties inherit
        // across the shadow boundary into :host's var() fallbacks.
        this.applyTheme(opts.theme);
    }

    private applyTheme(theme?: PipTheme): void {
        if (!theme) return;
        const s = this.root.style;
        if (theme.accent)     s.setProperty('--cf-accent', theme.accent);
        if (theme.background) s.setProperty('--cf-bg', theme.background);
        if (theme.text)       s.setProperty('--cf-text', theme.text);
        if (theme.mutedBg)    s.setProperty('--cf-muted-bg', theme.mutedBg);
    }

    private label(key: keyof PipLabels, fallback: string): string {
        return this.opts.labels?.[key] ?? fallback;
    }

    /** Attach a webcam MediaStream to the video element. */
    attachCamera(stream: MediaStream | null): void {
        // Always force-reassign srcObject — the element may have crossed a
        // document boundary (PiP window), which severs the media pipeline.
        this.camVideoEl.srcObject = stream;
        if (stream) this.camVideoEl.play().catch(() => {});
    }

    setPaused(paused: boolean): void {
        this.pauseBtn.classList.toggle('cfpip-dim', paused);
        this.resumeBtn.classList.toggle('cfpip-dim', !paused);
    }

    setMicMuted(muted: boolean): void {
        this.micBtn.classList.toggle('cfpip-off', muted);
        this.micBtn.innerHTML = muted ? ICONS.micOff : ICONS.mic;
        this.micBtn.title = muted ? this.label('unmute', 'Unmute microphone') : this.label('mute', 'Mute microphone');
    }

    setCamHidden(hidden: boolean): void {
        this.camBtn.classList.toggle('cfpip-off', hidden);
        this.camBtn.innerHTML = hidden ? ICONS.camOff : ICONS.cam;
        this.camBtn.title = hidden ? this.label('showCam', 'Show camera') : this.label('hideCam', 'Hide camera');
    }

    updateMetadata(meta: PipMetadata): void {
        const name = meta.name?.trim() ?? '';
        const caseId = meta.caseId?.trim() ?? '';
        this.nameEl.textContent = name || 'Recording';
        this.caseEl.textContent = caseId ? `Case #${caseId}` : '';
        this.caseEl.style.display = caseId ? '' : 'none';
    }

    private build(): void {
        const style = document.createElement('style');
        style.textContent = STYLES;

        // ── hero (camera + info overlay) ──
        const hero = document.createElement('div');
        hero.className = 'cfpip-hero';

        const cam = document.createElement('div');
        cam.className = 'cfpip-cam';
        cam.appendChild(this.camVideoEl);
        hero.appendChild(cam);

        const info = document.createElement('div');
        info.className = 'cfpip-info';
        this.nameEl = document.createElement('span');
        this.nameEl.className = 'cfpip-name';
        this.caseEl = document.createElement('span');
        this.caseEl.className = 'cfpip-case';
        info.append(this.nameEl, this.caseEl);
        hero.appendChild(info);

        // ── controls ──
        const controls = document.createElement('div');
        controls.className = 'cfpip-controls';

        this.micBtn    = this.btn(ICONS.mic,   this.label('mute', 'Mute microphone'),    'cfpip-ctrl', () => this.cbs.onMicToggle());
        this.camBtn    = this.btn(ICONS.cam,   this.label('hideCam', 'Hide camera'),     'cfpip-ctrl', () => this.cbs.onCamToggle());
        this.resumeBtn = this.btn(ICONS.play,  this.label('resume', 'Resume recording'), 'cfpip-ctrl cfpip-dim', () => this.cbs.onResume());
        this.pauseBtn  = this.btn(ICONS.pause, this.label('pause', 'Pause recording'),   'cfpip-ctrl', () => this.cbs.onPause());

        const stopBtn = document.createElement('button');
        stopBtn.className = 'cfpip-stop';
        stopBtn.title = this.label('stop', 'Stop recording');
        stopBtn.innerHTML = `${ICONS.stop}<span>Stop</span>`;
        stopBtn.addEventListener('click', () => this.cbs.onStop());

        controls.append(this.micBtn, this.camBtn, this.resumeBtn, this.pauseBtn, stopBtn);

        this.shadow.append(style, hero, controls);
    }

    private btn(svg: string, title: string, cls: string, handler: () => void): HTMLButtonElement {
        const b = document.createElement('button');
        b.innerHTML = svg;
        b.title = title;
        b.className = cls;
        b.addEventListener('click', handler);
        return b;
    }
}

/** All widget CSS — lives inside the shadow root, isolated from the host page. */
const STYLES = `
:host{
    display:flex; flex-direction:column;
    width:100%; height:100%; min-height:0;
    box-sizing:border-box; overflow:hidden;
    background:var(--cf-bg,rgba(15,23,42,.96)); color:var(--cf-text,#f8fafc);
    font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
}
*{box-sizing:border-box;}
/* Hero is flexible — it shrinks first so controls are never clipped. */
.cfpip-hero{
    position:relative; flex:1 1 auto; min-height:0;
    background:linear-gradient(135deg,#020617,#0f172a); overflow:hidden;
}
.cfpip-cam{position:absolute; inset:0;}
.cfpip-cam video{width:100%; height:100%; object-fit:cover; transform:scaleX(-1); display:block;}
.cfpip-info{
    position:absolute; left:0; right:0; bottom:0;
    display:flex; align-items:center; justify-content:space-between; gap:8px;
    padding:5px 9px;
    background:linear-gradient(to top,rgba(0,0,0,.8),rgba(0,0,0,0));
    pointer-events:none;
}
.cfpip-name{
    flex:1 1 auto; min-width:0;
    font-size:11px; font-weight:600; line-height:1.2; color:var(--cf-text,#f8fafc);
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.cfpip-case{
    flex:0 0 auto;
    font-size:10px; font-weight:700; color:#34d399; white-space:nowrap;
}
/* Controls are pinned: fixed height, never wrap, always visible. */
.cfpip-controls{
    flex:0 0 auto;
    display:flex; flex-wrap:nowrap; align-items:center; gap:5px;
    padding:7px 9px;
    border-top:1px solid rgba(255,255,255,.08); background:rgba(0,0,0,.35);
}
.cfpip-ctrl{
    flex:0 0 auto;
    width:30px; height:30px; padding:0; border:0; border-radius:8px;
    background:var(--cf-muted-bg,rgba(255,255,255,.08)); color:var(--cf-text,#f8fafc); cursor:pointer;
    display:inline-flex; align-items:center; justify-content:center;
    transition:background .15s,opacity .15s;
}
.cfpip-ctrl:hover{background:rgba(255,255,255,.16);}
.cfpip-ctrl.cfpip-off{background:rgba(239,68,68,.3); color:#fecaca;}
.cfpip-dim{opacity:.32; pointer-events:none;}
.cfpip-stop{
    flex:0 0 auto; margin-left:auto;
    height:30px; padding:0 12px; border:0; border-radius:8px;
    background:var(--cf-accent,#ef4444); color:#fff; cursor:pointer;
    display:inline-flex; align-items:center; gap:5px;
    font-size:12px; font-weight:700; line-height:1;
    transition:background .15s;
}
.cfpip-stop:hover{background:#dc2626;}
.cfpip-stop svg{flex:0 0 auto;}
`;
