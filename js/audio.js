// Gestion des effets sonores avec la Web Audio API (aucun fichier audio externe).
// Le contexte n'est créé qu'après une interaction de l'utilisateur (restrictions des navigateurs mobiles).
export class SoundManager {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.muted = false;
        this._volume = 0.8;
        this.ambienceOn = true;
        this.initialized = false;
        this.noiseBuffer = null;
        this.skiGainNode = null;
        this.skiFilterNode = null;
        this.windGain = null;
        this.windFilter = null;
        this._windT = 0;
    }

    // Compatibilité avec la version d'origine : masterVolume 0..1
    get masterVolume() { return this._volume; }
    set masterVolume(v) {
        this._volume = Math.max(0, Math.min(1, v));
        this._applyMaster();
    }

    _applyMaster() {
        if (this.master && this.ctx) {
            this.master.gain.setTargetAtTime(this.muted ? 0 : this._volume, this.ctx.currentTime, 0.03);
        }
    }

    /** À appeler depuis un geste utilisateur (clic, toucher, touche). */
    init() {
        if (this.initialized) { this.resume(); return; }
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            this.ctx = new AC();
            this.master = this.ctx.createGain();
            this.master.gain.value = this.muted ? 0 : this._volume;
            this.master.connect(this.ctx.destination);
            this._makeNoise();
            this._setupContinuous();
            this.initialized = true;
            this.resume();
        } catch (e) {
            console.warn('Web Audio API non disponible :', e);
        }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    }
    suspend() {
        if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
    }

    _makeNoise() {
        const len = this.ctx.sampleRate * 2;
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuffer = buf;
    }

    _setupContinuous() {
        const ctx = this.ctx;
        // Glisse sur la neige : bruit filtré, piloté par la vitesse et les virages
        const ski = ctx.createBufferSource();
        ski.buffer = this.noiseBuffer; ski.loop = true;
        this.skiFilterNode = ctx.createBiquadFilter();
        this.skiFilterNode.type = 'bandpass';
        this.skiFilterNode.frequency.value = 700;
        this.skiFilterNode.Q.value = 1.8;
        this.skiGainNode = ctx.createGain();
        this.skiGainNode.gain.value = 0.0001;
        ski.connect(this.skiFilterNode); this.skiFilterNode.connect(this.skiGainNode); this.skiGainNode.connect(this.master);
        ski.start();

        // Vent de montagne : ambiance facultative
        const wind = ctx.createBufferSource();
        wind.buffer = this.noiseBuffer; wind.loop = true; wind.playbackRate.value = 0.6;
        this.windFilter = ctx.createBiquadFilter();
        this.windFilter.type = 'lowpass';
        this.windFilter.frequency.value = 380;
        this.windGain = ctx.createGain();
        this.windGain.gain.value = 0.0001;
        wind.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.master);
        wind.start();
    }

    setAmbience(on) {
        this.ambienceOn = !!on;
        if (!this.ctx) return;
        const target = on ? 0.035 : 0.0001;
        this.windGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4);
    }

    /** Appelée à chaque image de jeu. airborne : en l'air (glisse coupée), deep : neige profonde. */
    updateSkiSound(speedRatio, turnIntensity, isPlaying, extra = {}) {
        if (!this.initialized || !this.ctx) return;
        const now = this.ctx.currentTime;
        if (!isPlaying || this.muted) {
            this.skiGainNode.gain.setTargetAtTime(0.0001, now, 0.05);
            this.windGain.gain.setTargetAtTime(this.ambienceOn && !this.muted ? 0.03 : 0.0001, now, 0.3);
            return;
        }
        this.resume();
        const grounded = !extra.airborne;
        const base = 0.025 * speedRatio;
        const carve = 0.085 * turnIntensity * speedRatio;
        const deep = extra.deep ? 0.04 : 0;
        const skid = extra.skid ? 0.05 : 0;
        const target = grounded ? Math.min(0.17, base + carve + deep + skid) : 0.006;
        this.skiGainNode.gain.setTargetAtTime(Math.max(0.0001, target), now, 0.06);
        this.skiFilterNode.frequency.setTargetAtTime(500 + speedRatio * 550 + turnIntensity * 900 + (extra.skid ? 400 : 0), now, 0.06);
        const wind = (this.ambienceOn ? 0.03 : 0) + speedRatio * 0.05;
        this.windGain.gain.setTargetAtTime(Math.max(0.0001, wind), now, 0.25);
        this.windFilter.frequency.setTargetAtTime(300 + speedRatio * 700, now, 0.25);
    }

    // ---- Effets ponctuels -------------------------------------------------
    _ok() { return this.initialized && this.ctx && !this.muted && this._volume > 0; }

    _tone(type, f0, f1, dur, gain, delay = 0) {
        const t = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(f0, t);
        if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(g); g.connect(this.master);
        osc.start(t); osc.stop(t + dur + 0.02);
    }

    _burst(freq, type, dur, gain, delay = 0) {
        const t = this.ctx.currentTime + delay;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const f = this.ctx.createBiquadFilter();
        f.type = type; f.frequency.value = freq;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(f); f.connect(g); g.connect(this.master);
        src.start(t, Math.random()); src.stop(t + dur + 0.02);
    }

    playGatePass(combo) {
        if (!this._ok()) return;
        const f = 520 + Math.min(combo, 15) * 45;
        this._tone('triangle', f, f * 1.45, 0.25, 0.18);
    }
    playPerfect() {
        if (!this._ok()) return;
        this._tone('sine', 1320, 1760, 0.2, 0.12, 0.05);
    }
    playGateMiss() {
        if (!this._ok()) return;
        this._tone('sawtooth', 220, 125, 0.3, 0.14);
    }
    playChallengeUnlock() {
        if (!this._ok()) return;
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this._tone('triangle', f, f, 0.25, 0.2, i * 0.08));
    }
    playLevelUp() {
        if (!this._ok()) return;
        [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this._tone('triangle', f, f, 0.3, 0.2, i * 0.09));
    }
    playCoin() {
        if (!this._ok()) return;
        this._tone('square', 988, 988, 0.06, 0.07);
        this._tone('square', 1319, 1319, 0.12, 0.07, 0.06);
    }
    playHop() {
        if (!this._ok()) return;
        this._tone('sine', 220, 420, 0.14, 0.12);
        this._burst(1800, 'highpass', 0.08, 0.05);
    }
    playLand(intensity = 0.5) {
        if (!this._ok()) return;
        const k = Math.max(0.15, Math.min(1, intensity));
        this._tone('sine', 120, 50, 0.18, 0.25 * k);
        this._burst(900, 'lowpass', 0.18, 0.2 * k);
    }
    playStumble() {
        if (!this._ok()) return;
        this._tone('square', 160, 90, 0.16, 0.1);
        this._burst(1200, 'lowpass', 0.14, 0.18);
    }
    playCrash() {
        if (!this._ok()) return;
        this._tone('sine', 130, 28, 0.48, 0.4);
        this._burst(950, 'lowpass', 0.45, 0.35);
    }
    playCountdown(go = false) {
        if (!this._ok()) return;
        if (go) { this._tone('square', 880, 880, 0.35, 0.12); this._tone('square', 1320, 1320, 0.35, 0.08, 0.02); }
        else this._tone('square', 520, 520, 0.14, 0.1);
    }
    playFinish() {
        if (!this._ok()) return;
        [659.25, 783.99, 987.77, 1318.5].forEach((f, i) => this._tone('triangle', f, f, 0.4, 0.2, i * 0.11));
    }
    playClick() {
        if (!this._ok()) return;
        this._tone('triangle', 640, 520, 0.05, 0.06);
    }

    toggleMute() {
        this.muted = !this.muted;
        if (this.ctx && this.skiGainNode && this.muted) this.skiGainNode.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.03);
        this._applyMaster();
        return this.muted;
    }
    setMuted(m) {
        this.muted = !!m;
        this._applyMaster();
    }
}
