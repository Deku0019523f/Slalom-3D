// Modes de jeu : règles, conditions de fin, défis de course prédéfinis et état d'une course ("run").
// Module sans dépendance au DOM ni à Three.js.
import { TRACKS } from './tracks.js';
import { DIFFICULTY_PRESETS } from './settings.js';

export const MODES = {
    endless: {
        id: 'endless', icon: '♾️', name: 'Course infinie',
        desc: 'Descendez le plus loin possible. La piste accélère et se resserre ; la course s\'arrête quand vous n\'avez plus de vies.',
        rules: 'Vies limitées · difficulté croissante · record de score et de distance par piste',
        scoring: true, gates: true
    },
    timetrial: {
        id: 'timetrial', icon: '⏱️', name: 'Contre-la-montre',
        desc: 'Terminez la piste le plus vite possible. Le parcours est identique à chaque essai pour comparer vos temps.',
        rules: 'Portes manquées : +1,5 s · 5 chutes maximum · médailles or / argent / bronze',
        scoring: true, gates: true
    },
    trial: {
        id: 'trial', icon: '🎯', name: 'Défis',
        desc: 'Relevez des épreuves précises : objectif, piste et limites imposés. Récompense à la première réussite.',
        rules: 'Chaque défi a son objectif et ses conditions d\'échec',
        scoring: true, gates: true
    },
    free: {
        id: 'free', icon: '🧭', name: 'Mode libre',
        desc: 'Explorez la piste sans pression : pas de score, pas de portes, pas de game over. Une chute vous remet simplement sur pied.',
        rules: 'Aucun score · aucun gain · idéal pour s\'entraîner',
        scoring: false, gates: false
    }
};
export const MODE_ORDER = ['endless', 'timetrial', 'trial', 'free'];

// ---------------------------------------------------------------------------
// Défis de course
// metric : gates | coins | combo | jumps | air (secondes cumulées) | speed (km/h) | perfect | dist (m) | finish
// ---------------------------------------------------------------------------
export const TRIALS = [
    { id: 'trial_first_turns', icon: '🚩', name: 'Premiers virages', track: 'beginner', metric: 'gates', target: 10, maxDistM: 320,
      desc: 'Franchissez 10 portes avant d\'avoir parcouru 320 m.', reward: { coins: 40, xp: 50 } },
    { id: 'trial_coins', icon: '🪙', name: 'Chasseur de pièces', track: 'alpine', metric: 'coins', target: 25, maxDistM: 650,
      desc: 'Ramassez 25 pièces avant 650 m.', reward: { coins: 50, xp: 60 } },
    { id: 'trial_air', icon: '🦅', name: 'Envolée', track: 'alpine', metric: 'air', target: 4, maxDistM: 1000,
      desc: 'Cumulez 4 secondes de vol sur les tremplins et les bosses avant 1 000 m.', reward: { coins: 60, xp: 70 } },
    { id: 'trial_clean', icon: '🔥', name: 'Sans faute', track: 'forest', metric: 'combo', target: 13, maxDistM: 800,
      desc: 'Enchaînez 12 portes d\'affilée sans en manquer une (combo x13).', reward: { coins: 70, xp: 80 } },
    { id: 'trial_precision', icon: '🎯', name: 'Précision', track: 'forest', metric: 'perfect', target: 6, maxDistM: 800,
      desc: 'Réussissez 6 portes parfaites en passant près de leur centre.', reward: { coins: 70, xp: 80 } },
    { id: 'trial_speed', icon: '⚡', name: 'Vitesse pure', track: 'extreme', metric: 'speed', target: 150, maxDistM: 1000, lives: 2,
      desc: 'Atteignez 150 km/h avant 1 000 m, avec seulement 2 vies.', reward: { coins: 90, xp: 100 } },
    { id: 'trial_night', icon: '🌙', name: 'Chrono nocturne', track: 'night', metric: 'finish', target: 1, finish: true, timeLimit: 75,
      desc: 'Terminez la piste nocturne (1 000 m) en moins de 75 secondes.', reward: { coins: 90, xp: 100 } },
    { id: 'trial_survivor', icon: '💀', name: 'Survivant', track: 'extreme', metric: 'dist', target: 1200, lives: 1,
      desc: 'Parcourez 1 200 m sur la piste extrême avec une seule vie.', reward: { coins: 120, xp: 120 } }
];

export function getTrial(id) { return TRIALS.find(t => t.id === id) || TRIALS[0]; }

// ---------------------------------------------------------------------------
// État d'une course
// ---------------------------------------------------------------------------
export function livesFor(mode, diffKey, trial) {
    if (mode === 'free') return Infinity;
    if (mode === 'timetrial') return 5;
    if (mode === 'trial' && trial && trial.lives) return trial.lives;
    return (DIFFICULTY_PRESETS[diffKey] || DIFFICULTY_PRESETS.normal).lives;
}

/** Longueur de piste (m affichés) imposée par le mode, ou null pour une piste sans fin. */
export function courseLengthM(mode, track, trial) {
    if (mode === 'timetrial') return track.lengthM;
    if (mode === 'trial' && trial && trial.finish) return track.lengthM;
    return null;
}

export function courseSeed(mode, track, trial) {
    if (mode === 'endless') return (Math.random() * 2 ** 31) | 0;
    if (mode === 'free') return track.seed + 17;
    if (mode === 'trial' && trial) {
        let h = 0;
        for (const ch of trial.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
        return (track.seed + h) | 0;
    }
    return track.seed;
}

export function createRun({ mode, trackId, trialId, difficulty, startLevel }) {
    const track = TRACKS[trackId] || TRACKS.beginner;
    const trial = mode === 'trial' ? getTrial(trialId) : null;
    const lives = livesFor(mode, difficulty, trial);
    return {
        mode, trackId: track.id, trialId: trial ? trial.id : null, trial,
        difficulty, startLevel,
        score: 0, combo: 1, maxCombo: 1, gates: 0, perfect: 0, missed: 0,
        distM: 0, time: 0, penalties: 0, finalTime: 0,
        maxSpeedKmh: 0, coins: 0, jumps: 0, airTotal: 0, bestAir: 0,
        falls: 0, hits: 0, lives, maxLives: lives,
        crossedFinish: false, result: '', reason: '', finished: false, trialSuccess: false,
        trophiesEarned: [], trialMetricValue: NaN
    };
}

/** Valeur actuelle de l'objectif d'un défi. */
export function trialValue(run) {
    const t = run.trial;
    if (!t) return 0;
    switch (t.metric) {
        case 'gates': return run.gates;
        case 'coins': return run.coins;
        case 'combo': return run.maxCombo;
        case 'jumps': return run.jumps;
        case 'air': return Math.round(run.airTotal * 10) / 10;
        case 'speed': return run.maxSpeedKmh;
        case 'perfect': return run.perfect;
        case 'dist': return Math.floor(run.distM);
        case 'finish': return run.crossedFinish ? 1 : 0;
        default: return 0;
    }
}

/**
 * Évalue les conditions de fin. Retourne null si la course continue,
 * sinon { result: 'crash' | 'finish' | 'success' | 'fail', reason }.
 */
export function evaluateEnd(run) {
    switch (run.mode) {
        case 'free':
            return null;
        case 'endless':
            if (run.lives <= 0) return { result: 'crash', reason: 'Plus de vies : la descente s\'arrête ici.' };
            return null;
        case 'timetrial':
            if (run.crossedFinish) return { result: 'finish', reason: 'Ligne d\'arrivée franchie !' };
            if (run.lives <= 0) return { result: 'fail', reason: 'Trop de chutes : course abandonnée.' };
            return null;
        case 'trial': {
            const t = run.trial;
            const v = trialValue(run);
            if (t.finish) {
                if (run.crossedFinish) {
                    return run.time + run.penalties <= t.timeLimit
                        ? { result: 'success', reason: 'Défi réussi !' }
                        : { result: 'fail', reason: `Arrivée trop tardive (limite ${t.timeLimit} s).` };
                }
                if (run.time + run.penalties > t.timeLimit) return { result: 'fail', reason: `Temps écoulé (${t.timeLimit} s).` };
            } else if (v >= t.target) {
                return { result: 'success', reason: 'Objectif atteint !' };
            }
            if (run.lives <= 0) return { result: 'fail', reason: 'Plus de vies.' };
            if (t.maxDistM && run.distM >= t.maxDistM) return { result: 'fail', reason: `Objectif manqué avant ${t.maxDistM} m.` };
            return null;
        }
        default:
            return null;
    }
}
