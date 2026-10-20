// Interface : menus, HUD, écrans de pause et de résultat, réglages, notifications.
// Tout le DOM dynamique est construit avec textContent (aucune donnée du joueur n'est injectée en HTML).
import { MODES, MODE_ORDER, TRIALS, getTrial } from './modes.js';
import { TRACKS, TRACK_ORDER, slopeDegrees } from './tracks.js';
import { CATEGORIES, CATALOG, findItem, isUnlocked, unlockText, resolveLoadout } from './characters.js';
import { AVATAR_STYLES, DEFAULT_AVATAR } from './avatar-config.js';
import {
    TROPHIES, trophyTitle, trophyValue, levelFromXp, levelOf, missionDef, missionReward,
    ensureMissions, getBest, isTrackUnlocked, MEDAL_TIMES, bestKey
} from './progression.js';
import { DIFFICULTY_PRESETS, CAMERA_PRESETS } from './settings.js';
import { isStoragePersistent } from './storage.js';

export function fmtTime(s) {
    if (s == null || !Number.isFinite(s)) return '—';
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}
export function fmtInt(n) {
    return Math.floor(n || 0).toLocaleString('fr-FR');
}
function fmtDuration(sec) {
    const m = Math.round(sec / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
function hex(n) { return '#' + n.toString(16).padStart(6, '0'); }

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

const MEDAL_ICON = { gold: '🥇 Or', silver: '🥈 Argent', bronze: '🥉 Bronze' };
const RESULT_STYLE = {
    crash: { icon: '💥', title: 'Chute Brutale !' },
    finish: { icon: '🏁', title: 'Arrivée !' },
    success: { icon: '🏆', title: 'Défi réussi !' },
    fail: { icon: '😓', title: 'Défi manqué' }
};

export class UI {
    /**
     * @param o { getSave, persist, settings, handlers }
     * handlers : onStart, onResume, onRestart, onMenu, onPause, onSetting(partial), onEquip(cat,id), onBuy(cat,id),
     *            onReset(), onSelectionChange(), onTab(name), onSound()
     */
    constructor(o) {
        this.getSave = o.getSave;
        this.persist = o.persist;
        this.settings = o.settings;
        this.h = o.handlers;
        this._cache = new Map();
        this.missing = [];
        this.touchCapable = false;
        try {
            this.touchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) ||
                (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
        } catch (e) { /* ignoré */ }
        this.screen = 'loading';
        this.inGame = false;
        this.tab = 'tab-play';
        this.equipCat = 'character';
        this.equipSel = null;
        this._toastQueue = [];
        this._toastBusy = false;
        this._confirmResolve = null;
        this._hudCache = {};
        this._bind();
        this.syncSettingsForm();
        this.refreshMenu();
    }

    // ------------------------------------------------------------------ DOM
    $(id) {
        let e = this._cache.get(id);
        if (e) return e;
        e = document.getElementById(id);
        if (!e) {
            this.missing.push(id);
            console.error(`[UI] Élément #${id} introuvable dans index.html`);
            e = document.createElement('div');   // évite de casser le jeu : élément fantôme
        }
        this._cache.set(id, e);
        return e;
    }
    _set(id, text) {
        const e = this.$(id);
        const t = String(text);
        if (this._hudCache[id] !== t) { this._hudCache[id] = t; e.textContent = t; }
    }
    _show(id, on) {
        const e = this.$(id);
        if (this._hudCache['v' + id] !== on) { this._hudCache['v' + id] = on; e.classList.toggle('hidden', !on); }
    }

    _bind() {
        const $ = (id) => this.$(id);
        // Onglets
        document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => { this.h.onClick(); this.setTab(b.dataset.tab); }));

        $('btn-start').addEventListener('click', () => { this.h.onClick(); this.h.onStart(); });
        $('btn-preview3d').addEventListener('click', () => { this.h.onClick(); this.setPreview(true); });
        $('btn-preview-back').addEventListener('click', () => { this.h.onClick(); this.setPreview(false); });
        this._bindAvatar();
        $('btn-resume').addEventListener('click', () => this.h.onResume());
        $('btn-pause').addEventListener('click', () => this.h.onPause());
        $('btn-pause-restart').addEventListener('click', () => this.h.onRestart());
        $('btn-pause-menu').addEventListener('click', () => this.h.onMenu());
        $('btn-restart').addEventListener('click', () => this.h.onRestart());
        $('btn-menu').addEventListener('click', () => this.h.onMenu());
        $('btn-pause-settings').addEventListener('click', () => $('pause-settings').classList.toggle('hidden'));
        $('btn-camera').addEventListener('click', () => this.h.onCamera());
        $('btn-sound').addEventListener('click', () => this.h.onSound());
        $('btn-reload').addEventListener('click', () => location.reload());
        $('btn-clear-history').addEventListener('click', async () => {
            const ok = await this.confirm('Réinitialiser la progression ?',
                'Scores, niveaux, pièces, équipements débloqués, trophées et historique seront définitivement effacés. Vos réglages sont conservés.', 'Tout effacer');
            if (ok) { this.h.onReset(); this.toast('🧹', 'Progression', 'Progression réinitialisée'); }
        });
        $('confirm-yes').addEventListener('click', () => this._closeConfirm(true));
        $('confirm-no').addEventListener('click', () => this._closeConfirm(false));

        // Réglages (menu + pause)
        const bindRange = (id, lbl, key, suffix = '%') => {
            $(id).addEventListener('input', () => {
                const v = Number($(id).value);
                $(lbl).textContent = v + suffix;
                this.h.onSetting({ [key]: v });
            });
        };
        bindRange('set-sensitivity', 'lbl-sensitivity', 'sensitivity');
        bindRange('set-volume', 'lbl-volume', 'volume');
        bindRange('set-snow-intensity', 'lbl-snow', 'snowIntensity');
        bindRange('pz-volume', 'pz-volume-lbl', 'volume');
        bindRange('pz-sensitivity', 'pz-sensitivity-lbl', 'sensitivity');
        bindRange('pz-snow', 'pz-snow-lbl', 'snowIntensity');
        const bindSelect = (id, key, num) => $(id).addEventListener('change', () => this.h.onSetting({ [key]: num ? Number($(id).value) : $(id).value }));
        bindSelect('set-difficulty', 'difficulty');
        bindSelect('set-graphics', 'graphics');
        bindSelect('set-weather', 'weather');
        bindSelect('set-default-cam', 'defaultCamera', true);
        bindSelect('pz-graphics', 'graphics');
        const bindCheck = (id, key) => $(id).addEventListener('change', () => this.h.onSetting({ [key]: $(id).checked }));
        bindCheck('set-ambience', 'ambience');
        bindCheck('set-shake', 'shake');
        bindCheck('set-vibration', 'vibration');
        bindCheck('set-show-fps', 'showFps');
        $('set-player-name').addEventListener('change', () => this.h.onSetting({ playerName: $('set-player-name').value }));
        $('set-player-name').addEventListener('input', () => this.h.onSetting({ playerName: $('set-player-name').value }));

        // Un toucher détecté sur un ordinateur hybride active les commandes tactiles
        window.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'touch' && !this.touchCapable) { this.touchCapable = true; this._applyTouchVisibility(); }
        }, { passive: true });
    }

    // ------------------------------------------------------------------ écrans
    /** name : 'start' | 'pause' | 'gameover' | 'none' */
    showScreen(name) {
        this.screen = name;
        for (const s of ['start', 'pause', 'gameover']) this.$('screen-' + s).classList.toggle('hidden', s !== name);
        document.body.classList.toggle('in-menu', name === 'start');
        document.body.dataset.screen = name;
        if (name !== 'pause') this.$('pause-settings').classList.add('hidden');
        if (name === 'start') { this.setHud(false); this.refreshMenu(); }
    }

    setHud(on) {
        this.inGame = on;
        this.$('hud').classList.toggle('hidden', !on);
        this._applyTouchVisibility();
    }

    _applyTouchVisibility() {
        const show = this.inGame && this.touchCapable && this.screen !== 'gameover';
        this.$('touch-controls').classList.toggle('hidden', !show);
        document.body.classList.toggle('touch', this.touchCapable);
    }

    showLoading(pct, text) {
        this.$('loading').classList.remove('hidden');
        if (pct != null) this.$('loading-bar-fill').style.width = Math.round(pct) + '%';
        if (text) this.$('loading-text').textContent = text;
    }
    hideLoading() {
        const l = this.$('loading');
        l.classList.add('fade-out');
        setTimeout(() => l.classList.add('hidden'), 450);
    }
    showError(title, message, details) {
        this.$('loading').classList.add('hidden');
        this.$('error-title').textContent = title;
        this.$('error-message').textContent = message;
        this.$('error-details').textContent = details || '';
        this.$('error-details').parentElement.classList.toggle('hidden', !details);
        this.$('error-screen').classList.remove('hidden');
    }
    setContextLost(on) { this.$('context-lost').classList.toggle('hidden', !on); }

    // ------------------------------------------------------------------ onglets
    setTab(id) {
        this.tab = id;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== id));
        document.body.classList.toggle('tab-equipment', id === 'tab-equipment');
        document.body.classList.toggle('tab-avatar', id === 'tab-avatar');
        this.$('btn-start').parentElement.classList.toggle('hidden', id !== 'tab-play' && false);
        this.renderTab(id);
        if (this.h.onTab) this.h.onTab(id);
    }

    renderTab(id) {
        switch (id) {
            case 'tab-play': this.renderPlay(); break;
            case 'tab-equipment': this.renderEquipment(); break;
            case 'tab-avatar': this.renderAvatar(); break;
            case 'tab-challenges': this.renderChallenges(); break;
            case 'tab-dashboard': this.renderStats(); break;
            case 'tab-settings': this.syncSettingsForm(); break;
            default: break;
        }
    }

    /** Rafraîchit l'en-tête (niveau, pièces) et l'onglet visible. */
    refreshMenu() {
        const save = this.getSave();
        ensureMissions(save);
        const lv = levelFromXp(save.progress.xp);
        this.$('welcome-player-tag').textContent = `Skieur : ${save.settings.playerName}`;
        this.$('header-level').textContent = lv.level;
        this.$('header-xp-fill').style.width = Math.round(lv.ratio * 100) + '%';
        this.$('header-xp-text').textContent = lv.need === 0 ? 'Niveau max.' : `${fmtInt(lv.into)} / ${fmtInt(lv.need)} XP`;
        this.$('header-coins').textContent = fmtInt(save.progress.coins);
        this.$('header-best-score').textContent = fmtInt(save.progress.bestScore);
        const done = TROPHIES.filter(t => save.trophies[t.id]).length;
        this.$('badge-challenges-count').textContent = `${done}/${TROPHIES.length}`;
        this.$('storage-warning').classList.toggle('hidden', isStoragePersistent());
        this.renderTab(this.tab);
    }

    // ------------------------------------------------------------------ JOUER
    renderPlay() {
        const save = this.getSave();
        const sel = save.selection;
        const lvl = levelOf(save);

        // Modes
        const ml = this.$('mode-list');
        ml.replaceChildren();
        for (const id of MODE_ORDER) {
            const m = MODES[id];
            const b = el('button', 'mode-btn' + (sel.mode === id ? ' selected' : ''));
            b.type = 'button';
            b.append(el('span', 'mode-ico', m.icon), el('span', 'mode-name', m.name));
            b.addEventListener('click', () => { this.h.onClick(); sel.mode = id; this._selectionChanged(); });
            ml.appendChild(b);
        }
        const md = MODES[sel.mode];
        this.$('mode-desc').textContent = `${md.desc} — ${md.rules}.`;

        // Défis
        this.$('trial-block').classList.toggle('hidden', sel.mode !== 'trial');
        this.$('track-block').classList.toggle('hidden', sel.mode === 'trial');
        if (sel.mode === 'trial') {
            const tl = this.$('trial-list');
            tl.replaceChildren();
            for (const t of TRIALS) {
                const tr = TRACKS[t.track];
                const locked = !isTrackUnlocked(save, t.track);
                const done = save.trials[t.id] && save.trials[t.id].done;
                const b = el('button', 'trial-btn' + (sel.trial === t.id ? ' selected' : '') + (locked ? ' locked' : ''));
                b.type = 'button';
                b.disabled = locked;
                const head = el('div', 'trial-head');
                head.append(el('span', 'trial-ico', locked ? '🔒' : t.icon), el('span', 'trial-name', t.name),
                    el('span', 'trial-state', done ? '✔ Réussi' : `+${t.reward.coins} 🪙`));
                const desc = el('div', 'trial-desc', t.desc);
                const foot = el('div', 'trial-foot', locked ? `Piste « ${tr.name} » : ${this.trackUnlockText(tr)}` : `${tr.icon} ${tr.name}`);
                b.append(head, desc, foot);
                b.addEventListener('click', () => { this.h.onClick(); sel.trial = t.id; this._selectionChanged(); });
                tl.appendChild(b);
            }
        } else {
            const tl = this.$('track-list');
            tl.replaceChildren();
            for (const id of TRACK_ORDER) {
                const t = TRACKS[id];
                const locked = !isTrackUnlocked(save, id);
                const b = el('button', 'track-btn' + (sel.track === id ? ' selected' : '') + (locked ? ' locked' : ''));
                b.type = 'button';
                b.disabled = locked;
                b.style.setProperty('--track-color', t.color);
                const head = el('div', 'track-head');
                head.append(el('span', 'track-ico', locked ? '🔒' : t.icon), el('span', 'track-name', t.name));
                const stars = el('div', 'track-stars', '★'.repeat(t.stars) + '☆'.repeat(5 - t.stars));
                const sub = el('div', 'track-sub', locked ? this.trackUnlockText(t) : t.subtitle);
                const meta = el('div', 'track-meta', `${t.lengthM} m · pente ${slopeDegrees(t)}°`);
                b.append(head, stars, sub, meta);
                b.addEventListener('click', () => { this.h.onClick(); sel.track = id; this._selectionChanged(); });
                tl.appendChild(b);
            }
        }

        // Résumé
        const trial = sel.mode === 'trial' ? getTrial(sel.trial) : null;
        const track = TRACKS[trial ? trial.track : sel.track] || TRACKS.beginner;
        const best = getBest(save, sel.mode, track.id);
        let rec = '';
        if (sel.mode === 'endless') rec = best.score ? `Record : ${fmtInt(best.score)} pts · ${fmtInt(best.dist)} m` : 'Aucun record pour cette piste';
        else if (sel.mode === 'timetrial') rec = best.time != null ? `Meilleur temps : ${fmtTime(best.time)}` : 'Aucun temps enregistré';
        else if (sel.mode === 'trial') rec = save.trials[trial.id] && save.trials[trial.id].done ? 'Défi déjà réussi' : 'Récompense à la première réussite';
        else rec = 'Sans score ni récompense';
        const diff = DIFFICULTY_PRESETS[save.settings.difficulty];
        this.$('play-summary').textContent = `${track.icon} ${track.name} · ${MODES[sel.mode].name} · ${diff.label} — ${rec}`;

        // Cases rapides
        this.$('quick-best-score').textContent = fmtInt(save.progress.bestScore);
        this.$('quick-total-games').textContent = fmtInt(save.progress.totalGames);
        this.$('quick-challenges').textContent = `${TROPHIES.filter(t => save.trophies[t.id]).length} / ${TROPHIES.length}`;

        // Objectif recommandé : trophée non obtenu le plus avancé
        let bestT = null, bestR = -1;
        for (const t of TROPHIES) {
            if (save.trophies[t.id]) continue;
            const r = Math.min(1, trophyValue(t, null, save) / t.target);
            if (r > bestR) { bestR = r; bestT = t; }
        }
        if (bestT) {
            this.$('next-challenge-title').textContent = `${bestT.icon} ${bestT.title}`;
            this.$('next-challenge-desc').textContent = bestT.desc;
            this.$('next-challenge-pct').textContent = Math.round(bestR * 100) + '%';
        } else {
            this.$('next-challenge-title').textContent = '🏆 Tous les trophées sont obtenus !';
            this.$('next-challenge-desc').textContent = 'Battez vos records et tentez les défis.';
            this.$('next-challenge-pct').textContent = '100%';
        }

        const startOk = isTrackUnlocked(save, track.id);
        this.$('btn-start').disabled = !startOk;
        this.$('btn-start').textContent = startOk ? '🎿 Lancer la descente' : '🔒 Piste verrouillée';
        void lvl;
    }

    trackUnlockText(t) {
        return t.unlock.type === 'level' ? `Niveau ${t.unlock.value} requis` : 'Débloquée';
    }

    _selectionChanged() {
        const save = this.getSave();
        const sel = save.selection;
        // Une sélection inaccessible retombe sur la première piste libre
        if (sel.mode !== 'trial' && !isTrackUnlocked(save, sel.track)) sel.track = 'beginner';
        this.persist();
        this.renderPlay();
        if (this.h.onSelectionChange) this.h.onSelectionChange();
    }

    // ------------------------------------------------------------------ ÉQUIPEMENT
    swatchOf(cat, item) {
        const s = el('span', 'swatch');
        switch (cat) {
            case 'character': s.style.background = hex(item.skin); s.textContent = item.hair === 'fur' ? '🦣' : '🙂'; break;
            case 'outfit': s.style.background = `linear-gradient(135deg, ${hex(item.jacket)} 60%, ${hex(item.pants)} 60%)`; break;
            case 'skis': s.style.background = `linear-gradient(90deg, ${hex(item.color)} 50%, ${hex(item.color2)} 50%)`; s.textContent = '🎿'; break;
            case 'helmet': s.style.background = hex(item.color); s.textContent = item.kind === 'beanie' ? '🧢' : item.kind === 'viking' ? '🪖' : '⛑️'; break;
            default: s.textContent = item.kind === 'scarf' ? '🧣' : item.kind === 'backpack' ? '🎒' : item.kind === 'cape' ? '🦸' : '∅';
        }
        return s;
    }

    // ------------------------------------------------------------------ avatar 3D
    /** Couleurs effectivement affichées (surcharge de l'avatar, sinon couleur du catalogue). */
    avatarColors() {
        const save = this.getSave();
        const lo = resolveLoadout(save);
        const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);
        const av = save.avatar || DEFAULT_AVATAR;
        return {
            jacket: av.jacket || hex((findItem('outfit', lo.outfit) || CATALOG.outfit[0]).jacket),
            skis: av.skis || hex((findItem('skis', lo.skis) || CATALOG.skis[0]).color),
            mask: av.mask || '#06b6d4',
            helmet: av.helmet || hex((findItem('helmet', lo.helmet) || CATALOG.helmet[0]).color)
        };
    }

    _bindAvatar() {
        const $ = (id) => this.$(id);
        for (const key of ['jacket', 'skis', 'mask', 'helmet']) {
            $('av-' + key).addEventListener('input', (e) => this.h.onAvatar({ [key]: e.target.value }));
        }
        $('av-bib').addEventListener('input', (e) => {
            const raw = e.target.value;
            if (raw === '') return;                       // champ en cours de saisie
            const n = Math.min(999, Math.max(0, Math.round(Number(raw))));
            if (Number.isFinite(n)) this.h.onAvatar({ bib: n });
        });
        $('av-bib').addEventListener('change', (e) => {
            const n = Math.min(999, Math.max(0, Math.round(Number(e.target.value) || 0)));
            e.target.value = String(n);
            this.h.onAvatar({ bib: n });
        });
        $('av-reset').addEventListener('click', () => { this.h.onClick(); this.h.onAvatarReset(); this.renderAvatar(); });
        const views = [['face', 'Face'], ['side', 'Profil'], ['back', 'Dos'], ['auto', '🔄 360°']];
        for (const host of ['avatar-views', 'preview-views']) {
            const box = $(host);
            box.replaceChildren();
            for (const [id, label] of views) {
                const b = el('button', 'view-btn', label);
                b.type = 'button';
                b.dataset.view = id;
                b.addEventListener('click', () => { this.h.onClick(); this.h.onView(id); this.markView(id); });
                box.appendChild(b);
            }
        }
        const demos = [['idle', 'Repos'], ['carve', 'Slalom'], ['tuck', 'Schuss']];
        const dbox = $('preview-demos');
        dbox.replaceChildren();
        for (const [id, label] of demos) {
            const b = el('button', 'view-btn' + (id === 'idle' ? ' active' : ''), label);
            b.type = 'button';
            b.dataset.demo = id;
            b.addEventListener('click', () => {
                this.h.onClick(); this.h.onDemo(id);
                dbox.querySelectorAll('.view-btn').forEach(x => x.classList.toggle('active', x === b));
            });
            dbox.appendChild(b);
        }
        this.markView('auto');
    }

    markView(id) {
        document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === id));
    }

    renderAvatar() {
        const save = this.getSave();
        const av = save.avatar || DEFAULT_AVATAR;
        const col = this.avatarColors();
        for (const key of ['jacket', 'skis', 'mask', 'helmet']) this.$('av-' + key).value = col[key];
        if (document.activeElement !== this.$('av-bib')) this.$('av-bib').value = String(av.bib);
        const box = this.$('avatar-styles');
        box.replaceChildren();
        const forced = (findItem('helmet', resolveLoadout(save).helmet) || {}).kind === 'viking';
        for (const st of AVATAR_STYLES) {
            const active = forced ? st.id === 'viking' : av.style === st.id;
            const b = el('button', 'view-btn' + (active ? ' active' : ''), `${st.icon} ${st.name}`);
            b.type = 'button';
            b.addEventListener('click', () => { this.h.onClick(); this.h.onAvatar({ style: st.id }); this.renderAvatar(); });
            box.appendChild(b);
        }
    }

    /** Aperçu plein écran : masque le menu, affiche les contrôles de caméra. */
    setPreview(on) {
        this.previewing = on;
        document.body.classList.toggle('previewing', on);
        this.$('preview-bar').classList.toggle('hidden', !on);
        if (this.h.onPreview) this.h.onPreview(on);
    }

    renderEquipment() {
        const save = this.getSave();
        const cats = this.$('equip-cats');
        cats.replaceChildren();
        for (const c of CATEGORIES) {
            const b = el('button', 'equip-cat' + (this.equipCat === c.key ? ' active' : ''));
            b.type = 'button';
            b.append(el('span', '', c.icon), el('span', 'equip-cat-name', c.label));
            b.addEventListener('click', () => { this.h.onClick(); this.equipCat = c.key; this.equipSel = null; this.renderEquipment(); });
            cats.appendChild(b);
        }
        this.$('equip-coins').textContent = fmtInt(save.progress.coins);

        const list = this.$('equip-items');
        list.replaceChildren();
        const equippedId = save.loadout[this.equipCat];
        if (!this.equipSel || this.equipSel.cat !== this.equipCat) this.equipSel = { cat: this.equipCat, id: equippedId };
        for (const item of CATALOG[this.equipCat]) {
            const unlocked = isUnlocked(save, this.equipCat, item.id);
            const equipped = equippedId === item.id && unlocked;
            const b = el('button', 'equip-item' + (equipped ? ' equipped' : '') + (!unlocked ? ' locked' : '') + (this.equipSel.id === item.id ? ' focus' : ''));
            b.type = 'button';
            b.append(this.swatchOf(this.equipCat, item), el('span', 'equip-name', item.name),
                el('span', 'equip-state', equipped ? '✔ Équipé' : unlocked ? 'Débloqué' : '🔒 ' + unlockText(item, trophyTitle)));
            b.addEventListener('click', () => {
                this.h.onClick();
                this.equipSel = { cat: this.equipCat, id: item.id };
                if (unlocked) { this.h.onEquip(this.equipCat, item.id); }
                else this.renderEquipment();
            });
            list.appendChild(b);
        }

        // Détail
        const d = this.$('equip-detail');
        d.replaceChildren();
        const item = findItem(this.equipCat, this.equipSel.id) || CATALOG[this.equipCat][0];
        const unlocked = isUnlocked(save, this.equipCat, item.id);
        d.append(el('div', 'equip-detail-name', item.name));
        if (item.desc) d.append(el('div', 'equip-detail-desc', item.desc));
        if (!unlocked) {
            d.append(el('div', 'equip-detail-lock', 'Condition : ' + unlockText(item, trophyTitle)));
            if (item.unlock.type === 'coins') {
                const can = save.progress.coins >= item.unlock.value;
                const b = el('button', 'btn ' + (can ? 'btn-primary' : 'btn-ghost'), can ? `Acheter · ${item.unlock.value} 🪙` : `Il manque ${item.unlock.value - save.progress.coins} 🪙`);
                b.type = 'button';
                b.disabled = !can;
                b.addEventListener('click', () => this.h.onBuy(this.equipCat, item.id));
                d.append(b);
            }
        }
    }

    // ------------------------------------------------------------------ DÉFIS
    renderChallenges() {
        const save = this.getSave();
        ensureMissions(save);
        this.$('missions-day').textContent = '· se renouvellent chaque jour';
        const ml = this.$('missions-list');
        ml.replaceChildren();
        for (const m of save.missions.list) {
            const def = missionDef(m.id);
            if (!def) continue;
            const r = missionReward(m);
            const row = el('div', 'mission' + (m.done ? ' done' : ''));
            const top = el('div', 'mission-top');
            top.append(el('span', 'mission-text', (m.done ? '✔ ' : '') + def.text(m.target)),
                el('span', 'mission-reward', `+${r.coins} 🪙 · +${r.xp} XP`));
            const bar = el('div', 'bar');
            const fill = el('span');
            fill.style.width = Math.round(100 * Math.min(1, m.progress / m.target)) + '%';
            bar.appendChild(fill);
            row.append(top, bar, el('div', 'mission-prog', `${fmtInt(m.progress)} / ${fmtInt(m.target)}`));
            ml.appendChild(row);
        }
        const cl = this.$('challenges-list');
        cl.replaceChildren();
        for (const t of TROPHIES) {
            const got = !!save.trophies[t.id];
            const v = Math.min(t.target, trophyValue(t, null, save));
            const row = el('div', 'trophy' + (got ? ' done' : ''));
            row.append(el('div', 'trophy-ico', got ? t.icon : '🔒'));
            const body = el('div', 'trophy-body');
            body.append(el('div', 'trophy-title', t.title), el('div', 'trophy-desc', t.desc));
            const bar = el('div', 'bar');
            const fill = el('span');
            fill.style.width = Math.round(100 * (got ? 1 : v / t.target)) + '%';
            bar.appendChild(fill);
            body.appendChild(bar);
            const right = el('div', 'trophy-reward', got ? 'Obtenu' : `+${t.reward.coins} 🪙 +${t.reward.xp} XP`);
            row.append(body, right);
            cl.appendChild(row);
        }
    }

    // ------------------------------------------------------------------ STATS
    renderStats() {
        const save = this.getSave();
        const p = save.progress;
        this.$('stat-total-dist').textContent = fmtInt(p.totalDist) + ' m';
        this.$('stat-total-gates').textContent = fmtInt(p.totalGates);
        this.$('stat-max-speed').textContent = fmtInt(p.maxSpeedKmh) + ' km/h';
        this.$('stat-max-combo').textContent = 'x' + p.maxCombo;
        this.$('stat-total-time').textContent = fmtDuration(p.totalTime);
        this.$('stat-total-coins').textContent = fmtInt(p.totalCoinsCollected);
        this.$('stat-total-jumps').textContent = fmtInt(p.totalJumps);
        this.$('stat-level').textContent = levelOf(save);

        const rl = this.$('records-list');
        rl.replaceChildren();
        let any = false;
        for (const id of TRACK_ORDER) {
            const t = TRACKS[id];
            const e = save.bests[bestKey('endless', id)];
            const tt = save.bests[bestKey('timetrial', id)];
            if (!(e && (e.score || e.dist)) && !(tt && tt.time != null)) continue;
            any = true;
            const row = el('div', 'record');
            row.append(el('div', 'record-track', `${t.icon} ${t.name}`));
            const cells = el('div', 'record-cells');
            if (e && (e.score || e.dist)) cells.append(el('span', '', `♾️ ${fmtInt(e.score)} pts · ${fmtInt(e.dist)} m · ${e.gates} portes`));
            if (tt && tt.time != null) {
                const medal = this._medal(id, tt.time);
                cells.append(el('span', '', `⏱️ ${fmtTime(tt.time)}${medal ? ' · ' + medal : ''}`));
            }
            row.append(cells);
            rl.appendChild(row);
        }
        if (!any) rl.appendChild(el('div', 'empty', 'Aucun record pour l\'instant : lancez une descente !'));

        const hl = this.$('history-list');
        hl.replaceChildren();
        if (!save.history.length) hl.appendChild(el('div', 'empty', 'Aucune descente enregistrée.'));
        for (const r of save.history.slice(0, 12)) {
            const row = el('div', 'history-row');
            const when = r.date ? new Date(r.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '';
            const tr = TRACKS[r.track];
            const mode = MODES[r.mode];
            row.append(
                el('span', 'h-when', when),
                el('span', 'h-who', `${r.player || ''}`),
                el('span', 'h-what', `${mode ? mode.icon : ''} ${tr ? tr.name : ''}`),
                el('span', 'h-score', r.mode === 'timetrial' && r.result === 'finish' ? fmtTime(r.time) : fmtInt(r.score) + ' pts'),
                el('span', 'h-extra', `${fmtInt(r.dist)} m · ${r.gates}🚩`)
            );
            hl.appendChild(row);
        }
    }

    _medal(trackId, time) {
        const m = MEDAL_TIMES[trackId];
        if (!m) return '';
        const k = time <= m.gold ? 'gold' : time <= m.silver ? 'silver' : time <= m.bronze ? 'bronze' : null;
        return k ? MEDAL_ICON[k] : '';
    }

    // ------------------------------------------------------------------ RÉGLAGES
    syncSettingsForm() {
        const s = this.settings.values;
        const set = (id, v) => { const e = this.$(id); if (e.value !== String(v)) e.value = v; };
        if (document.activeElement !== this.$('set-player-name')) set('set-player-name', s.playerName);
        set('set-difficulty', s.difficulty);
        set('set-graphics', s.graphics);
        set('set-weather', s.weather);
        set('set-default-cam', s.defaultCamera);
        set('set-sensitivity', s.sensitivity);
        set('set-volume', s.volume);
        set('set-snow-intensity', s.snowIntensity);
        set('pz-volume', s.volume);
        set('pz-sensitivity', s.sensitivity);
        set('pz-snow', s.snowIntensity);
        set('pz-graphics', s.graphics);
        this.$('lbl-sensitivity').textContent = s.sensitivity + '%';
        this.$('lbl-volume').textContent = s.volume + '%';
        this.$('lbl-snow').textContent = s.snowIntensity + '%';
        this.$('pz-volume-lbl').textContent = s.volume + '%';
        this.$('pz-sensitivity-lbl').textContent = s.sensitivity + '%';
        this.$('pz-snow-lbl').textContent = s.snowIntensity + '%';
        this.$('set-ambience').checked = s.ambience;
        this.$('set-shake').checked = s.shake;
        this.$('set-vibration').checked = s.vibration;
        this.$('set-show-fps').checked = s.showFps;
        this.$('hud-fps').classList.toggle('hidden', !s.showFps || !this.inGame);
        this.$('welcome-player-tag').textContent = `Skieur : ${s.playerName}`;
    }

    // ------------------------------------------------------------------ HUD
    /** Prépare le HUD pour une course. */
    initHud(run, best) {
        this._hudCache = {};
        const free = run.mode === 'free';
        this._show('hud-gates-wrap', !free);
        this._show('hud-coins-wrap', !free);
        this.$('hud-score').parentElement.parentElement.classList.toggle('hidden', free);
        this._set('hud-mode-badge', MODES[run.mode].name);
        this._set('hud-difficulty-badge', DIFFICULTY_PRESETS[run.difficulty].label);
        this._set('hud-best', run.mode === 'timetrial' ? fmtTime(best.time) : fmtInt(best.score));
        this._show('hud-lives', Number.isFinite(run.maxLives));
        this._livesKey = '';
        const objective = run.mode === 'trial' || run.mode === 'timetrial';
        this._show('hud-objective', objective);
        this._show('hud-time-card', run.mode !== 'free');
        this.setHud(true);
        this.$('hud-fps').classList.toggle('hidden', !this.settings.values.showFps);
        this.$('cam-label').textContent = CAMERA_PRESETS[this.settings.values.defaultCamera].name;
    }

    updateHud(run, phys, courseLen) {
        this._set('hud-score', fmtInt(run.score));
        this._set('hud-combo', 'x' + run.combo);
        this._set('hud-speed', phys.kmh);
        this._set('hud-gates', run.gates);
        this._set('hud-dist', Math.floor(run.distM));
        this._set('hud-coins', run.coins);
        if (run.mode !== 'free') this._set('hud-time', fmtTime(run.time + run.penalties));
        if (Number.isFinite(run.maxLives)) {
            const key = run.lives + '/' + run.maxLives;
            if (key !== this._livesKey) {
                this._livesKey = key;
                const box = this.$('hud-lives');
                box.replaceChildren();
                for (let i = 0; i < run.maxLives; i++) box.appendChild(el('span', 'life' + (i < run.lives ? '' : ' lost'), '❤'));
            }
        }
        if (run.mode === 'timetrial') {
            this._set('hud-objective-text', `Arrivée : ${Math.floor(run.distM)} / ${run.targetM || courseLen} m`);
            this.$('hud-progress-fill').style.width = Math.round(100 * Math.min(1, run.distM / (run.targetM || courseLen || 1))) + '%';
        } else if (run.mode === 'trial') {
            const t = run.trial;
            let v, txt;
            if (t.finish) { v = Math.min(1, run.distM / (courseLen || 1)); txt = `${t.name} — ${fmtTime(run.time + run.penalties)} / ${t.timeLimit} s`; }
            else { const cur = run.trialNow; v = Math.min(1, cur / t.target); txt = `${t.name} — ${cur} / ${t.target}`; }
            this._set('hud-objective-text', txt);
            this.$('hud-progress-fill').style.width = Math.round(v * 100) + '%';
        }
    }

    setFps(fps) { this._set('hud-fps', `${Math.round(fps)} FPS`); }
    setCameraLabel(name) { this.$('cam-label').textContent = name; }
    setSoundIcon(muted) {
        this.$('icon-sound-on').classList.toggle('hidden', muted);
        this.$('icon-sound-off').classList.toggle('hidden', !muted);
    }

    feedback(text, cls = 'c-emerald') {
        const box = this.$('feedback-container');
        while (box.childElementCount >= 4) box.removeChild(box.firstChild);
        const e = el('div', 'feedback-anim ' + cls, text);
        box.appendChild(e);
        setTimeout(() => { if (e.parentNode) e.parentNode.removeChild(e); }, 1150);
    }

    flash(color, ms = 220) {
        const f = this.$('flash');
        f.style.background = color;
        f.classList.remove('on');
        void f.offsetWidth;
        f.classList.add('on');
        clearTimeout(this._flashT);
        this._flashT = setTimeout(() => f.classList.remove('on'), ms);
    }

    setSpeedFx(ratio) {
        const v = this.$('speed-vignette');
        const o = Math.max(0, Math.min(1, (ratio - 0.35) / 0.65)).toFixed(2);
        if (this._fxO !== o) { this._fxO = o; v.style.opacity = o; }
    }

    countdown(text) {
        const c = this.$('countdown');
        if (text == null) { c.classList.add('hidden'); return; }
        c.classList.remove('hidden');
        const t = this.$('countdown-text');
        t.textContent = text;
        t.classList.remove('pop');
        void t.offsetWidth;
        t.classList.add('pop');
    }

    // ------------------------------------------------------------------ notifications
    toast(icon, label, title) {
        this._toastQueue.push({ icon, label, title });
        if (!this._toastBusy) this._nextToast();
    }
    _nextToast() {
        const n = this._toastQueue.shift();
        if (!n) { this._toastBusy = false; return; }
        this._toastBusy = true;
        const t = this.$('challenge-toast');
        this.$('challenge-toast-icon').textContent = n.icon;
        this.$('challenge-toast-label').textContent = n.label;
        this.$('challenge-toast-title').textContent = n.title;
        t.classList.add('show');
        setTimeout(() => { t.classList.remove('show'); setTimeout(() => this._nextToast(), 350); }, 2300);
    }

    confirm(title, text, yes = 'Confirmer') {
        return new Promise((resolve) => {
            this.$('confirm-title').textContent = title;
            this.$('confirm-text').textContent = text;
            this.$('confirm-yes').textContent = yes;
            this._confirmResolve = resolve;
            this.$('confirm-modal').classList.remove('hidden');
            this.$('confirm-no').focus();
        });
    }
    _closeConfirm(v) {
        this.$('confirm-modal').classList.add('hidden');
        const r = this._confirmResolve;
        this._confirmResolve = null;
        if (r) r(v);
    }

    // ------------------------------------------------------------------ résultat
    showResult(run, summary, best) {
        const st = RESULT_STYLE[run.result] || RESULT_STYLE.crash;
        let title = st.title;
        if (run.mode === 'timetrial' && run.result === 'fail') { title = 'Course abandonnée'; }
        if (run.mode === 'endless') title = run.result === 'crash' ? 'Chute Brutale !' : 'Fin de course';
        this.$('go-icon').textContent = st.icon;
        this.$('go-title').textContent = title;
        this.$('crash-reason').textContent = run.reason || '';
        this.$('new-record-badge').classList.toggle('hidden', !summary.newRecord);
        const medal = this.$('go-medal');
        if (summary.medal) { medal.textContent = MEDAL_ICON[summary.medal]; medal.classList.remove('hidden'); } else medal.classList.add('hidden');
        this.$('go-score').textContent = fmtInt(run.score);
        this.$('go-best').textContent = run.mode === 'timetrial' ? fmtTime(best.time) : fmtInt(best.score);
        this.$('go-gates').textContent = run.gates;
        this.$('go-combo').textContent = 'x' + run.maxCombo;
        this.$('go-speed').textContent = run.maxSpeedKmh + ' km/h';
        this.$('go-dist').textContent = fmtInt(run.distM) + ' m';
        this.$('go-time').textContent = fmtTime(run.finalTime || run.time);
        this.$('go-coins').textContent = fmtInt(summary.coins);
        this.$('go-xp').textContent = '+' + fmtInt(summary.xp) + ' XP';

        const ul = this.$('go-rewards');
        ul.replaceChildren();
        const add = (t, cls) => ul.appendChild(el('li', cls || '', t));
        if (run.mode === 'free') add('Mode libre : aucun gain, aucun score.', 'muted');
        if (summary.levelAfter > summary.levelBefore) add(`⭐ Niveau ${summary.levelAfter} atteint !`, 'good');
        if (summary.finishBonus) add(`🏁 Bonus d'arrivée : +${summary.finishBonus} 🪙`, 'good');
        if (summary.trialFirstClear) add(`🎯 Défi réussi : +${summary.trialReward.coins} 🪙 · +${summary.trialReward.xp} XP`, 'good');
        for (const t of summary.trophies) add(`${t.icon} Trophée « ${t.title} » : +${t.reward.coins} 🪙 · +${t.reward.xp} XP`, 'good');
        for (const m of summary.missions) add(`📅 Mission accomplie : ${m.text} (+${m.reward.coins} 🪙 · +${m.reward.xp} XP)`, 'good');
        for (const u of summary.unlocks) add(`🔓 Débloqué : ${u.name}`, 'good');
        this.showScreen('gameover');
    }
}
