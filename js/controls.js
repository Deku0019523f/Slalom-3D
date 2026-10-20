// Contrôles : clavier, boutons tactiles (multi-touch), glisser sur la piste. Tous utilisables en même temps.
const LEFT_KEYS = new Set(['ArrowLeft', 'a', 'A', 'q', 'Q']);
const RIGHT_KEYS = new Set(['ArrowRight', 'd', 'D']);
const JUMP_KEYS = new Set([' ', 'ArrowUp', 'w', 'W', 'z', 'Z']);
const BLOCK_DEFAULT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ']);

function isTypingTarget(t) {
    if (!t || !t.tagName) return false;
    const tag = t.tagName.toLowerCase();
    return tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button' || t.isContentEditable;
}

export class Controls {
    /**
     * @param o { canvas, btnLeft, btnRight, btnJump, isPlaying():bool, onPause(), onCamera(), onMute(), onGesture(), onStartKey() }
     */
    constructor(o) {
        this.o = o;
        this.keyLeft = false;
        this.keyRight = false;
        this.padLeft = new Set();
        this.padRight = new Set();
        this.dragId = null;
        this.dragTarget = 0;     // position cible normalisée -1..1
        this.jumpQueued = false;
        this._bindKeys();
        this._bindButton(o.btnLeft, this.padLeft);
        this._bindButton(o.btnRight, this.padRight);
        this._bindJump(o.btnJump);
        this._bindDrag(o.canvas);
        window.addEventListener('blur', () => this.reset());
        // Empêche le menu contextuel (appui long mobile) et le défilement pendant la partie
        document.addEventListener('contextmenu', (e) => { if (o.isPlaying()) e.preventDefault(); });
        document.addEventListener('touchmove', (e) => { if (o.isPlaying()) e.preventDefault(); }, { passive: false });
    }

    reset() {
        this.keyLeft = this.keyRight = false;
        this.padLeft.clear();
        this.padRight.clear();
        this.dragId = null;
        this.jumpQueued = false;
        this.o.btnLeft.classList.remove('active');
        this.o.btnRight.classList.remove('active');
        this.o.btnJump.classList.remove('active');
    }

    _syncButtons() {
        this.o.btnLeft.classList.toggle('active', this.keyLeft || this.padLeft.size > 0);
        this.o.btnRight.classList.toggle('active', this.keyRight || this.padRight.size > 0);
    }

    _bindKeys() {
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const typing = isTypingTarget(e.target);
            const playing = this.o.isPlaying();
            if (playing && BLOCK_DEFAULT.has(e.key)) e.preventDefault();
            if (LEFT_KEYS.has(e.key)) { this.keyLeft = true; this.o.onGesture(); }
            else if (RIGHT_KEYS.has(e.key)) { this.keyRight = true; this.o.onGesture(); }
            else if (JUMP_KEYS.has(e.key) && playing && !e.repeat) { this.jumpQueued = true; this.o.btnJump.classList.add('active'); }
            this._syncButtons();
            if (typing) return;
            if (e.key === 'c' || e.key === 'C' || e.key === 'v' || e.key === 'V') { if (!e.repeat) this.o.onCamera(); }
            else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (!e.repeat) this.o.onPause(); }
            else if (e.key === 'm' || e.key === 'M') { if (!e.repeat) this.o.onMute(); }
            else if ((e.key === 'Enter' || e.key === ' ') && !playing) { if (!e.repeat) this.o.onStartKey(); }
        });
        window.addEventListener('keyup', (e) => {
            if (LEFT_KEYS.has(e.key)) this.keyLeft = false;
            else if (RIGHT_KEYS.has(e.key)) this.keyRight = false;
            else if (JUMP_KEYS.has(e.key)) this.o.btnJump.classList.remove('active');
            this._syncButtons();
        });
    }

    _bindButton(btn, set) {
        const down = (e) => {
            e.preventDefault();
            this.o.onGesture();
            set.add(e.pointerId);
            try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
            this._syncButtons();
        };
        const up = (e) => {
            set.delete(e.pointerId);
            this._syncButtons();
        };
        btn.addEventListener('pointerdown', down);
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
        btn.addEventListener('lostpointercapture', up);
    }

    _bindJump(btn) {
        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this.o.onGesture();
            this.jumpQueued = true;
            btn.classList.add('active');
        });
        const off = () => btn.classList.remove('active');
        btn.addEventListener('pointerup', off);
        btn.addEventListener('pointercancel', off);
        btn.addEventListener('pointerleave', off);
    }

    _bindDrag(canvas) {
        canvas.addEventListener('pointerdown', (e) => {
            if (!this.o.isPlaying() || this.dragId !== null) return;
            this.o.onGesture();
            this.dragId = e.pointerId;
            this._setDrag(e.clientX);
        });
        window.addEventListener('pointermove', (e) => {
            if (e.pointerId !== this.dragId) return;
            this._setDrag(e.clientX);
        });
        const end = (e) => { if (e.pointerId === this.dragId) this.dragId = null; };
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
    }

    _setDrag(clientX) {
        this.dragTarget = (clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    }

    get dragging() { return this.dragId !== null; }

    /**
     * Direction demandée, de -1 (gauche) à +1 (droite).
     * relX : position du skieur par rapport au centre de la piste ; halfW : demi-largeur de piste.
     */
    turn(relX, halfW) {
        const l = this.keyLeft || this.padLeft.size > 0;
        const r = this.keyRight || this.padRight.size > 0;
        if (l !== r) return l ? -1 : 1;
        if (l && r) return 0;
        if (this.dragId !== null) {
            const target = this.dragTarget * (halfW - 1.5);
            const diff = target - relX;
            if (Math.abs(diff) > 0.35) return Math.max(-1, Math.min(1, diff * 0.35));
        }
        return 0;
    }

    consumeJump() {
        const j = this.jumpQueued;
        this.jumpQueued = false;
        return j;
    }
}

/** Vibration courte (mobiles compatibles uniquement). */
export function vibrate(ms, enabled) {
    if (!enabled) return;
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignoré */ }
}
