// Sauvegarde persistante : localStorage protégé (repli en mémoire), validation stricte et migration
// des anciennes clés de la version 1 du jeu.
import { sanitizeSettings, cleanPlayerName, DEFAULT_SETTINGS } from './settings.js';
import { DEFAULT_AVATAR, sanitizeAvatar } from './avatar-config.js';

export const SAVE_KEY = 'slalom_extreme_save_v2';
export const LEGACY_KEYS = {
    BEST: 'slalom_extreme_best',
    HISTORY: 'slalom_extreme_history_v1',
    SETTINGS: 'slalom_extreme_settings_v1',
    CHALLENGES: 'slalom_extreme_challenges_v1',
    STATS: 'slalom_extreme_stats_v1'
};

const ID_RE = /^[a-z0-9_]{1,32}$/;
const MODES = ['endless', 'timetrial', 'trial', 'free'];
const BEST_KEY_RE = /^(endless|timetrial|trial|free):[a-z0-9_]{1,24}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HISTORY = 30;

const LEGACY_SUIT_TO_OUTFIT = {
    '#ef4444': 'o_red', '#2563eb': 'o_blue', '#10b981': 'o_green', '#f59e0b': 'o_amber', '#a855f7': 'o_purple'
};
const LEGACY_DIFF_LABEL = { 'Débutant': 'easy', 'Normal': 'normal', 'Extrême': 'extreme' };

// ---------------------------------------------------------------------------
// Accès bas niveau : localStorage si disponible, sinon mémoire (la partie reste jouable).
// ---------------------------------------------------------------------------
const memoryStore = new Map();
let persistent = null; // null = pas encore testé
let lastError = null;

function probeStorage() {
    if (persistent !== null) return persistent;
    try {
        const k = '__slalom_probe__';
        window.localStorage.setItem(k, '1');
        window.localStorage.removeItem(k);
        persistent = true;
    } catch (e) {
        persistent = false;
    }
    return persistent;
}

export function isStoragePersistent() { return probeStorage(); }
export function getStorageError() { return lastError; }

export function readRaw(key) {
    if (probeStorage()) {
        try { return window.localStorage.getItem(key); } catch (e) { persistent = false; }
    }
    return memoryStore.has(key) ? memoryStore.get(key) : null;
}

export function writeRaw(key, value) {
    memoryStore.set(key, value);
    if (probeStorage()) {
        try {
            window.localStorage.setItem(key, value);
            lastError = null;
            return true;
        } catch (e) {
            lastError = e;           // quota dépassé, mode privé strict, etc.
            return false;
        }
    }
    return false;
}

export function removeRaw(key) {
    memoryStore.delete(key);
    if (probeStorage()) {
        try { window.localStorage.removeItem(key); } catch (e) { /* ignoré */ }
    }
}

// ---------------------------------------------------------------------------
// Helpers de validation
// ---------------------------------------------------------------------------
function int(v, min, max, def) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, Math.floor(n)));
}
function flt(v, min, max, def) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
}
function id(v, def) {
    return typeof v === 'string' && ID_RE.test(v) ? v : def;
}
function idList(arr, max = 64) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const v of arr) {
        if (typeof v === 'string' && ID_RE.test(v) && !out.includes(v)) out.push(v);
        if (out.length >= max) break;
    }
    return out;
}
function isPlain(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }

export function defaultSave() {
    return {
        v: 2,
        migrated: false,
        settings: sanitizeSettings(DEFAULT_SETTINGS),
        progress: {
            xp: 0, coins: 0, bestScore: 0, totalScore: 0, totalGames: 0, totalDist: 0, totalGates: 0,
            totalPerfect: 0, totalCoinsCollected: 0, totalJumps: 0, totalTime: 0, totalFinishes: 0, totalTrials: 0,
            maxSpeedKmh: 0, maxCombo: 1, maxAirTime: 0
        },
        bests: {},
        history: [],
        trophies: {},
        trials: {},
        missions: { day: '', list: [] },
        unlocks: { characters: [], outfits: [], skis: [], helmets: [], accessories: [] },
        loadout: { character: 'c_alex', outfit: 'o_red', skis: 's_yellow', helmet: 'h_blue', accessory: 'a_none' },
        avatar: { ...DEFAULT_AVATAR },
        selection: { mode: 'endless', track: 'beginner', trial: 'trial_first_turns' }
    };
}

function sanitizeBests(raw) {
    const out = {};
    if (!isPlain(raw)) return out;
    let n = 0;
    for (const key of Object.keys(raw)) {
        if (!BEST_KEY_RE.test(key) || !isPlain(raw[key])) continue;
        const b = raw[key];
        out[key] = {
            score: int(b.score, 0, 1e9, 0),
            dist: int(b.dist, 0, 1e7, 0),
            gates: int(b.gates, 0, 1e6, 0),
            time: b.time == null ? null : flt(b.time, 1, 36000, null)
        };
        if (++n >= 64) break;
    }
    return out;
}

function sanitizeHistory(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const r of raw) {
        if (!isPlain(r)) continue;
        out.push({
            player: cleanPlayerName(r.player),
            mode: MODES.includes(r.mode) ? r.mode : 'endless',
            track: id(r.track, 'beginner'),
            score: int(r.score, 0, 1e9, 0),
            gates: int(r.gates, 0, 1e6, 0),
            combo: int(r.combo, 1, 1e4, 1),
            dist: int(r.dist, 0, 1e7, 0),
            speed: int(r.speed, 0, 1000, 0),
            time: flt(r.time, 0, 36000, 0),
            coins: int(r.coins, 0, 1e6, 0),
            difficulty: ['easy', 'normal', 'extreme'].includes(r.difficulty) ? r.difficulty : 'normal',
            date: flt(r.date, 0, 4e12, 0),
            dateLabel: typeof r.dateLabel === 'string' ? r.dateLabel.replace(/[<>]/g, '').slice(0, 24) : '',
            result: ['crash', 'finish', 'success', 'fail', 'quit', ''].includes(r.result) ? r.result : ''
        });
        if (out.length >= MAX_HISTORY) break;
    }
    return out;
}

function sanitizeMissions(raw) {
    const out = { day: '', list: [] };
    if (!isPlain(raw)) return out;
    if (typeof raw.day === 'string' && DAY_RE.test(raw.day)) out.day = raw.day;
    if (Array.isArray(raw.list)) {
        for (const m of raw.list.slice(0, 5)) {
            if (!isPlain(m)) continue;
            const mid = id(m.id, null);
            if (!mid) continue;
            out.list.push({
                id: mid,
                target: int(m.target, 1, 1e7, 1),
                progress: int(m.progress, 0, 1e7, 0),
                done: m.done === true
            });
        }
    }
    return out;
}

/** Valide un objet de sauvegarde complet. Ne retourne que des clés connues avec des valeurs bornées. */
export function sanitizeSave(raw) {
    const d = defaultSave();
    if (!isPlain(raw)) return d;
    const p = isPlain(raw.progress) ? raw.progress : {};
    const dp = d.progress;
    const out = {
        v: 2,
        migrated: raw.migrated === true,
        settings: sanitizeSettings(raw.settings),
        progress: {
            xp: int(p.xp, 0, 1e9, dp.xp),
            coins: int(p.coins, 0, 1e9, dp.coins),
            bestScore: int(p.bestScore, 0, 1e9, dp.bestScore),
            totalScore: int(p.totalScore, 0, 1e12, dp.totalScore),
            totalGames: int(p.totalGames, 0, 1e7, dp.totalGames),
            totalDist: int(p.totalDist, 0, 1e9, dp.totalDist),
            totalGates: int(p.totalGates, 0, 1e8, dp.totalGates),
            totalPerfect: int(p.totalPerfect, 0, 1e8, dp.totalPerfect),
            totalCoinsCollected: int(p.totalCoinsCollected, 0, 1e8, dp.totalCoinsCollected),
            totalJumps: int(p.totalJumps, 0, 1e8, dp.totalJumps),
            totalTime: flt(p.totalTime, 0, 1e9, dp.totalTime),
            totalFinishes: int(p.totalFinishes, 0, 1e7, dp.totalFinishes),
            totalTrials: int(p.totalTrials, 0, 1e7, dp.totalTrials),
            maxSpeedKmh: int(p.maxSpeedKmh, 0, 1000, dp.maxSpeedKmh),
            maxCombo: int(p.maxCombo, 1, 1e4, dp.maxCombo),
            maxAirTime: flt(p.maxAirTime, 0, 100, dp.maxAirTime)
        },
        bests: sanitizeBests(raw.bests),
        history: sanitizeHistory(raw.history),
        trophies: {},
        trials: {},
        missions: sanitizeMissions(raw.missions),
        unlocks: { characters: [], outfits: [], skis: [], helmets: [], accessories: [] },
        loadout: { ...d.loadout },
        avatar: sanitizeAvatar(raw.avatar),
        selection: { ...d.selection }
    };
    if (isPlain(raw.trophies)) {
        let n = 0;
        for (const k of Object.keys(raw.trophies)) {
            if (!ID_RE.test(k)) continue;
            const t = raw.trophies[k];
            out.trophies[k] = { unlockedAt: isPlain(t) ? flt(t.unlockedAt, 0, 4e12, 0) : 0 };
            if (++n >= 80) break;
        }
    }
    if (isPlain(raw.trials)) {
        let n = 0;
        for (const k of Object.keys(raw.trials)) {
            if (!ID_RE.test(k) || !isPlain(raw.trials[k])) continue;
            const t = raw.trials[k];
            out.trials[k] = { done: t.done === true, best: t.best == null ? null : flt(t.best, 0, 1e9, null), at: flt(t.at, 0, 4e12, 0) };
            if (++n >= 40) break;
        }
    }
    if (isPlain(raw.unlocks)) {
        for (const cat of Object.keys(out.unlocks)) out.unlocks[cat] = idList(raw.unlocks[cat]);
    }
    if (isPlain(raw.loadout)) {
        for (const cat of Object.keys(out.loadout)) out.loadout[cat] = id(raw.loadout[cat], d.loadout[cat]);
    }
    if (isPlain(raw.selection)) {
        out.selection.mode = MODES.includes(raw.selection.mode) ? raw.selection.mode : d.selection.mode;
        out.selection.track = id(raw.selection.track, d.selection.track);
        out.selection.trial = id(raw.selection.trial, d.selection.trial);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Migration depuis la version 1 (clés séparées)
// ---------------------------------------------------------------------------
function readJSON(key) {
    const raw = readRaw(key);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
}

export function migrateLegacy(save) {
    if (save.migrated) return false;
    let touched = false;

    const legacySettings = readJSON(LEGACY_KEYS.SETTINGS);
    if (isPlain(legacySettings)) {
        const s = { ...save.settings };
        if (typeof legacySettings.playerName === 'string') s.playerName = legacySettings.playerName;
        if (typeof legacySettings.difficulty === 'string') s.difficulty = legacySettings.difficulty;
        if (typeof legacySettings.weather === 'string') s.weather = legacySettings.weather;
        if (legacySettings.sensitivity != null) s.sensitivity = legacySettings.sensitivity;
        if (legacySettings.volume != null) s.volume = legacySettings.volume;
        if (legacySettings.defaultCamera != null) s.defaultCamera = legacySettings.defaultCamera;
        if (legacySettings.snowParticles === false) s.snowIntensity = 0;
        save.settings = sanitizeSettings(s);
        const outfit = LEGACY_SUIT_TO_OUTFIT[String(legacySettings.suitColor || '').toLowerCase()];
        if (outfit) save.loadout.outfit = outfit;
        touched = true;
    }

    const stats = readJSON(LEGACY_KEYS.STATS);
    if (isPlain(stats)) {
        const p = save.progress;
        p.totalGames = int(stats.totalGames, 0, 1e7, 0);
        p.totalDist = int(stats.totalDist, 0, 1e9, 0);
        p.totalGates = int(stats.totalGates, 0, 1e8, 0);
        p.maxSpeedKmh = int(stats.maxSpeedKmh, 0, 1000, 0);
        p.maxCombo = int(stats.maxCombo, 1, 1e4, 1);
        // Crédit d'expérience calculé uniquement à partir d'actions réellement accomplies dans l'ancienne version.
        p.xp += Math.min(2000, Math.floor(p.totalDist / 25) + p.totalGates * 4);
        touched = true;
    }

    const best = parseInt(readRaw(LEGACY_KEYS.BEST) || '0', 10);
    if (Number.isFinite(best) && best > 0) {
        save.progress.bestScore = Math.max(save.progress.bestScore, Math.min(best, 1e9));
        touched = true;
    }

    const challenges = readJSON(LEGACY_KEYS.CHALLENGES);
    if (isPlain(challenges)) {
        for (const k of Object.keys(challenges)) {
            if (!ID_RE.test(k)) continue;
            const t = challenges[k];
            let at = 0;
            if (isPlain(t) && typeof t.unlockedAt === 'string') {
                const ms = Date.parse(t.unlockedAt);
                at = Number.isFinite(ms) ? ms : 0;
            }
            save.trophies[k] = { unlockedAt: at };
        }
        touched = true;
    }

    const history = readJSON(LEGACY_KEYS.HISTORY);
    if (Array.isArray(history)) {
        const converted = history.filter(isPlain).slice(0, MAX_HISTORY).map(r => ({
            player: r.player, mode: 'endless', track: 'beginner',
            score: r.score, gates: r.gates, combo: r.combo, dist: r.dist, speed: r.speed, time: 0, coins: 0,
            difficulty: LEGACY_DIFF_LABEL[r.difficulty] || 'normal', date: 0,
            dateLabel: typeof r.date === 'string' ? r.date : '', result: 'crash'
        }));
        save.history = sanitizeHistory(converted);
        touched = true;
    }

    save.migrated = true;
    return touched;
}

// ---------------------------------------------------------------------------
// Sauvegarde active (singleton)
// ---------------------------------------------------------------------------
let current = null;
let saveTimer = null;

export function loadSave() {
    const raw = readRaw(SAVE_KEY);
    let save;
    if (raw == null) {
        save = defaultSave();
    } else {
        try {
            save = sanitizeSave(JSON.parse(raw));
        } catch (e) {
            // Sauvegarde corrompue : on la conserve à part pour ne rien perdre et on repart proprement.
            writeRaw(SAVE_KEY + '_corrupt', raw);
            save = defaultSave();
        }
    }
    if (!save.migrated) {
        migrateLegacy(save);
        flushNow(save);
    }
    current = save;
    return save;
}

export function getSave() {
    if (!current) current = loadSave();
    return current;
}

function flushNow(save = current) {
    if (!save) return false;
    try {
        return writeRaw(SAVE_KEY, JSON.stringify(save));
    } catch (e) {
        lastError = e;
        return false;
    }
}

/** Planifie une écriture groupée (évite d'écrire à chaque événement de curseur). */
export function persist() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; flushNow(); }, 200);
}

/** Écriture immédiate (fin de course, fermeture de page). */
export function persistNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    return flushNow();
}

/** Remet la progression à zéro en conservant les paramètres du joueur. */
export function resetProgress() {
    const keepSettings = current ? current.settings : sanitizeSettings(DEFAULT_SETTINGS);
    const fresh = defaultSave();
    fresh.settings = keepSettings;
    fresh.migrated = true;           // empêche la résurrection des anciennes clés
    Object.values(LEGACY_KEYS).forEach(removeRaw);
    removeRaw(SAVE_KEY + '_corrupt');
    // Mutation en place pour que les références existantes restent valides.
    if (current) {
        for (const k of Object.keys(current)) delete current[k];
        Object.assign(current, fresh);
    } else {
        current = fresh;
    }
    persistNow();
    return current;
}

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => { persistNow(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') persistNow();
    });
}
