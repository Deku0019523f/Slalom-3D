// Progression persistante : niveaux, trophées, missions quotidiennes, records, récompenses.
// Toutes les récompenses découlent d'actions mesurées pendant une course (aucun gain gratuit).
// Module sans dépendance au DOM : testable sous Node.
import { TRACKS, mulberry32, hash32, clamp } from './tracks.js';
import { syncUnlocks } from './characters.js';

export const MAX_LEVEL = 60;
const MAX_HISTORY = 30;

// ---------------------------------------------------------------------------
// Niveaux
// ---------------------------------------------------------------------------
export function xpForNext(level) { return 120 + 40 * (level - 1); }

export function levelFromXp(xp) {
    let level = 1, rest = Math.max(0, Math.floor(xp));
    while (level < MAX_LEVEL && rest >= xpForNext(level)) { rest -= xpForNext(level); level++; }
    const need = level >= MAX_LEVEL ? 0 : xpForNext(level);
    return { level, into: rest, need, ratio: need ? rest / need : 1 };
}

export function levelOf(save) { return levelFromXp(save.progress.xp).level; }

// ---------------------------------------------------------------------------
// Trophées (défis permanents) : les 8 d'origine + 6 nouveaux
// ---------------------------------------------------------------------------
export const TROPHIES = [
    { id: 'gates_10', icon: '🚩', title: 'Slalomeur Agile', desc: 'Franchir 10 portes en une seule descente', target: 10, type: 'run_gates', reward: { coins: 20, xp: 30 } },
    { id: 'combo_8', icon: '🔥', title: 'Série Parfaite', desc: 'Atteindre un multiplicateur de combo x8', target: 8, type: 'run_combo', reward: { coins: 30, xp: 40 } },
    { id: 'speed_130', icon: '⚡', title: 'Mur du Son Blanc', desc: 'Atteindre une vitesse de 130 km/h', target: 130, type: 'run_speed', reward: { coins: 30, xp: 40 } },
    { id: 'dist_1000', icon: '🏔️', title: 'Avalanche Humaine', desc: 'Parcourir 1 000 m en une seule course', target: 1000, type: 'run_dist', reward: { coins: 40, xp: 50 } },
    { id: 'score_5000', icon: '💎', title: 'Maître de la Piste', desc: 'Obtenir un score de 5 000 points en une partie', target: 5000, type: 'run_score', reward: { coins: 60, xp: 70 } },
    { id: 'extreme_15', icon: '💀', title: 'Casse-Cou Extrême', desc: 'Franchir 15 portes en difficulté Extrême', target: 15, type: 'extreme_gates', reward: { coins: 60, xp: 70 } },
    { id: 'total_gates_100', icon: '🏅', title: 'Vétéran des Portes', desc: 'Franchir un total cumulé de 100 portes', target: 100, type: 'total_gates', reward: { coins: 50, xp: 60 } },
    { id: 'total_dist_5000', icon: '🌍', title: 'Explorateur Alpin', desc: 'Skier 5 000 m cumulés sur toutes vos parties', target: 5000, type: 'total_dist', reward: { coins: 50, xp: 60 } },
    { id: 'perfect_5', icon: '🎯', title: 'Précision Chirurgicale', desc: 'Réussir 5 portes parfaites (au centre) en une course', target: 5, type: 'run_perfect', reward: { coins: 30, xp: 40 } },
    { id: 'jumps_3', icon: '🦅', title: 'Acrobate', desc: 'Réaliser 3 sauts en une course', target: 3, type: 'run_jumps', reward: { coins: 25, xp: 35 } },
    { id: 'air_1_5', icon: '☁️', title: 'Oiseau des Neiges', desc: 'Rester 1,5 s en l\'air sur un seul saut', target: 15, type: 'run_air', reward: { coins: 40, xp: 50 } },
    { id: 'coins_100', icon: '🪙', title: 'Chasseur d\'Or', desc: 'Ramasser 100 pièces au total', target: 100, type: 'total_coins', reward: { coins: 30, xp: 40 } },
    { id: 'finish_1', icon: '🏁', title: 'Ligne d\'Arrivée', desc: 'Terminer un contre-la-montre', target: 1, type: 'total_finish', reward: { coins: 30, xp: 50 } },
    { id: 'trials_3', icon: '🎖️', title: 'Relève-Défis', desc: 'Réussir 3 défis de course', target: 3, type: 'total_trials', reward: { coins: 60, xp: 80 } }
];

export function getTrophy(id) { return TROPHIES.find(t => t.id === id) || null; }
export function trophyTitle(id) { const t = getTrophy(id); return t ? t.title : id; }

/** Valeur courante d'un trophée. `run` peut être null (affichage hors course : meilleurs cumulés). */
export function trophyValue(t, run, save) {
    const p = save.progress;
    const r = run || {};
    switch (t.type) {
        case 'run_gates': return r.gates || 0;
        case 'run_combo': return run ? r.maxCombo || 1 : p.maxCombo;
        case 'run_speed': return run ? r.maxSpeedKmh || 0 : p.maxSpeedKmh;
        case 'run_dist': return Math.floor(r.distM || 0);
        case 'run_score': return Math.floor(r.score || 0);
        case 'extreme_gates': return r.difficulty === 'extreme' ? (r.gates || 0) : 0;
        case 'run_perfect': return r.perfect || 0;
        case 'run_jumps': return r.jumps || 0;
        case 'run_air': return Math.floor((run ? r.bestAir || 0 : p.maxAirTime) * 10);
        case 'total_gates': return p.totalGates + (r.gates || 0);
        case 'total_dist': return Math.floor(p.totalDist + (r.distM || 0));
        case 'total_coins': return p.totalCoinsCollected + (r.coins || 0);
        case 'total_finish': return p.totalFinishes + (r.finished ? 1 : 0);
        case 'total_trials': return p.totalTrials + (r.trialSuccess ? 1 : 0);
        default: return 0;
    }
}

/**
 * Vérifie les trophées pendant ou après une course. Attribue immédiatement la récompense.
 * (le mode libre ne compte pas : il n'a ni score ni objectifs)
 */
export function checkTrophies(save, run) {
    if (!run || run.mode === 'free') return [];
    const fresh = [];
    for (const t of TROPHIES) {
        if (save.trophies[t.id]) continue;
        if (trophyValue(t, run, save) >= t.target) {
            save.trophies[t.id] = { unlockedAt: Date.now() };
            save.progress.coins += t.reward.coins;
            save.progress.xp += t.reward.xp;
            fresh.push(t);
        }
    }
    return fresh;
}

// ---------------------------------------------------------------------------
// Missions quotidiennes
// ---------------------------------------------------------------------------
export function dayKey(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const MISSION_POOL = [
    { id: 'm_gates', metric: 'gates', agg: 'sum', targets: [15, 25, 40], text: (n) => `Franchir ${n} portes` },
    { id: 'm_coins', metric: 'coins', agg: 'sum', targets: [10, 20, 35], text: (n) => `Ramasser ${n} pièces` },
    { id: 'm_dist', metric: 'distM', agg: 'sum', targets: [1500, 2500, 4000], text: (n) => `Parcourir ${n} m` },
    { id: 'm_speed', metric: 'maxSpeedKmh', agg: 'max', targets: [90, 110, 130], text: (n) => `Atteindre ${n} km/h` },
    { id: 'm_jumps', metric: 'jumps', agg: 'sum', targets: [3, 6, 10], text: (n) => `Réaliser ${n} sauts` },
    { id: 'm_combo', metric: 'maxCombo', agg: 'max', targets: [5, 8, 12], text: (n) => `Atteindre un combo x${n}` },
    { id: 'm_perfect', metric: 'perfect', agg: 'sum', targets: [4, 8, 12], text: (n) => `Réussir ${n} portes parfaites` },
    { id: 'm_score', metric: 'score', agg: 'max', targets: [1500, 3000, 5000], text: (n) => `Marquer ${n} points en une course` },
    { id: 'm_finish', metric: 'finishes', agg: 'sum', targets: [1, 2, 3], text: (n) => `Terminer ${n} contre-la-montre` },
    { id: 'm_clean', metric: 'cleanDist', agg: 'max', targets: [400, 700, 1000], text: (n) => `Skier ${n} m sans chute` }
];
const MISSION_REWARDS = [{ coins: 20, xp: 40 }, { coins: 35, xp: 60 }, { coins: 50, xp: 90 }];

export function missionDef(id) { return MISSION_POOL.find(m => m.id === id) || null; }

export function missionReward(m) {
    const def = missionDef(m.id);
    if (!def) return { coins: 0, xp: 0 };
    const idx = Math.max(0, def.targets.indexOf(m.target));
    return MISSION_REWARDS[Math.min(idx, 2)];
}

/** Garantit 3 missions pour la date donnée (tirage déterministe par jour, difficulté selon le niveau). */
export function ensureMissions(save, date = new Date()) {
    const day = dayKey(date);
    if (save.missions.day === day && save.missions.list.length === 3) return false;
    let h = 0;
    for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) | 0;
    const rng = mulberry32(hash32(h, 4242));
    const pool = MISSION_POOL.slice();
    const lvl = levelOf(save);
    const base = lvl >= 12 ? 2 : lvl >= 5 ? 1 : 0;
    const list = [];
    while (list.length < 3 && pool.length) {
        const def = pool.splice(Math.floor(rng() * pool.length), 1)[0];
        const idx = clamp(base + (rng() < 0.3 ? 1 : 0) - (rng() < 0.2 ? 1 : 0), 0, 2);
        list.push({ id: def.id, target: def.targets[idx], progress: 0, done: false });
    }
    save.missions = { day, list };
    return true;
}

function runMetric(metric, run) {
    switch (metric) {
        case 'finishes': return run.finished ? 1 : 0;
        case 'cleanDist': return run.falls === 0 ? Math.floor(run.distM) : 0;
        default: return Math.floor(run[metric] || 0);
    }
}

/** Met à jour les missions avec une course terminée ; retourne celles qui viennent d'être accomplies. */
export function updateMissions(save, run) {
    ensureMissions(save);
    const done = [];
    if (run.mode === 'free') return done;
    for (const m of save.missions.list) {
        if (m.done) continue;
        const def = missionDef(m.id);
        if (!def) continue;
        const v = runMetric(def.metric, run);
        m.progress = def.agg === 'sum' ? Math.min(m.target, m.progress + v) : Math.min(m.target, Math.max(m.progress, v));
        if (m.progress >= m.target) {
            m.done = true;
            const r = missionReward(m);
            save.progress.coins += r.coins;
            save.progress.xp += r.xp;
            done.push({ ...m, text: def.text(m.target), reward: r });
        }
    }
    return done;
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------
export function bestKey(mode, trackId) { return `${mode}:${trackId}`; }

export function getBest(save, mode, trackId) {
    return save.bests[bestKey(mode, trackId)] || { score: 0, dist: 0, gates: 0, time: null };
}

// Temps de référence (secondes) pour les médailles du contre-la-montre, par piste.
export const MEDAL_TIMES = {
    beginner: { gold: 36, silver: 42, bronze: 50 },
    alpine: { gold: 42, silver: 49, bronze: 58 },
    forest: { gold: 48, silver: 56, bronze: 66 },
    extreme: { gold: 36, silver: 42, bronze: 50 },
    night: { gold: 44, silver: 51, bronze: 60 }
};

export function medalFor(trackId, time) {
    const m = MEDAL_TIMES[trackId];
    if (!m || time == null) return null;
    if (time <= m.gold) return 'gold';
    if (time <= m.silver) return 'silver';
    if (time <= m.bronze) return 'bronze';
    return null;
}

// ---------------------------------------------------------------------------
// Fin de course : applique toutes les conséquences et retourne un résumé affichable.
// ---------------------------------------------------------------------------
export function computeXp(run, finishXp) {
    const xp = Math.floor(run.distM / 25) + run.gates * 4 + run.perfect * 3 + Math.floor(run.airTotal * 5) + run.coins + finishXp;
    return Math.max(0, Math.min(400, xp));
}

export function applyRunResult(save, run, now = Date.now()) {
    const p = save.progress;
    const track = TRACKS[run.trackId] || TRACKS.beginner;
    const summary = {
        xp: 0, coins: 0, coinsPickups: run.coins, newRecord: false, medal: null,
        levelBefore: run.startLevel || levelOf(save), levelAfter: 1,
        trophies: [], missions: [], unlocks: [], trialFirstClear: false, trialReward: null, finishBonus: 0
    };

    // Statistiques cumulées (la distance et le temps comptent même en mode libre)
    p.totalDist += Math.floor(run.distM);
    p.totalTime += run.time;

    if (run.mode === 'free') {
        summary.levelAfter = levelOf(save);
        return summary;
    }

    const success = run.result === 'finish' || run.result === 'success';
    run.finished = run.result === 'finish' || (run.mode === 'timetrial' && success);
    run.trialSuccess = run.mode === 'trial' && run.result === 'success';

    p.totalGames += 1;
    p.totalScore += Math.floor(run.score);
    p.totalGates += run.gates;
    p.totalPerfect += run.perfect;
    p.totalCoinsCollected += run.coins;
    p.totalJumps += run.jumps;
    p.maxSpeedKmh = Math.max(p.maxSpeedKmh, run.maxSpeedKmh);
    p.maxCombo = Math.max(p.maxCombo, run.maxCombo);
    p.maxAirTime = Math.max(p.maxAirTime, run.bestAir);
    if (run.finished) p.totalFinishes += 1;

    // Records
    const key = bestKey(run.mode, run.trackId);
    const best = save.bests[key] || { score: 0, dist: 0, gates: 0, time: null };
    if (run.mode === 'endless') {
        if (run.score > best.score) { best.score = Math.floor(run.score); summary.newRecord = true; }
        if (run.distM > best.dist) best.dist = Math.floor(run.distM);
        if (run.gates > best.gates) best.gates = run.gates;
    } else if (run.mode === 'timetrial' && run.finished) {
        if (best.time == null || run.finalTime < best.time) { best.time = Math.round(run.finalTime * 100) / 100; summary.newRecord = true; }
        if (run.score > best.score) best.score = Math.floor(run.score);
        summary.medal = medalFor(run.trackId, run.finalTime);
    } else if (run.mode === 'trial') {
        if (run.score > best.score) best.score = Math.floor(run.score);
    }
    save.bests[key] = best;
    if (run.score > p.bestScore) p.bestScore = Math.floor(run.score);

    // Gains d'expérience et de pièces
    let finishXp = 0;
    if (run.finished && run.mode === 'timetrial') {
        finishXp = track.reward.finishXp;
        summary.finishBonus = track.reward.finishCoins + (summary.medal === 'gold' ? 25 : summary.medal === 'silver' ? 12 : summary.medal === 'bronze' ? 5 : 0);
    }
    summary.xp = computeXp(run, finishXp);
    summary.coins = run.coins + summary.finishBonus;
    p.xp += summary.xp;
    p.coins += summary.coins;

    // Défi de course : récompense unique à la première réussite
    if (run.mode === 'trial') {
        const prev = save.trials[run.trialId] || { done: false, best: null, at: 0 };
        if (run.trialSuccess) {
            if (!prev.done && run.trial && run.trial.reward) {
                summary.trialFirstClear = true;
                summary.trialReward = run.trial.reward;
                p.coins += run.trial.reward.coins;
                p.xp += run.trial.reward.xp;
                p.totalTrials += 1;
            }
            prev.done = true;
            prev.at = now;
        }
        const metric = run.trialMetricValue;
        if (Number.isFinite(metric) && (prev.best == null || metric > prev.best)) prev.best = metric;
        save.trials[run.trialId] = prev;
    }

    // Trophées et missions (après la mise à jour des cumuls : on évite de compter deux fois)
    // Les cumuls (totalGates...) viennent d'être mis à jour ; on évalue donc avec une course "à zéro" pour les types cumulés.
    const snapshot = { ...run, gates: 0, distM: 0, coins: 0, finished: false, trialSuccess: false };
    const live = { ...run };
    for (const t of TROPHIES) {
        if (save.trophies[t.id]) continue;
        const cumulative = t.type.startsWith('total_');
        const v = cumulative ? trophyValue(t, snapshot, save) : trophyValue(t, live, save);
        if (v >= t.target) {
            save.trophies[t.id] = { unlockedAt: now };
            p.coins += t.reward.coins;
            p.xp += t.reward.xp;
            summary.trophies.push(t);
        }
    }
    summary.trophies = (run.trophiesEarned || []).concat(summary.trophies);
    summary.missions = updateMissions(save, run);

    // Historique
    save.history.unshift({
        player: save.settings.playerName, mode: run.mode, track: run.trackId,
        score: Math.floor(run.score), gates: run.gates, combo: run.maxCombo, dist: Math.floor(run.distM),
        speed: run.maxSpeedKmh, time: Math.round((run.finalTime || run.time) * 10) / 10, coins: run.coins,
        difficulty: run.difficulty, date: now, dateLabel: '', result: run.result
    });
    if (save.history.length > MAX_HISTORY) save.history.length = MAX_HISTORY;

    const lv = levelFromXp(p.xp);
    summary.levelAfter = lv.level;
    summary.unlocks = syncUnlocks(save, lv.level);
    // Un trophée peut débloquer un équipement : on resynchronise
    summary.unlocks = summary.unlocks.concat(syncUnlocks(save, lv.level));
    return summary;
}

/** Piste accessible ? (niveau requis) */
export function isTrackUnlocked(save, trackId) {
    const t = TRACKS[trackId];
    if (!t) return false;
    if (t.unlock.type === 'free') return true;
    return levelOf(save) >= t.unlock.value;
}
