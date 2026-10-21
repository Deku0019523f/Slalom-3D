// Tests de logique pure (sans navigateur) : sauvegarde, progression, modes, équipements.
// Exécution : node tests/logic.test.mjs
import assert from 'node:assert/strict';

// Faux localStorage injecté AVANT l'import de storage.js (le module sonde window.localStorage)
const store = new Map();
globalThis.window = {
    localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); }
    },
    addEventListener() {}
};
globalThis.document = { addEventListener() {}, visibilityState: 'visible' };

const S = await import('../js/storage.js');
const P = await import('../js/progression.js');
const M = await import('../js/modes.js');
const C = await import('../js/characters.js');
const { TRACKS, TRACK_ORDER } = await import('../js/tracks.js');
const { DIFFICULTY_PRESETS, sanitizeSettings } = await import('../js/settings.js');

let n = 0, bad = 0;
function t(name, fn) {
    n++;
    try { fn(); console.log('  ok  ', name); } catch (e) { bad++; console.log('  ÉCHEC', name, '\n       ', e.message); }
}

console.log('Sauvegarde');
t('sauvegarde par défaut valide', () => {
    const s = S.defaultSave();
    assert.equal(s.v, 2);
    assert.equal(s.progress.coins, 0);
    assert.equal(s.loadout.character, 'c_alex');
});
t('données corrompues / hostiles nettoyées', () => {
    const evil = {
        v: 2, settings: { playerName: '<img src=x onerror=alert(1)>', volume: 9999, graphics: 'ultra', sensitivity: 'abc', __proto__: { polluted: 1 } },
        progress: { xp: -50, coins: 'beaucoup', bestScore: 1e30 },
        unlocks: { characters: ['c_yeti', '../../etc', 'x'.repeat(100)] },
        loadout: { character: 'inconnu', outfit: 42 },
        history: [{ score: 'NaN' }, 5, null], bests: { 'foo:bar': { score: 1 } }, trophies: { 'bad id!': {} }
    };
    const s = S.sanitizeSave(evil);
    assert.ok(!/[<>]/.test(s.settings.playerName));
    assert.equal(s.settings.volume, 100);
    assert.equal(s.settings.graphics, 'balanced');
    assert.equal(s.settings.sensitivity, 100);
    assert.equal(s.progress.xp, 0);
    assert.equal(s.progress.coins, 0);
    assert.ok(s.progress.bestScore <= 1e9);
    assert.ok(!s.unlocks.characters.includes('../../etc'));
    assert.equal(({}).polluted, undefined);
    assert.ok(!('foo:bar' in s.bests));
    assert.ok(!('bad id!' in s.trophies));
});
t('JSON invalide : sauvegarde conservée à part et reset propre', () => {
    store.set(S.SAVE_KEY, '{pas du json');
    const s = S.loadSave();
    assert.equal(s.progress.xp, 0);
    assert.equal(store.get(S.SAVE_KEY + '_corrupt'), '{pas du json');
    store.delete(S.SAVE_KEY); store.delete(S.SAVE_KEY + '_corrupt');
});
t('migration depuis la version 1', () => {
    store.clear();
    store.set(S.LEGACY_KEYS.BEST, '4200');
    store.set(S.LEGACY_KEYS.SETTINGS, JSON.stringify({ playerName: 'Zoé', difficulty: 'extreme', suitColor: '#2563eb', snowParticles: false, volume: 30 }));
    store.set(S.LEGACY_KEYS.STATS, JSON.stringify({ totalGames: 12, totalDist: 5000, totalGates: 80, maxSpeedKmh: 140, maxCombo: 9 }));
    store.set(S.LEGACY_KEYS.CHALLENGES, JSON.stringify({ gates_10: { unlockedAt: '2025-01-02T10:00:00Z' } }));
    store.set(S.LEGACY_KEYS.HISTORY, JSON.stringify([{ player: 'Zoé', score: 4200, gates: 20, combo: 9, dist: 900, speed: 140, difficulty: 'Extrême', date: '02/01' }]));
    const s = S.loadSave();
    assert.equal(s.settings.playerName, 'Zoé');
    assert.equal(s.settings.difficulty, 'extreme');
    assert.equal(s.settings.snowIntensity, 0);
    assert.equal(s.loadout.outfit, 'o_blue');
    assert.equal(s.progress.bestScore, 4200);
    assert.equal(s.progress.totalGames, 12);
    assert.ok(s.trophies.gates_10);
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].difficulty, 'extreme');
    assert.equal(s.migrated, true);
    store.clear();
});
t('écriture, relecture et réinitialisation (réglages conservés)', () => {
    const s = S.loadSave();
    s.progress.coins = 123; s.settings.playerName = 'Test';
    S.persistNow();
    assert.equal(JSON.parse(store.get(S.SAVE_KEY)).progress.coins, 123);
    S.resetProgress();
    assert.equal(S.getSave().progress.coins, 0);
    assert.equal(S.getSave().settings.playerName, 'Test');
    assert.equal(JSON.parse(store.get(S.SAVE_KEY)).progress.coins, 0);
});

console.log('Progression');
const fresh = () => { S.resetProgress(); const s = S.getSave(); s.settings = sanitizeSettings({}); return s; };
const mkRun = (over = {}) => ({ ...M.createRun({ mode: 'endless', trackId: 'beginner', difficulty: 'normal', startLevel: 1 }), ...over });

t('courbe de niveaux', () => {
    assert.equal(P.levelFromXp(0).level, 1);
    assert.equal(P.levelFromXp(119).level, 1);
    assert.equal(P.levelFromXp(120).level, 2);
    assert.equal(P.levelFromXp(120 + 160).level, 3);
    assert.equal(P.levelFromXp(1e9).level, P.MAX_LEVEL);
});
t('une course sans action ne rapporte ni pièces ni XP', () => {
    const s = fresh();
    const run = mkRun({ result: 'crash' });
    const sum = P.applyRunResult(s, run);
    assert.equal(sum.xp, 0); assert.equal(sum.coins, 0);
    assert.equal(s.progress.coins, 0); assert.equal(s.progress.xp, 0);
});
t('les récompenses viennent des actions mesurées', () => {
    const s = fresh();
    const run = mkRun({ result: 'crash', distM: 500, gates: 12, perfect: 3, coins: 7, score: 2500, maxCombo: 6, time: 40 });
    const sum = P.applyRunResult(s, run);
    assert.equal(sum.coins, 7);
    assert.ok(sum.xp >= Math.floor(500 / 25) + 12 * 4 + 3 * 3 + 7);
    assert.equal(s.progress.bestScore, 2500);
    assert.equal(s.bests['endless:beginner'].score, 2500);
    assert.ok(sum.newRecord);
    assert.ok(s.trophies.gates_10, 'trophée 10 portes');
    assert.equal(s.history.length, 1);
});
t('le record ne baisse jamais', () => {
    const s = fresh();
    P.applyRunResult(s, mkRun({ result: 'crash', score: 3000, distM: 100 }));
    const sum = P.applyRunResult(s, mkRun({ result: 'crash', score: 100, distM: 10 }));
    assert.equal(s.bests['endless:beginner'].score, 3000);
    assert.ok(!sum.newRecord);
});
t('mode libre : aucun gain ni record, distance cumulée seulement', () => {
    const s = fresh();
    const sum = P.applyRunResult(s, mkRun({ mode: 'free', result: 'crash', distM: 900, coins: 50, gates: 30, score: 9999 }));
    assert.equal(sum.coins, 0); assert.equal(sum.xp, 0);
    assert.equal(s.progress.coins, 0); assert.equal(s.progress.bestScore, 0);
    assert.equal(s.history.length, 0);
    assert.equal(s.progress.totalDist, 900);
});
t('contre-la-montre : temps, médaille, bonus unique par arrivée', () => {
    const s = fresh();
    const run = mkRun({ mode: 'timetrial', result: 'finish', crossedFinish: true, distM: 800, finalTime: 35, time: 35, gates: 10, score: 1000 });
    const sum = P.applyRunResult(s, run);
    assert.equal(sum.medal, 'gold');
    assert.equal(s.bests['timetrial:beginner'].time, 35);
    assert.ok(sum.finishBonus > 0);
    assert.ok(s.trophies.finish_1);
    const sum2 = P.applyRunResult(s, mkRun({ mode: 'timetrial', result: 'finish', crossedFinish: true, distM: 800, finalTime: 40, time: 40 }));
    assert.equal(s.bests['timetrial:beginner'].time, 35, 'un temps plus lent ne remplace pas le record');
    assert.ok(!sum2.newRecord);
});
t('contre-la-montre abandonné : pas de temps enregistré', () => {
    const s = fresh();
    P.applyRunResult(s, mkRun({ mode: 'timetrial', result: 'fail', distM: 300, finalTime: 20, time: 20 }));
    assert.equal(s.bests['timetrial:beginner'].time ?? null, null);
});
t('défi : récompense unique à la première réussite', () => {
    const s = fresh();
    const mk = () => mkRun({ mode: 'trial', trackId: 'beginner', trialId: 'trial_first_turns', trial: M.getTrial('trial_first_turns'), result: 'success', gates: 10, distM: 200 });
    const a = P.applyRunResult(s, mk());
    assert.ok(a.trialFirstClear);
    const coinsAfter = s.progress.coins;
    const b = P.applyRunResult(s, mk());
    assert.ok(!b.trialFirstClear);
    assert.equal(s.progress.coins, coinsAfter);
    assert.ok(s.trials.trial_first_turns.done);
});
t('défi échoué : pas de récompense', () => {
    const s = fresh();
    const sum = P.applyRunResult(s, mkRun({ mode: 'trial', trialId: 'trial_first_turns', trial: M.getTrial('trial_first_turns'), result: 'fail', gates: 3, distM: 100 }));
    assert.ok(!sum.trialFirstClear);
    assert.ok(!(s.trials.trial_first_turns && s.trials.trial_first_turns.done));
});
t('trophées cumulés : aucun double comptage', () => {
    const s = fresh();
    for (let i = 0; i < 9; i++) P.applyRunResult(s, mkRun({ result: 'crash', gates: 11, distM: 300 }));
    assert.equal(s.progress.totalGates, 99);
    assert.ok(!s.trophies.total_gates_100, '99 portes cumulées : pas encore de trophée');
    const coins = s.progress.coins;
    const sum = P.applyRunResult(s, mkRun({ result: 'crash', gates: 11, distM: 300 }));
    assert.ok(s.trophies.total_gates_100, '110 portes cumulées : trophée obtenu');
    assert.ok(sum.trophies.some(t => t.id === 'total_gates_100'));
    assert.ok(s.progress.coins >= coins + 50, 'récompense du trophée versée');
    const after = s.progress.coins;
    P.applyRunResult(s, mkRun({ result: 'crash', gates: 11, distM: 300 }));
    assert.equal(s.progress.coins, after, 'récompense versée une seule fois');
});
t('missions : 3 par jour, accomplies une seule fois', () => {
    const s = fresh();
    P.ensureMissions(s, new Date('2026-05-01T10:00:00'));
    assert.equal(s.missions.list.length, 3);
    const first = JSON.stringify(s.missions);
    P.ensureMissions(s, new Date('2026-05-01T23:00:00'));
    assert.equal(JSON.stringify(s.missions), first);
    P.ensureMissions(s, new Date('2026-05-02T08:00:00'));
    assert.notEqual(s.missions.day, '2026-05-01');
});

console.log('Pistes, équipements, modes');
t('déblocage des pistes par niveau', () => {
    const s = fresh();
    assert.ok(P.isTrackUnlocked(s, 'beginner'));
    assert.ok(!P.isTrackUnlocked(s, 'alpine'));
    s.progress.xp = 120;
    assert.ok(P.isTrackUnlocked(s, 'alpine'));
    s.progress.xp = 1e6;
    for (const id of TRACK_ORDER) assert.ok(P.isTrackUnlocked(s, id));
});
t('5 pistes configurées, toutes distinctes', () => {
    assert.equal(TRACK_ORDER.length, 5);
    const seeds = new Set(TRACK_ORDER.map(id => TRACKS[id].seed));
    assert.equal(seeds.size, 5);
    for (const id of TRACK_ORDER) assert.ok(TRACKS[id].lengthM > 0 && TRACKS[id].halfWidth > 5);
});
t('achat : pièces suffisantes requises, pas de double achat', () => {
    const s = fresh();
    assert.equal(C.purchase(s, 'skis', 's_carbon').ok, false);
    s.progress.coins = 200;
    assert.equal(C.purchase(s, 'skis', 's_carbon').ok, true);
    assert.equal(s.progress.coins, 50);
    assert.equal(C.purchase(s, 'skis', 's_carbon').ok, false);
    assert.ok(C.isUnlocked(s, 'skis', 's_carbon'));
});
t('équipements de niveau / trophée non achetables', () => {
    const s = fresh();
    s.progress.coins = 9999;
    assert.equal(C.purchase(s, 'character', 'c_maya').ok, false);
    assert.equal(C.purchase(s, 'accessory', 'a_cape').ok, false);
});
t('syncUnlocks : niveau et trophée', () => {
    const s = fresh();
    assert.ok(!C.isUnlocked(s, 'character', 'c_maya'));
    C.syncUnlocks(s, 3);
    assert.ok(C.isUnlocked(s, 'character', 'c_maya'));
    s.trophies.total_gates_100 = { unlockedAt: 1 };
    C.syncUnlocks(s, 3);
    assert.ok(C.isUnlocked(s, 'accessory', 'a_cape'));
});
t('loadout invalide ou verrouillé → valeurs par défaut', () => {
    const s = fresh();
    s.loadout.character = 'c_yeti'; s.loadout.helmet = 'zzz';
    const l = C.resolveLoadout(s);
    assert.equal(l.character, 'c_alex');
    assert.equal(l.helmet, 'h_blue');
});
t('conditions de fin par mode', () => {
    const r = (o) => M.evaluateEnd(mkRun(o));
    assert.equal(r({ mode: 'endless', lives: 1 }), null);
    assert.equal(r({ mode: 'endless', lives: 0 }).result, 'crash');
    assert.equal(r({ mode: 'free', lives: 0 }), null);
    assert.equal(r({ mode: 'timetrial', crossedFinish: true }).result, 'finish');
    assert.equal(r({ mode: 'timetrial', lives: 0 }).result, 'fail');
    const tr = (id, o) => M.evaluateEnd(mkRun({ mode: 'trial', trial: M.getTrial(id), trialId: id, ...o }));
    assert.equal(tr('trial_first_turns', { gates: 10 }).result, 'success');
    assert.equal(tr('trial_first_turns', { gates: 4, distM: 330 }).result, 'fail');
    assert.equal(tr('trial_first_turns', { gates: 4, distM: 100 }), null);
    assert.equal(tr('trial_night', { crossedFinish: true, time: 60 }).result, 'success');
    assert.equal(tr('trial_night', { crossedFinish: true, time: 80 }).result, 'fail');
    assert.equal(tr('trial_night', { time: 76 }).result, 'fail');
});
t('vies par difficulté et par mode', () => {
    assert.equal(M.livesFor('endless', 'easy'), DIFFICULTY_PRESETS.easy.lives);
    assert.equal(M.livesFor('endless', 'extreme'), 2);
    assert.equal(M.livesFor('timetrial', 'extreme'), 5);
    assert.equal(M.livesFor('free', 'normal'), Infinity);
    assert.equal(M.livesFor('trial', 'normal', M.getTrial('trial_survivor')), 1);
});
t('graines : contre-la-montre identique, endless aléatoire', () => {
    const tk = TRACKS.alpine;
    assert.equal(M.courseSeed('timetrial', tk), M.courseSeed('timetrial', tk));
    assert.notEqual(M.courseSeed('endless', tk), M.courseSeed('endless', tk));
});

console.log('Avatar 3D');
t('avatar par défaut : dossard 225, style classique, aucune surcharge de couleur', () => {
    const a = S.defaultSave().avatar;
    assert.deepEqual(a, { jacket: '', skis: '', mask: '', helmet: '', bib: 225, style: 'classic' });
});
t('avatar : valeurs hostiles ou hors bornes nettoyées', () => {
    const a = C.sanitizeAvatar({ jacket: 'red', skis: '#GGGGGG', mask: '#00FF88', helmet: '<script>', bib: 12345, style: 'dragon' });
    assert.equal(a.jacket, ''); assert.equal(a.skis, ''); assert.equal(a.mask, '#00ff88'); assert.equal(a.helmet, '');
    assert.equal(a.bib, 999); assert.equal(a.style, 'classic');
    assert.equal(C.sanitizeAvatar({ bib: -4 }).bib, 0);
    assert.equal(C.sanitizeAvatar({ bib: 'abc' }).bib, 225);
    assert.equal(C.sanitizeAvatar(null).bib, 225);
    assert.equal(C.sanitizeAvatar({ style: 'viking' }).style, 'viking');
});
t('avatar : conservé par sanitizeSave, restauré par défaut si absent', () => {
    const s = S.sanitizeSave({ v: 2, avatar: { jacket: '#112233', bib: 7, style: 'cyber' } });
    assert.equal(s.avatar.jacket, '#112233'); assert.equal(s.avatar.bib, 7); assert.equal(s.avatar.style, 'cyber');
    assert.equal(S.sanitizeSave({ v: 2 }).avatar.bib, 225);
});

console.log(`\n${n} tests, ${bad} échec(s).`);
process.exit(bad ? 1 : 0);
