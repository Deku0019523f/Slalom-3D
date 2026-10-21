// Définition des pistes (5 environnements) et modèle mathématique du terrain.
// Aucun objet Three.js ici : ces fonctions sont aussi utilisées par la physique et les tests.
import { WEATHER_PRESETS } from './settings.js';

// ---------------------------------------------------------------------------
// Utilitaires déterministes (hash, RNG, bruit)
// ---------------------------------------------------------------------------
export function hash32(a, b = 0, c = 0) {
    let h = (a | 0) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return (h ^ (h >>> 16)) >>> 0;
}
export function rand01(a, b = 0, c = 0) { return hash32(a, b, c) / 4294967296; }

export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function noise2(x, y, seed = 0) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = rand01(xi, yi, seed), b = rand01(xi + 1, yi, seed);
    const c = rand01(xi, yi + 1, seed), d = rand01(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function smoothstep(e0, e1, x) {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// Conversions d'unités conservées de la version d'origine.
export const DIST_FACTOR = 0.45;   // 1 unité monde = 0,45 m affiché
export const KMH_FACTOR = 2.35;    // 1 unité/s = 2,35 km/h
export const CHUNK_LEN = 60;       // longueur d'un segment de piste (unités)

// ---------------------------------------------------------------------------
// Pistes
// ---------------------------------------------------------------------------
const AMBIENCE_ALPINE = {
    skyTop: 0x2f7ae0, skyHorizon: 0xcfe3fb, fogColor: 0xcfe3fb, fogDensity: 0.0055,
    hemiSky: 0xf4f9ff, hemiGround: 0x8fb4e8, hemiInt: 1.5,
    sunColor: 0xfff4dd, sunInt: 2.8, sunElevation: 0.78,
    mountainTint: 0xa9bdd9, night: false, snowTint: 0xf6f9ff
};
const AMBIENCE_FOREST = {
    skyTop: 0x78a3c8, skyHorizon: 0xc7dbe4, fogColor: 0xbfd3de, fogDensity: 0.0075,
    hemiSky: 0xe8f3f7, hemiGround: 0x5d7f8f, hemiInt: 1.35,
    sunColor: 0xfff1d0, sunInt: 1.9, sunElevation: 0.6,
    mountainTint: 0x8aa3b5, night: false, snowTint: 0xeff6fa
};
const AMBIENCE_EXTREME = {
    skyTop: 0x6c86a8, skyHorizon: 0xb9c7d8, fogColor: 0xb4c3d4, fogDensity: 0.0095,
    hemiSky: 0xe3ecf7, hemiGround: 0x5a6f8a, hemiInt: 1.4,
    sunColor: 0xdfe9f7, sunInt: 1.5, sunElevation: 0.5,
    mountainTint: 0x7d8ea6, night: false, snowTint: 0xeaf1f9
};

export const TRACKS = {
    beginner: {
        id: 'beginner', name: 'Piste Débutant', icon: '🟢', color: '#34d399', stars: 1,
        subtitle: 'Large, dégagée et facile à maîtriser',
        description: 'Une grande piste bleue pour prendre ses marques : peu d\'obstacles, des portes généreuses.',
        unlock: { type: 'free' },
        lengthM: 800, seed: 1101,
        halfWidth: 22, grade: 0.16, roll: 0.35, curveAmp: 0, curveWl: 300,
        speedMinMul: 1.0, speedMaxMul: 0.84, slopeAccel: 0.85,
        gateSpacing: 38, gateOffset: [1.5, 4.5], gateWidth: 6.8, laneHalf: 4.4,
        obstaclesPer100m: 3.0, rockShare: 0.25, treeScale: [0.85, 1.25],
        specials: { ramps: 0.30, bumps: 0.14, deepSnow: 0.08, narrow: 0, ravine: 0, barrier: 0.10, sign: 0.14 },
        coinRate: 0.55, decorSpacing: 7.5, forestEdge: 0.5,
        decor: { flagStep: 28, flagColors: [0xef4444,0xfacc15,0x22c55e,0x3b82f6], mounds: 5, cabin: 0.5, snowman: 0.9, logs: 0.4, birch: 1.5, spectators: 0.35, archColor: 0x22c55e },
        scoreMult: 1.0,
        reward: { finishCoins: 20, finishXp: 40 },
        ambience: WEATHER_PRESETS.sunny, stars_bg: false
    },
    alpine: {
        id: 'alpine', name: 'Piste Alpine', icon: '🔵', color: '#60a5fa', stars: 2,
        subtitle: 'Relief marqué, obstacles variés',
        description: 'Une piste rouge aux ondulations marquées : bosses, tremplins, rochers et premiers ravins signalés.',
        unlock: { type: 'level', value: 2 },
        lengthM: 1000, seed: 2202,
        halfWidth: 19, grade: 0.22, roll: 1.4, curveAmp: 3, curveWl: 340,
        speedMinMul: 1.0, speedMaxMul: 1.0, slopeAccel: 1.0,
        gateSpacing: 36, gateOffset: [1.5, 3.6], gateWidth: 6.2, laneHalf: 3.5,
        obstaclesPer100m: 6.0, rockShare: 0.4, treeScale: [0.85, 1.35],
        specials: { ramps: 0.42, bumps: 0.35, deepSnow: 0.22, narrow: 0.08, ravine: 0.2, barrier: 0.2, sign: 0.22 },
        coinRate: 0.6, decorSpacing: 6.0, forestEdge: 0.7,
        decor: { flagStep: 34, flagColors: [0x3b82f6,0xef4444,0xffffff], mounds: 4, cabin: 0.4, snowman: 0.4, logs: 0.4, pylon: 0.35, birch: 1.0, spectators: 0.3, archColor: 0x3b82f6 },
        scoreMult: 1.1,
        reward: { finishCoins: 35, finishXp: 60 },
        ambience: AMBIENCE_ALPINE, stars_bg: false
    },
    forest: {
        id: 'forest', name: 'Forêt Enneigée', icon: '🌲', color: '#4ade80', stars: 3,
        subtitle: 'Passages sinueux entre les sapins',
        description: 'La piste serpente entre les sapins. Suivez les virages, évitez les troncs et les passages resserrés.',
        unlock: { type: 'level', value: 4 },
        lengthM: 1100, seed: 3303,
        halfWidth: 16, grade: 0.20, roll: 1.0, curveAmp: 6, curveWl: 260,
        speedMinMul: 1.0, speedMaxMul: 0.86, slopeAccel: 0.95,
        gateSpacing: 34, gateOffset: [1.0, 2.4], gateWidth: 5.8, laneHalf: 3.0,
        obstaclesPer100m: 9.0, rockShare: 0.15, treeScale: [0.9, 1.5],
        specials: { ramps: 0.14, bumps: 0.12, deepSnow: 0.2, narrow: 0.22, ravine: 0, barrier: 0.04, sign: 0.6 },
        coinRate: 0.6, decorSpacing: 3.4, forestEdge: 1.0,
        decor: { flagStep: 0, mounds: 4, cabin: 0.5, snowman: 0.5, logs: 1.2, birch: 4, spectators: 0.1, archColor: 0x16a34a },
        scoreMult: 1.2,
        reward: { finishCoins: 45, finishXp: 75 },
        ambience: AMBIENCE_FOREST, stars_bg: false
    },
    extreme: {
        id: 'extreme', name: 'Piste Extrême', icon: '⚫', color: '#f87171', stars: 4,
        subtitle: 'Pente raide, vitesse élevée, dangers rapprochés',
        description: 'La noire : pente vertigineuse, passages étroits, ravins et rochers à haute vitesse.',
        unlock: { type: 'level', value: 6 },
        lengthM: 1000, seed: 4404,
        halfWidth: 14, grade: 0.36, roll: 2.0, curveAmp: 3, curveWl: 300,
        speedMinMul: 1.15, speedMaxMul: 1.04, slopeAccel: 1.5,
        gateSpacing: 36, gateOffset: [1.8, 3.4], gateWidth: 5.6, laneHalf: 2.7,
        obstaclesPer100m: 11.0, rockShare: 0.45, treeScale: [0.9, 1.4],
        specials: { ramps: 0.5, bumps: 0.5, deepSnow: 0.28, narrow: 0.22, ravine: 0.32, barrier: 0.3, sign: 0.3 },
        coinRate: 0.7, decorSpacing: 5.0, forestEdge: 0.6,
        decor: { flagStep: 40, flagColors: [0x111827,0xef4444,0xffffff], mounds: 2, spire: 3.5, pylon: 0.2, spectators: 0.05, archColor: 0xef4444 },
        scoreMult: 1.4,
        reward: { finishCoins: 70, finishXp: 100 },
        ambience: AMBIENCE_EXTREME, stars_bg: false
    },
    night: {
        id: 'night', name: 'Piste Nocturne', icon: '🌙', color: '#a78bfa', stars: 3,
        subtitle: 'Visibilité réduite, piste éclairée',
        description: 'Descente de nuit sous les étoiles : suivez les lampadaires, la lampe frontale éclaire le chemin.',
        unlock: { type: 'level', value: 8 },
        lengthM: 1000, seed: 5505,
        halfWidth: 17, grade: 0.24, roll: 1.2, curveAmp: 4, curveWl: 320,
        speedMinMul: 1.0, speedMaxMul: 0.94, slopeAccel: 1.0,
        gateSpacing: 36, gateOffset: [1.5, 3.4], gateWidth: 6.0, laneHalf: 3.2,
        obstaclesPer100m: 7.0, rockShare: 0.3, treeScale: [0.85, 1.35],
        specials: { ramps: 0.3, bumps: 0.25, deepSnow: 0.2, narrow: 0.12, ravine: 0.15, barrier: 0.25, sign: 0.3 },
        coinRate: 0.65, decorSpacing: 5.5, forestEdge: 0.8,
        decor: { flagStep: 0, lanternStep: 20, lanternColors: [0xfde68a,0xf0abfc,0x7dd3fc], mounds: 4, cabin: 0.5, snowman: 0.5, pylon: 0.3, birch: 1.0, spectators: 0.3, archColor: 0xa78bfa },
        scoreMult: 1.25, lamps: true,
        reward: { finishCoins: 60, finishXp: 90 },
        ambience: WEATHER_PRESETS.night, stars_bg: true
    }
};

export const TRACK_ORDER = ['beginner', 'alpine', 'forest', 'extreme', 'night'];

export function getTrack(id) {
    return TRACKS[id] || TRACKS.beginner;
}

/** Ambiance finale : réglage météo du joueur ("auto" = ambiance propre à la piste). */
export function resolveAmbience(track, weatherKey) {
    if (weatherKey && weatherKey !== 'auto' && WEATHER_PRESETS[weatherKey]) return WEATHER_PRESETS[weatherKey];
    return track.ambience;
}

export function slopeDegrees(track) {
    return Math.round(Math.atan(track.grade) * 180 / Math.PI);
}

// ---------------------------------------------------------------------------
// Modèle du terrain (hors reliefs ajoutés par les obstacles : bosses, ravins, tremplins)
// ---------------------------------------------------------------------------
export class TrackTerrain {
    constructor(track, seed) {
        this.track = track;
        this.seed = seed | 0;
        this.halfW = track.halfWidth;
        this.grade = track.grade;
        this.phase = (rand01(this.seed, 11) * Math.PI * 2);
        this.phase2 = (rand01(this.seed, 12) * Math.PI * 2);
        // Limite dure de la zone jouable : bord de piste + bande de hors-piste (neige profonde).
        this.offPisteWidth = 4;
        this.boundaryHalf = this.halfW + this.offPisteWidth;
    }

    /** Amplitude des virages, progressive au départ pour que les 150 premiers mètres soient droits. */
    curveRamp(z) { return clamp((-z - 40) / 150, 0, 1); }

    centerX(z) {
        const t = this.track;
        if (!t.curveAmp) return 0;
        const k = this.curveRamp(z);
        const a = t.curveAmp * k;
        return a * (Math.sin(z * Math.PI * 2 / t.curveWl + this.phase)
                  + 0.2 * Math.sin(z * Math.PI * 2 / (t.curveWl * 0.5) + this.phase2));
    }

    /** Pente locale du tracé central dx/dz (sert à vérifier que la piste reste jouable). */
    centerSlope(z) {
        const e = 1.0;
        return (this.centerX(z - e) - this.centerX(z + e)) / (2 * e);
    }

    pathHeight(z) {
        return this.grade * z + this.track.roll * Math.sin(z * 0.023 + this.phase);
    }

    gradeAt(z) {
        // Pente descendante positive (dy/dz négatif quand on avance vers -z).
        return this.grade + this.track.roll * 0.023 * Math.cos(z * 0.023 + this.phase);
    }

    baseHeight(x, z) {
        const dx = x - this.centerX(z);
        const d = Math.max(0, Math.abs(dx) - this.halfW);
        let h = this.pathHeight(z);
        if (d > 0) {
            const side = dx >= 0 ? 1 : -1;
            const k = 0.8 + 0.6 * noise2(z * 0.006, side * 3.1, this.seed);
            // Talus : courbe douce près de la piste, puis pente régulière (évite les falaises vues par la tranche au loin)
            const dn = Math.min(d, 45);
            const bank = k * (0.0035 * dn * dn + 0.26 * Math.max(0, d - 45));
            const ridge = Math.min(d, 60) * 0.2 * (noise2(x * 0.022, z * 0.022, this.seed + 7) - 0.5) * 2 * smoothstep(0, 30, d);
            h += bank + ridge;
        }
        return h;
    }

    /** 0 = sur la piste, 1 = bien en dehors. Sert au rendu (couleur) et au ralentissement hors-piste. */
    offPiste(x, z) {
        const d = Math.abs(x - this.centerX(z)) - this.halfW;
        return smoothstep(-1.0, 1.2, d);
    }
}
