// Paramètres du jeu : valeurs par défaut, validation, profils graphiques et préréglages.
// Ce module ne dépend d'aucun autre module du projet.

export const DIFFICULTY_PRESETS = {
    // Valeurs de départ conservées de la version d'origine (vitesses en unités/s, 1 unité/s = 2,35 km/h).
    easy:    { label: 'Débutant', minSpeed: 20, maxSpeed: 50, accel: 0.50, gateWidthMul: 1.19, scoreMult: 0.85, obstacleMul: 0.62, lives: 4 },
    normal:  { label: 'Normal',   minSpeed: 24, maxSpeed: 64, accel: 0.72, gateWidthMul: 1.00, scoreMult: 1.00, obstacleMul: 1.00, lives: 3 },
    extreme: { label: 'Extrême',  minSpeed: 30, maxSpeed: 78, accel: 1.05, gateWidthMul: 0.84, scoreMult: 1.50, obstacleMul: 1.38, lives: 2 }
};

export const GRAPHICS_PROFILES = {
    eco: {
        label: 'Économie',
        pixelRatioCap: 1,
        shadows: false,
        shadowMapSize: 512,
        snowMax: 350,
        sprayMax: 90,
        viewChunks: 3,        // nombre de segments de 60 m générés devant le skieur
        decorDensity: 0.5,
        trailCapacity: 260,
        farMountains: false,
        terrainRowStep: 4,
        dynamicResolution: true,
        antialias: false
    },
    balanced: {
        label: 'Équilibré',
        pixelRatioCap: 1.5,
        shadows: true,
        shadowMapSize: 1024,
        snowMax: 800,
        sprayMax: 200,
        viewChunks: 4,
        decorDensity: 0.8,
        trailCapacity: 520,
        farMountains: true,
        terrainRowStep: 3,
        dynamicResolution: true,
        antialias: true
    },
    high: {
        label: 'Élevé',
        pixelRatioCap: 2,
        shadows: true,
        shadowMapSize: 2048,
        snowMax: 1600,
        sprayMax: 380,
        viewChunks: 5,
        decorDensity: 1.0,
        trailCapacity: 900,
        farMountains: true,
        terrainRowStep: 2,
        dynamicResolution: false,
        antialias: true
    }
};

// Ambiances : les 4 météos d'origine + "auto" (ambiance propre à la piste).
export const WEATHER_PRESETS = {
    sunny: {
        label: 'Grand soleil alpin',
        skyTop: 0x5aa2ee, skyHorizon: 0xdbeafe, fogColor: 0xdbeafe, fogDensity: 0.0058,
        hemiSky: 0xffffff, hemiGround: 0x93c5fd, hemiInt: 1.55,
        sunColor: 0xfffbeb, sunInt: 2.6, sunElevation: 0.9,
        mountainTint: 0xb9c7dd, night: false, snowTint: 0xf8fafc
    },
    sunset: {
        label: 'Coucher de soleil doré',
        skyTop: 0x5b6fb5, skyHorizon: 0xfdba74, fogColor: 0xf6b98a, fogDensity: 0.0064,
        hemiSky: 0xfef08a, hemiGround: 0x7c2d12, hemiInt: 1.3,
        sunColor: 0xff9d4d, sunInt: 2.7, sunElevation: 0.32,
        mountainTint: 0xd49a86, night: false, snowTint: 0xffe9d6
    },
    night: {
        label: 'Slalom nocturne éclairé',
        skyTop: 0x050a1c, skyHorizon: 0x1b2a52, fogColor: 0x131f3d, fogDensity: 0.0085,
        hemiSky: 0x5b8bd8, hemiGround: 0x0b1226, hemiInt: 0.95,
        sunColor: 0x9db8ff, sunInt: 0.9, sunElevation: 0.7,
        mountainTint: 0x2a3a64, night: true, snowTint: 0xc9d8f5
    },
    blizzard: {
        label: 'Blizzard polaire',
        skyTop: 0x9fb0c4, skyHorizon: 0xcbd5e1, fogColor: 0xcbd5e1, fogDensity: 0.0130,
        hemiSky: 0xf1f5f9, hemiGround: 0x64748b, hemiInt: 1.5,
        sunColor: 0xe2e8f0, sunInt: 1.2, sunElevation: 0.8,
        mountainTint: 0xaab6c6, night: false, snowTint: 0xf1f5f9
    }
};

export const CAMERA_PRESETS = [
    { name: 'Proche', offsetY: 4.4, offsetZ: 8.2,  lookY: 1.3,  lookZ: -22, baseFov: 62, rollFactor: 0.38 },
    { name: 'Large',  offsetY: 7.2, offsetZ: 12.8, lookY: 1.0,  lookZ: -26, baseFov: 58, rollFactor: 0.25 },
    { name: 'Casque', offsetY: 1.85, offsetZ: -0.35, lookY: 1.25, lookZ: -30, baseFov: 74, rollFactor: 0.55 }
];

export const DEFAULT_SETTINGS = Object.freeze({
    playerName: 'Champion',
    difficulty: 'normal',
    weather: 'auto',
    graphics: 'balanced',
    sensitivity: 100,      // 60 – 150 %
    volume: 80,            // 0 – 100 %
    ambience: true,        // bruit de vent de montagne
    snowIntensity: 70,     // 0 – 100 %
    defaultCamera: 0,
    shake: true,           // secousses de caméra
    vibration: true,       // vibration sur mobile lors d'un choc
    showFps: false
});

function num(v, min, max, def) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
}
function oneOf(v, list, def) {
    return list.includes(v) ? v : def;
}
function bool(v, def) {
    return typeof v === 'boolean' ? v : def;
}

export function cleanPlayerName(v) {
    if (typeof v !== 'string') return DEFAULT_SETTINGS.playerName;
    // Retire les caractères de contrôle et limite la longueur.
    const s = v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
    return s || DEFAULT_SETTINGS.playerName;
}

/** Valide un objet de paramètres quelconque (ex. JSON modifié à la main). Ne copie que les clés connues. */
export function sanitizeSettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = DEFAULT_SETTINGS;
    return {
        playerName: cleanPlayerName(r.playerName),
        difficulty: oneOf(r.difficulty, Object.keys(DIFFICULTY_PRESETS), d.difficulty),
        weather: oneOf(r.weather, ['auto', ...Object.keys(WEATHER_PRESETS)], d.weather),
        graphics: oneOf(r.graphics, Object.keys(GRAPHICS_PROFILES), d.graphics),
        sensitivity: Math.round(num(r.sensitivity, 60, 150, d.sensitivity)),
        volume: Math.round(num(r.volume, 0, 100, d.volume)),
        ambience: bool(r.ambience, d.ambience),
        snowIntensity: Math.round(num(r.snowIntensity, 0, 100, d.snowIntensity)),
        defaultCamera: Math.round(num(r.defaultCamera, 0, CAMERA_PRESETS.length - 1, d.defaultCamera)),
        shake: bool(r.shake, d.shake),
        vibration: bool(r.vibration, d.vibration),
        showFps: bool(r.showFps, d.showFps)
    };
}

/** Gestionnaire de paramètres : lit/écrit via la sauvegarde et notifie les abonnés. */
export class SettingsManager {
    constructor(getSave, persist) {
        this._getSave = getSave;
        this._persist = persist;
        this._listeners = new Set();
    }
    get values() { return this._getSave().settings; }
    get profile() { return GRAPHICS_PROFILES[this.values.graphics] || GRAPHICS_PROFILES.balanced; }
    get difficulty() { return DIFFICULTY_PRESETS[this.values.difficulty] || DIFFICULTY_PRESETS.normal; }
    set(partial) {
        const save = this._getSave();
        const merged = sanitizeSettings({ ...save.settings, ...partial });
        const changed = Object.keys(merged).filter(k => merged[k] !== save.settings[k]);
        save.settings = merged;
        this._persist();
        if (changed.length) this._listeners.forEach(fn => { try { fn(merged, changed); } catch (e) { console.error(e); } });
        return merged;
    }
    onChange(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }
}

/** Détecte les appareils modestes pour proposer un profil de départ prudent (sans jamais l'imposer). */
export function isLowEndDevice() {
    try {
        const cores = navigator.hardwareConcurrency || 4;
        const mem = navigator.deviceMemory || 4;
        // Très prudent : seulement les appareils réellement modestes (le profil Équilibré reste la valeur par défaut)
        return mem <= 2 || (cores <= 2 && mem <= 3);
    } catch (e) {
        return false;
    }
}
