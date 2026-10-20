// Boucle principale et machine d'états : menu → compte à rebours → course → pause → résultat.
// Relie la scène 3D, la physique, les modes, la progression, l'audio, les contrôles et l'interface.
import * as THREE from './vendor/three.module.min.js';
import { TRACKS, getTrack, resolveAmbience, clamp, DIST_FACTOR } from './tracks.js';
import { Course } from './obstacles.js';
import { SkierPhysics, PHYS } from './physics.js';
import { resolveLoadout, purchase, syncUnlocks, findItem } from './characters.js';
import { createArticulatedSkierAvatar } from './avatar.js';
import { sanitizeAvatar } from './avatar-config.js';
import { MODES, createRun, evaluateEnd, trialValue, courseLengthM, courseSeed, getTrial } from './modes.js';
import { applyRunResult, checkTrophies, getBest, isTrackUnlocked, levelOf } from './progression.js';
import { CAMERA_PRESETS } from './settings.js';
import { Controls, vibrate } from './controls.js';
import { UI } from './ui.js';

const COUNTDOWN_STEPS = [['3', 0], ['2', 0.65], ['1', 1.3], ['GO !', 1.95]];
const RAMP_UP = 0.12;

export class Game {
    /**
     * @param o { scene: SceneManager, sound: SoundManager, settings: SettingsManager, store: { getSave, persist, persistNow, resetProgress } }
     */
    constructor(o) {
        this.scene = o.scene;
        this.sound = o.sound;
        this.settings = o.settings;
        this.store = o.store;
        this.state = 'menu';          // menu | countdown | playing | paused | result
        this.pausedFrom = null;
        this.time = 0;
        this.course = null;
        this.track = null;
        this.phys = null;
        this.run = null;
        this.pendingEnd = null;
        this.camIdx = this.settings.values.defaultCamera;
        this.camPos = new THREE.Vector3(0, 8, 12);
        this.camLook = new THREE.Vector3(0, 1, 0);
        this.fovCur = CAMERA_PRESETS[this.camIdx].baseFov;
        this.shake = 0;
        this.sprayAcc = 0;
        this.lastTrailZ = 0;
        this.trophyT = 0;
        this.hudT = 0;
        this.fpsAvg = 60;
        this.fpsT = 0;
        this.audioT = 0;
        this.cdIndex = -1;
        this.cdT = 0;
        this.goHideT = 0;
        this.menuView = 'default';
        this.contextLost = false;
        this._previewTimer = 0;
        this._audioReady = false;
        this._lastFrame = 0;
        this._raf = 0;
        this._tmpV = new THREE.Vector3();

        this.skier = createArticulatedSkierAvatar();
        // Caméra d'inspection de l'avatar (onglet « Avatar 3D » et aperçu plein écran)
        this.inspect = { yaw: Math.PI * 0.86, pitch: 0.18, dist: 4.6, auto: true, target: null, demo: 'idle', preview: false };
        this.scene.scene.add(this.skier.root);

        this.ui = new UI({
            getSave: this.store.getSave,
            persist: this.store.persist,
            settings: this.settings,
            handlers: this._handlers()
        });

        const $ = (id) => this.ui.$(id);
        this.controls = new Controls({
            canvas: $('game-canvas'),
            btnLeft: $('btn-left'), btnRight: $('btn-right'), btnJump: $('btn-jump'),
            isPlaying: () => this.state === 'playing' || this.state === 'countdown',
            onPause: () => this.togglePause(),
            onCamera: () => this.cycleCamera(),
            onMute: () => this.toggleMute(),
            onGesture: () => this.onGesture(),
            onStartKey: () => this.onStartKey()
        });

        // Première gesture : le contexte audio ne peut démarrer qu'après une interaction
        const first = () => { this.onGesture(); };
        window.addEventListener('pointerdown', first, { capture: true });
        window.addEventListener('keydown', first, { capture: true });

        this.settings.onChange((v, changed) => this._onSettingChange(v, changed));
        this.sound.masterVolume = this.settings.values.volume / 100;

        window.addEventListener('resize', () => this._onResize());
        window.addEventListener('orientationchange', () => setTimeout(() => this._onResize(), 150));
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.autoPause(); else this.sound.resume();
        });
        window.addEventListener('blur', () => this.autoPause());
        window.addEventListener('pagehide', () => this.autoPause());

        this.scene.onContextLost = () => {
            this.contextLost = true;
            this.ui.setContextLost(true);
            this.autoPause();
        };
        this.scene.onContextRestored = () => {
            this.contextLost = false;
            this.ui.setContextLost(false);
        };

        this._dress();
        this._bindInspectInput();
        this.ui.setSoundIcon(this.sound.muted);
        this.ui.setCameraLabel(CAMERA_PRESETS[this.camIdx].name);
    }

    get save() { return this.store.getSave(); }

    // ------------------------------------------------------------------ gestionnaires de l'interface
    _handlers() {
        return {
            onClick: () => { this.sound.playClick(); },
            onStart: () => this.startRun(),
            onResume: () => this.resume(),
            onPause: () => this.togglePause(),
            onRestart: () => { this._abandonRun(); this.startRun(); },
            onMenu: () => this.toMenu(),
            onCamera: () => this.cycleCamera(),
            onSound: () => this.toggleMute(),
            onSetting: (p) => this.settings.set(p),
            onEquip: (cat, id) => this.equip(cat, id),
            onBuy: (cat, id) => this.buy(cat, id),
            onReset: () => this.resetProgress(),
            onSelectionChange: () => this.schedulePreview(),
            onTab: (name) => { this.menuView = name === 'tab-avatar' ? 'avatar' : name === 'tab-equipment' ? 'equip' : 'default'; this._applyFraming(); },
            onAvatar: (patch) => this.setAvatar(patch),
            onAvatarReset: () => this.resetAvatar(),
            onView: (v) => this.setInspectView(v),
            onDemo: (d) => { this.inspect.demo = d; },
            onPreview: (on) => this.setPreview(on)
        };
    }

    onGesture() {
        if (this._audioReady) { this.sound.resume(); return; }
        this._audioReady = true;
        this.sound.init();
        this.sound.setAmbience(this.settings.values.ambience);
        this.sound.masterVolume = this.settings.values.volume / 100;
    }

    onStartKey() {
        if (this.ui.screen === 'start' && this.state === 'menu') {
            if (this.ui.tab === 'tab-play') this.startRun();
        } else if (this.state === 'result') {
            this.startRun();
        } else if (this.state === 'paused') {
            this.resume();
        }
    }

    _onSettingChange(v, changed) {
        for (const k of changed) {
            switch (k) {
                case 'volume': this.sound.masterVolume = v.volume / 100; break;
                case 'ambience': this.sound.setAmbience(v.ambience); break;
                case 'graphics': this.scene.applyProfile(this.settings.profile); this._applyFraming(); break;
                case 'weather': if (this.track) this.scene.applyAmbience(resolveAmbience(this.track, v.weather)); break;
                case 'sensitivity': if (this.phys) this.phys.sensitivity = v.sensitivity; break;
                case 'defaultCamera':
                    if (this.state === 'menu') { this.camIdx = v.defaultCamera; this.ui.setCameraLabel(CAMERA_PRESETS[this.camIdx].name); }
                    break;
                default: break;
            }
        }
        this.ui.syncSettingsForm();
    }

    // ------------------------------------------------------------------ avatar 3D
    _dress() {
        const save = this.store.getSave();
        this.skier.apply(resolveLoadout(save), save.avatar);
    }

    setAvatar(patch) {
        const save = this.save;
        save.avatar = sanitizeAvatar({ ...save.avatar, ...patch });
        this.store.persist();
        this._dress();
    }

    resetAvatar() {
        const save = this.save;
        const bib = save.avatar ? save.avatar.bib : 225;
        save.avatar = sanitizeAvatar({ bib });     // couleurs et style du catalogue, numéro conservé
        this.store.persist();
        this._dress();
    }

    /** face | side | back : se place devant / à côté / derrière ; auto : rotation continue à 360°. */
    setInspectView(v) {
        const i = this.inspect;
        const angles = { face: 0, side: Math.PI / 2, back: Math.PI };
        if (v === 'auto') { i.auto = true; i.target = null; return; }
        i.auto = false;
        // Plus court chemin vers l'angle demandé
        const cur = i.yaw, base = angles[v] ?? 0;
        let d = ((base - cur) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        i.target = cur + d;
    }

    setPreview(on) {
        this.inspect.preview = on;
        if (on) { this.inspect.dist = 4.2; this.inspect.auto = true; this.inspect.target = null; this.ui.markView('auto'); }
        this._applyFraming();
    }

    _inspecting() {
        return this.state === 'menu' && (this.inspect.preview || this.menuView === 'avatar');
    }

    /** Glisser pour orbiter, molette / pincement pour zoomer (uniquement en mode inspection). */
    _bindInspectInput() {
        const canvas = this.scene.renderer.domElement;
        const pts = new Map();
        let pinch = 0;
        const stop = () => { this.inspect.auto = false; this.inspect.target = null; this.ui.markView(''); };
        canvas.addEventListener('pointerdown', (e) => {
            if (!this._inspecting()) return;
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
            if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
        });
        canvas.addEventListener('pointermove', (e) => {
            const p = pts.get(e.pointerId);
            if (!p || !this._inspecting()) return;
            const dx = e.clientX - p.x, dy = e.clientY - p.y;
            p.x = e.clientX; p.y = e.clientY;
            const i = this.inspect;
            if (pts.size === 2) {
                const [a, b] = [...pts.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (pinch > 0) i.dist = clamp(i.dist * (pinch / d), 2.2, 9);
                pinch = d;
                return;
            }
            stop();
            i.yaw -= dx * 0.009;
            i.pitch = clamp(i.pitch + dy * 0.006, -0.25, 1.1);
        });
        const up = (e) => { pts.delete(e.pointerId); pinch = 0; };
        canvas.addEventListener('pointerup', up);
        canvas.addEventListener('pointercancel', up);
        canvas.addEventListener('wheel', (e) => {
            if (!this._inspecting()) return;
            e.preventDefault();
            this.inspect.dist = clamp(this.inspect.dist * (1 + Math.sign(e.deltaY) * 0.08), 2.2, 9);
        }, { passive: false });
    }

    /** Pose du skieur dans le menu : repos, démonstration de slalom (carving + planté de bâton) ou de schuss. */
    _menuPose() {
        const t = this.time, d = this.inspecting_demo();
        if (d === 'carve') {
            const lat = Math.sin(t * 1.5);
            return { tilt: -lat * 0.5, yaw: -lat * 0.5, pitch: 0, crouch: 0.5, lat, speedRatio: 0.55, time: t };
        }
        if (d === 'tuck') return { tilt: 0, yaw: 0, pitch: 0, crouch: 0.75, tuck: 1, speedRatio: 1, time: t };
        return { tilt: 0, yaw: Math.sin(t * 0.6) * 0.15, pitch: 0, crouch: 0.15 + Math.sin(t * 1.6) * 0.03, speedRatio: 0.1, time: t };
    }
    inspecting_demo() { return this.inspect.preview ? this.inspect.demo : 'idle'; }

    // ------------------------------------------------------------------ équipement
    equip(cat, id) {
        const save = this.save;
        save.loadout[cat] = id;
        this.store.persist();
        this._dress();
        this.sound.playClick();
        this.ui.renderEquipment();
    }

    buy(cat, id) {
        const save = this.save;
        const res = purchase(save, cat, id);
        if (!res.ok) { this.ui.toast('⚠️', 'Achat impossible', res.reason); return; }
        this.store.persistNow();
        this.sound.playChallengeUnlock();
        const item = findItem(cat, id);
        this.ui.toast('🛍️', 'Équipement acheté', item ? item.name : id);
        this.equip(cat, id);
        this.ui.refreshMenu();
    }

    resetProgress() {
        this.store.resetProgress();
        this._dress();
        this.settings.set({});           // renvoie les réglages conservés
        this.ui.syncSettingsForm();
        this.ui.refreshMenu();
        this.schedulePreview();
    }

    // ------------------------------------------------------------------ décor du menu
    schedulePreview() {
        clearTimeout(this._previewTimer);
        this._previewTimer = setTimeout(() => this.previewCourse(), 140);
    }

    _selection() {
        const save = this.save;
        const sel = save.selection;
        const trial = sel.mode === 'trial' ? getTrial(sel.trial) : null;
        const trackId = trial ? trial.track : sel.track;
        return { sel, trial, track: getTrack(trackId), mode: sel.mode };
    }

    _buildCourse(mode, track, trial) {
        const diff = this.settings.difficulty;
        const profile = this.settings.profile;
        const course = new Course({
            track, seed: courseSeed(mode, track, trial), mode, diff,
            decorDensity: profile.decorDensity,
            lengthM: courseLengthM(mode, track, trial),
            coins: mode !== 'free',
            obstacleMul: diff.obstacleMul
        });
        course.ensure(0, profile.viewChunks);
        const amb = resolveAmbience(track, this.settings.values.weather);
        this.scene.setCourse(course, track, amb);
        this.course = course;
        this.track = track;
        return course;
    }

    /** Décor du menu : la piste choisie, skieur à l'arrêt. */
    previewCourse() {
        if (this.state !== 'menu') return;
        const { track } = this._selection();
        if (this.course && this.track && this.track.id === track.id && this.course.mode === 'endless' && !this.phys) {
            // Même piste : inutile de reconstruire
            return;
        }
        this._buildCourse('endless', track, null);
        this.phys = null;
        this._placeSkierIdle();
    }

    _placeSkierIdle() {
        const c = this.course;
        const y = c.groundY(0, 0);
        this.skier.root.position.set(0, y, 0);
        this.skier.root.visible = true;
        this.skier.setPose({ tilt: 0, yaw: 0, pitch: 0, crouch: 0.15, time: this.time });
        this.menuFocus = { x: 0, y, z: 0 };
    }

    // ------------------------------------------------------------------ cycle d'une course
    startRun() {
        const save = this.save;
        const { sel, trial, track, mode } = this._selection();
        if (!isTrackUnlocked(save, track.id)) {
            this.ui.toast('🔒', 'Piste verrouillée', `${track.name} : ${this.ui.trackUnlockText(track)}`);
            return;
        }
        this.onGesture();
        clearTimeout(this._previewTimer);
        this.pendingEnd = null;
        const diffKey = this.settings.values.difficulty;
        const course = this._buildCourse(mode, track, trial);
        this.phys = new SkierPhysics(course, { diff: this.settings.difficulty, sensitivity: this.settings.values.sensitivity });
        this.run = createRun({ mode, trackId: track.id, trialId: trial ? trial.id : null, difficulty: diffKey, startLevel: levelOf(save) });
        this.run.targetM = course.finishZ != null ? Math.round(-course.finishZ * DIST_FACTOR) : 0;
        this.run.trialNow = 0;
        this._dress();
        this.scene.clearTrails();
        this.controls.reset();
        this.shake = 0;
        this.sprayAcc = 0;
        this.lastTrailZ = 0;
        this.trophyT = 0;
        this.hudT = 1;
        this.camIdx = this.settings.values.defaultCamera;
        this.fovCur = CAMERA_PRESETS[this.camIdx].baseFov;
        this.scene.camera.clearViewOffset();
        this._applyPose(0, true);
        // Plan d'ouverture : caméra devant-droite, qui vient se placer derrière le skieur
        const p = this.phys;
        this.camPos.set(p.x + 4.5, p.y + 2.2, p.z - 7);
        this.camLook.set(p.x, p.y + 1, p.z);
        this.state = 'countdown';
        this.cdIndex = -1;
        this.cdT = 0;
        this.ui.showScreen('none');
        this.ui.initHud(this.run, getBest(save, mode, track.id));
        this.ui.setCameraLabel(CAMERA_PRESETS[this.camIdx].name);
        this.ui.setSoundIcon(this.sound.muted);
        this.ui.updateHud(this.run, this.phys, this.run.targetM);
        void sel;
    }

    togglePause() {
        if (this.state === 'playing' || this.state === 'countdown') this.pause();
        else if (this.state === 'paused') this.resume();
    }

    pause() {
        if (this.state !== 'playing' && this.state !== 'countdown') return;
        this.pausedFrom = this.state;
        this.state = 'paused';
        this.controls.reset();
        this.sound.updateSkiSound(0, 0, false);
        this.ui.showScreen('pause');
        this.ui.syncSettingsForm();
        this.sound.playClick();
    }

    autoPause() {
        if (this.state === 'playing' || this.state === 'countdown') this.pause();
        else this.controls.reset();
    }

    resume() {
        if (this.state !== 'paused') return;
        this.state = this.pausedFrom || 'playing';
        this.ui.showScreen('none');
        this.controls.reset();
        this._lastFrame = performance.now();
        this.sound.resume();
    }

    /** Quitte une course en cours : les résultats déjà obtenus comptent (mode libre : seulement la distance). */
    _abandonRun() {
        const run = this.run;
        if (!run || run.finished || run.result || (this.state !== 'playing' && this.state !== 'paused' && this.state !== 'countdown')) return;
        if (run.distM > 30 || run.score > 0) {
            run.result = run.mode === 'endless' ? 'crash' : (run.mode === 'free' ? 'crash' : 'fail');
            run.reason = 'Descente interrompue.';
            run.finalTime = run.time + run.penalties;
            run.trialMetricValue = trialValue(run);
            applyRunResult(this.save, run);
            this.store.persistNow();
        }
        run.result = run.result || 'abandon';
    }

    toMenu() {
        this._abandonRun();
        this.state = 'menu';
        this.pausedFrom = null;
        this.pendingEnd = null;
        this.controls.reset();
        this.ui.countdown(null);
        this.ui.showScreen('start');
        this.sound.updateSkiSound(0, 0, false);
        this.camIdx = this.settings.values.defaultCamera;
        this.ui.setCameraLabel(CAMERA_PRESETS[this.camIdx].name);
        this.phys = null;
        const { track } = this._selection();
        this._buildCourse('endless', track, null);
        this._placeSkierIdle();
        this._applyFraming();
    }

    cycleCamera() {
        if (this.state !== 'playing' && this.state !== 'countdown' && this.state !== 'paused') return;
        this.camIdx = (this.camIdx + 1) % CAMERA_PRESETS.length;
        const name = CAMERA_PRESETS[this.camIdx].name;
        this.ui.setCameraLabel(name);
        this.ui.feedback(`🎥 Vue : ${name}`, 'c-sky');
    }

    toggleMute() {
        const m = this.sound.toggleMute();
        this.ui.setSoundIcon(m);
        this.ui.feedback(m ? '🔇 Son coupé' : '🔊 Son activé', 'c-sky');
    }

    // ------------------------------------------------------------------ fin de course
    _scheduleEnd(end, delay) {
        if (this.pendingEnd) return;
        this.pendingEnd = { end, t: delay };
    }

    _endRun(end) {
        const run = this.run;
        const save = this.save;
        this.pendingEnd = null;
        this.state = 'result';
        this.controls.reset();
        run.result = end.result;
        run.reason = end.reason;
        if (!run.finalTime) run.finalTime = run.time + run.penalties;
        run.trialMetricValue = trialValue(run);
        const summary = applyRunResult(save, run);
        this.store.persistNow();
        this.sound.updateSkiSound(0, 0, false);
        if (end.result === 'finish' || end.result === 'success') this.sound.playFinish(); else this.sound.playCrash();
        if (summary.levelAfter > summary.levelBefore) setTimeout(() => this.sound.playLevelUp(), 500);
        this.ui.setHud(false);
        this.ui.countdown(null);
        this.skier.root.visible = true;
        this.menuFocus = { x: this.phys.x, y: this.phys.y, z: this.phys.z };
        this.ui.showResult(run, summary, getBest(save, run.mode, run.trackId));
        this.menuView = 'default';
    }

    // ------------------------------------------------------------------ évènements de la physique
    _scoreMult() {
        return this.settings.difficulty.scoreMult * (this.track.scoreMult || 1);
    }

    _handleEvents(events) {
        const run = this.run, ph = this.phys, ui = this.ui, snd = this.sound;
        const scoring = MODES[run.mode].scoring;
        const mult = this._scoreMult();
        const vib = this.settings.values.vibration;
        for (const e of events) {
            switch (e.type) {
                case 'hop':
                    snd.playHop();
                    this.scene.spray(ph.x, ph.y, ph.z, 8, { vy: 2.5, vz: 3, spread: 1.5, size: 0.4, life: 0.5 });
                    break;
                case 'takeoff':
                    break;
                case 'land': {
                    const k = clamp(e.impact / 16, 0, 1);
                    snd.playLand(k);
                    this.scene.spray(ph.x, ph.y, ph.z, Math.round(10 + 26 * k), { vy: 3 + 3 * k, vz: 5, spread: 3, size: 0.6, life: 0.7 });
                    if (e.air >= 0.3) {
                        run.jumps++;
                        run.airTotal += e.air;
                        run.bestAir = Math.max(run.bestAir, e.air);
                        if (scoring) {
                            const bonus = Math.round(e.air * 80 * mult);
                            run.score += bonus;
                            ui.feedback(`🦅 Saut ${e.air.toFixed(1)} s  +${bonus}`, 'c-sky');
                        }
                    }
                    if (e.hard) { this._kick(0.5 + k * 0.5); vibrate(50, vib); } else if (e.air > 0.3) this._kick(0.25);
                    break;
                }
                case 'stumble':
                    run.hits++;
                    run.combo = 1;
                    snd.playStumble();
                    this._kick(0.7);
                    ui.flash('rgba(251,113,133,0.28)');
                    vibrate(45, vib);
                    ui.feedback(e.kind === 'net' ? 'Limite de piste !' : 'Obstacle ! Combo perdu', 'c-rose');
                    this.scene.spray(ph.x, ph.y, ph.z, 14, { vy: 3, vz: 4, spread: 3, size: 0.55, life: 0.6 });
                    break;
                case 'fall': {
                    run.falls++;
                    run.combo = 1;
                    run.lives = Number.isFinite(run.lives) ? run.lives - 1 : run.lives;
                    snd.playCrash();
                    this._kick(1.4);
                    ui.flash('rgba(255,255,255,0.6)', 320);
                    vibrate(130, vib);
                    this.scene.spray(ph.x, ph.y, ph.z, 45, { vy: 5, vz: 5, spread: 4.5, size: 0.8, life: 1 });
                    const why = e.cause === 'ravine' ? 'Chute dans le ravin !' : e.cause === 'rock' ? 'Collision avec un rocher !' : e.cause === 'tree' ? 'Collision avec un sapin !' : 'Chute !';
                    ui.feedback(why, 'c-rose');
                    const end = evaluateEnd(run);
                    if (end) {
                        run.reason = why;
                        this._scheduleEnd(end.result === 'crash' ? { result: 'crash', reason: `${why} ${end.reason}` } : end, 1.1);
                    }
                    break;
                }
                case 'recover':
                    ui.feedback('En piste ! Protection brève', 'c-sky');
                    break;
                case 'gate': {
                    const passed = Math.abs(e.dx) <= e.halfW;
                    if (passed) {
                        run.gates++;
                        const perfect = Math.abs(e.dx) <= e.halfW * 0.3;
                        let pts = Math.round(100 * run.combo * mult);
                        if (perfect) { run.perfect++; pts += Math.round(40 * mult); }
                        run.score += pts;
                        run.combo++;
                        run.maxCombo = Math.max(run.maxCombo, run.combo);
                        snd.playGatePass(run.combo);
                        if (perfect) snd.playPerfect();
                        ui.feedback(`+${pts} ${perfect ? 'Parfait !' : 'Porte franchie !'} (x${run.combo})`, perfect ? 'c-amber' : 'c-emerald');
                    } else {
                        run.missed++;
                        run.combo = 1;
                        ph.speed = Math.max(ph.vmin, ph.speed * 0.88);
                        snd.playGateMiss();
                        const timed = run.mode === 'timetrial' || (run.trial && run.trial.finish);
                        if (timed) run.penalties += 1.5;
                        ui.feedback(timed ? 'Porte manquée ! +1,5 s' : 'Porte manquée ! Combo perdu', 'c-rose');
                    }
                    break;
                }
                case 'coin':
                    run.coins += e.n;
                    if (scoring) run.score += 25 * e.n;
                    snd.playCoin();
                    break;
                case 'finish':
                    run.crossedFinish = true;
                    run.finalTime = Math.round((run.time + run.penalties) * 100) / 100;
                    ui.feedback('🏁 Arrivée !', 'c-amber');
                    this._scheduleEnd(evaluateEnd(run) || { result: 'finish', reason: 'Ligne d\'arrivée franchie !' }, 1.7);
                    break;
                default: break;
            }
        }
    }

    _kick(v) {
        if (this.settings.values.shake) this.shake = Math.max(this.shake, v);
    }

    // ------------------------------------------------------------------ pose du skieur
    _applyPose(dt, snap) {
        const ph = this.phys;
        if (!ph) return;
        const sk = this.skier;
        const lat = clamp(ph.vx / ph.latMax, -1, 1);
        let crouch = 0.2 + 0.45 * ph.speedRatio;
        let tumble = 0, lift = 0, arm = Math.sin(this.time * 7) * 0.25 * ph.turnIntensity;
        const tilt = -lat * 0.5;
        let yaw = -lat * 0.5 - (ph.skid ? Math.sign(ph.vx) * -0.0 : 0);
        if (ph.skid) yaw *= 1.45;
        let pitch = -ph.pitch;
        if (!ph.grounded) { crouch = 0.75; arm = 0.5; }
        else if (ph.landT > 0) crouch = Math.max(crouch, 1 * (ph.landT / 0.32));
        if (ph.stumbleT > 0) arm = Math.sin(this.time * 30) * 0.9;
        if (ph.phase === 'fall') {
            const f = clamp(ph.phaseT / PHYS.FALL_TIME, 0, 1);
            tumble = -f * Math.PI * 2;
            lift = Math.abs(Math.sin(ph.phaseT * 5)) * 0.55 * (1 - f);
            crouch = 1; arm = Math.sin(this.time * 24) * 1.1;
        } else if (ph.phase === 'recover') {
            crouch = 0.8 - 0.6 * clamp(ph.phaseT / PHYS.RECOVER_TIME, 0, 1);
        } else if (ph.phase === 'finish') {
            crouch = 0; arm = Math.sin(this.time * 10) * 1.0 + 1.2;
        }
        sk.root.position.set(ph.x, ph.y, ph.z);
        const racing = ph.grounded && ph.phase !== 'fall' && ph.phase !== 'finish' && ph.stumbleT <= 0;
        const tuck = racing ? clamp((ph.speedRatio - 0.72) / 0.28, 0, 1) * (1 - Math.abs(lat)) : 0;
        sk.setPose({ tilt, yaw, pitch, crouch, tumble, lift, arm, speedRatio: ph.speedRatio, time: this.time, lat: racing ? lat : lat * 0.3, tuck, air: !ph.grounded, cheer: ph.phase === 'finish' });
        const helmetCam = this.camIdx === 2 && (this.state === 'playing' || this.state === 'paused');
        sk.root.visible = !helmetCam && (ph.invuln <= 0 || ph.phase === 'fall' || Math.floor(this.time * 12) % 2 === 0);
        void dt; void snap;
    }

    // ------------------------------------------------------------------ effets continus
    _effects(dt) {
        const ph = this.phys;
        const sc = this.scene;
        if (!ph.grounded) return;
        if (ph.phase === 'fall') return;
        const sr = ph.speedRatio;
        const rate = 30 * sr + 80 * ph.turnIntensity * sr + (ph.skid ? 150 : 0) + ph.zone.deep * 110 + (ph.stumbleT > 0 ? 40 : 0);
        this.sprayAcc += rate * dt;
        const n = Math.floor(this.sprayAcc);
        if (n > 0) {
            this.sprayAcc -= n;
            sc.spray(ph.x, ph.y, ph.z + 0.4, Math.min(n, 12), { vx: -ph.vx * 0.35, vy: 1.8 + sr, vz: 3 + ph.speed * 0.12, spread: 1.4 + ph.turnIntensity, size: ph.zone.deep > 0.3 ? 0.7 : 0.45, life: 0.6 });
        }
        if (this.lastTrailZ - ph.z > 0.9) {
            this.lastTrailZ = ph.z;
            const yaw = -clamp(ph.vx / ph.latMax, -1, 1) * 0.5;
            sc.addTrail(ph.x, ph.y, ph.z, yaw, Math.tan(ph.pitch), ph.skid ? 1 : ph.turnIntensity * 0.6);
        }
    }

    // ------------------------------------------------------------------ caméra
    _cameraPlay(dt) {
        const ph = this.phys, cam = this.scene.camera, c = this.course;
        const p = CAMERA_PRESETS[this.camIdx];
        const sr = ph.speedRatio;
        const helmet = this.camIdx === 2;
        const intro = this.state === 'countdown';
        const kx = 1 - Math.exp(-dt * (intro ? 2.2 : helmet ? 16 : 6));
        const ky = 1 - Math.exp(-dt * (intro ? 2.2 : helmet ? 14 : 5));
        const kz = 1 - Math.exp(-dt * (intro ? 2.2 : helmet ? 18 : 8));
        const dx = ph.x * (helmet ? 1 : 0.82);
        const dy = ph.y + p.offsetY + (helmet ? 0 : sr * 0.4);
        const dz = ph.z + p.offsetZ + (helmet ? 0 : sr * 1.6);
        this.camPos.x += (dx - this.camPos.x) * kx;
        this.camPos.y += (dy - this.camPos.y) * ky;
        this.camPos.z += (dz - this.camPos.z) * kz;
        const lz = ph.z + p.lookZ;
        const ly = c.groundY(ph.x, lz) * 0.8 + ph.y * 0.2 + p.lookY;
        const kl = 1 - Math.exp(-dt * (intro ? 3 : 7));
        const lx = ph.x * 0.6 + clamp(ph.vx, -26, 26) * 0.12;
        this.camLook.x += (lx - this.camLook.x) * kl;
        this.camLook.y += (ly - this.camLook.y) * kl;
        this.camLook.z += (lz - this.camLook.z) * kl;
        if (intro) { this.camLook.z += (ph.z - 6 - this.camLook.z) * 0.02; }

        this.shake *= Math.exp(-dt * 7);
        const s = this.shake * 0.28;
        cam.position.set(this.camPos.x + (Math.random() - 0.5) * s, this.camPos.y + (Math.random() - 0.5) * s, this.camPos.z + (Math.random() - 0.5) * s);
        cam.lookAt(this.camLook);
        const roll = clamp(ph.vx / ph.latMax, -1, 1) * p.rollFactor * 0.1;
        cam.rotateZ(roll);

        const targetFov = p.baseFov + sr * 9 + (ph.skid ? 1.5 : 0) + (ph.phase === 'fall' ? -3 : 0);
        this.fovCur += (targetFov - this.fovCur) * Math.min(1, dt * 3);
        this.scene.setFov(this.fovCur);
    }

    _cameraMenu(dt) {
        const cam = this.scene.camera;
        const f = this.menuFocus || { x: 0, y: 0, z: 0 };
        const equip = this.menuView === 'equip' && this.state === 'menu';
        const t = this.time;
        let a, d, h, ly;
        const insp = this._inspecting();
        if (insp) {
            const i = this.inspect;
            if (i.auto) i.yaw += dt * 0.7;
            else if (i.target != null) {
                i.yaw += (i.target - i.yaw) * Math.min(1, dt * 6);
                if (Math.abs(i.target - i.yaw) < 0.002) i.target = null;
            }
            a = i.yaw; d = i.dist * (i.preview ? 1 : 1.25); h = 0.5 + Math.sin(i.pitch) * d * 0.9; ly = 0.78;
            d = Math.cos(i.pitch) * d;
        }
        else if (equip) { a = t * 0.38; d = 4.4; h = 1.5; ly = 0.95; }
        else { a = Math.PI * 0.86 + Math.sin(t * 0.22) * 0.3; d = 9.5; h = 3.3; ly = 1.2; }
        const tx = f.x + Math.sin(a) * d, tz = f.z - Math.cos(a) * d, ty = f.y + h;
        const k = 1 - Math.exp(-dt * 3);
        this.camPos.x += (tx - this.camPos.x) * k;
        this.camPos.y += (ty - this.camPos.y) * k;
        this.camPos.z += (tz - this.camPos.z) * k;
        this.camLook.x += (f.x - this.camLook.x) * k;
        this.camLook.y += (f.y + ly - this.camLook.y) * k;
        this.camLook.z += (f.z - (equip || insp ? 0 : 3) - this.camLook.z) * k;
        cam.position.copy(this.camPos);
        cam.lookAt(this.camLook);
        this.fovCur += (((equip || insp) ? 40 : 52) - this.fovCur) * Math.min(1, dt * 3);
        this.scene.setFov(this.fovCur);
    }

    /** Décale l'image 3D pour que le skieur reste visible à côté du panneau de menu. */
    _applyFraming() {
        const cam = this.scene.camera;
        const w = window.innerWidth, h = window.innerHeight;
        const menu = this.state === 'menu' || (this.state === 'result');
        if (!menu || this.state === 'result' || this.inspect.preview) { cam.clearViewOffset(); return; }
        if (w / h >= 1.1) cam.setViewOffset(w, h, -w * 0.2, 0, w, h);
        else cam.setViewOffset(w, h, 0, h * (this.menuView === 'default' ? 0.14 : this.menuView === 'avatar' ? 0.12 : 0.2), w, h);
    }

    _onResize() {
        this.scene.resize();
        this._applyFraming();
    }

    // ------------------------------------------------------------------ boucle
    start() {
        this._lastFrame = performance.now();
        this._applyFraming();
        const loop = (now) => {
            this._raf = requestAnimationFrame(loop);
            try { this._frame(now); } catch (err) { this._fatal(err); }
        };
        this._raf = requestAnimationFrame(loop);
    }

    _fatal(err) {
        cancelAnimationFrame(this._raf);
        console.error(err);
        this.ui.showError('Le jeu a rencontré une erreur', 'Une erreur inattendue a interrompu la partie. Votre progression enregistrée est conservée.', String(err && err.stack || err));
    }

    _frame(now) {
        let dt = (now - this._lastFrame) / 1000;
        this._lastFrame = now;
        if (!(dt > 0)) dt = 0.016;
        dt = Math.min(dt, 0.05);
        if (this.contextLost) return;
        this.time += dt;

        // FPS
        this.fpsAvg += (1 / Math.max(dt, 0.001) - this.fpsAvg) * 0.1;
        this.fpsT += dt;
        if (this.fpsT > 0.5) { this.fpsT = 0; if (this.settings.values.showFps) this.ui.setFps(this.fpsAvg); }

        const snow = this.settings.values.snowIntensity;
        const st = this.state;
        if (st === 'playing' || st === 'countdown') {
            if (st === 'countdown') this._updateCountdown(dt);
            else this._updatePlaying(dt);
            this._applyPose(dt);
            this._cameraPlay(dt);
            this.scene.update(dt, this.time, this.phys, this.phys.speed, snow);
            this.scene.trackFrame(dt, st === 'playing');
        } else if (st === 'paused') {
            this._cameraPlay(0.0001);
            this.scene.update(0, this.time, this.phys, 0, snow);
        } else {
            // menu et résultat : skieur à l'arrêt, caméra en orbite
            if (this.state === 'menu' && !this.course) this.previewCourse();
            if (this.course) {
                if (this.state === 'menu') this.skier.setPose(this._menuPose());
                else if (this.phys) this._applyPose(dt);
                this._cameraMenu(dt);
                const f = this.menuFocus || { x: 0, y: 0, z: 0 };
                this.scene.update(dt, this.time, f, 0, snow);
            }
            this.audioT += dt;
            if (this.audioT > 0.1) { this.audioT = 0; this.sound.updateSkiSound(0, 0, false); }
        }
        this.scene.render();
    }

    _updateCountdown(dt) {
        this.cdT += dt;
        for (let i = COUNTDOWN_STEPS.length - 1; i >= 0; i--) {
            if (this.cdT >= COUNTDOWN_STEPS[i][1]) {
                if (i !== this.cdIndex) {
                    this.cdIndex = i;
                    this.ui.countdown(COUNTDOWN_STEPS[i][0]);
                    this.sound.playCountdown(i === COUNTDOWN_STEPS.length - 1);
                    if (i === COUNTDOWN_STEPS.length - 1) {
                        this.state = 'playing';
                        this.goHideT = 0.7;
                        this.controls.consumeJump();
                    }
                }
                break;
            }
        }
    }

    _updatePlaying(dt) {
        const run = this.run, ph = this.phys, ui = this.ui;
        if (this.goHideT > 0) { this.goHideT -= dt; if (this.goHideT <= 0) ui.countdown(null); }

        const halfW = this.course.terrain.halfW;
        const relX = ph.x - this.course.terrain.centerX(ph.z);
        const prevZ = ph.z;
        const turn = ph.canControl && !this.pendingEnd ? this.controls.turn(relX, halfW) : 0;
        const events = ph.update(dt, { turn, jump: this.controls.consumeJump() });
        if (ph.phase !== 'finish') run.time += dt;

        // Score de distance (formule d'origine : 0,35 × combo × multiplicateur)
        if (MODES[run.mode].scoring && ph.phase === 'ride') {
            const dz = clamp(prevZ - ph.z, 0, ph.speed * dt * 1.5);
            run.score += dz * 0.35 * run.combo * this._scoreMult();
        }
        run.distM = ph.distM;
        run.maxSpeedKmh = Math.max(run.maxSpeedKmh, ph.kmh);
        run.trialNow = run.trial ? trialValue(run) : 0;

        this._handleEvents(events);
        this._effects(dt);

        // Conditions de fin
        if (this.pendingEnd) {
            this.pendingEnd.t -= dt;
            if (this.pendingEnd.t <= 0) { this._endRun(this.pendingEnd.end); return; }
        } else {
            const end = evaluateEnd(run);
            if (end) this._scheduleEnd(end, end.result === 'crash' ? 1.1 : 0.7);
        }

        // Trophées en temps réel
        this.trophyT += dt;
        if (this.trophyT > 0.4 && run.mode !== 'free' && !this.pendingEnd) {
            this.trophyT = 0;
            const fresh = checkTrophies(this.save, run);
            if (fresh.length) {
                for (const t of fresh) { run.trophiesEarned.push(t); ui.toast(t.icon, 'Trophée débloqué !', t.title); }
                this.sound.playChallengeUnlock();
                this.store.persist();
            }
        }

        // Interface et son
        this.hudT += dt;
        if (this.hudT > 0.066) {
            this.hudT = 0;
            ui.updateHud(run, ph, run.targetM);
            ui.setSpeedFx(ph.speedRatio);
        }
        this.audioT += dt;
        if (this.audioT > 0.04) {
            this.audioT = 0;
            this.sound.updateSkiSound(ph.speedRatio, ph.turnIntensity, ph.phase !== 'finish', { airborne: !ph.grounded || ph.phase === 'fall', deep: ph.zone.deep > 0.3, skid: ph.skid });
        }
        void RAMP_UP;
    }

    dispose() {
        cancelAnimationFrame(this._raf);
        this.skier.dispose();
        this.scene.dispose();
    }
}
void syncUnlocks;
void TRACKS;
