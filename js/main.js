// Point d'entrée : crée les modules, gère le chargement et les erreurs de démarrage.
import { loadSave, getSave, persist, persistNow, resetProgress } from './storage.js';
import { SettingsManager, isLowEndDevice } from './settings.js';
import { SoundManager } from './audio.js';
import { SceneManager } from './scene.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);

function showFatal(title, message, details) {
    const loading = $('loading');
    if (loading) loading.classList.add('hidden');
    const screen = $('error-screen');
    if (!screen) { document.body.textContent = `${title} — ${message}`; return; }
    $('error-title').textContent = title;
    $('error-message').textContent = message;
    $('error-details').textContent = details || '';
    $('error-details').parentElement.classList.toggle('hidden', !details);
    screen.classList.remove('hidden');
}

function webglAvailable() {
    try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) {
        return false;
    }
}

function progress(pct, text) {
    const f = $('loading-bar-fill');
    if (f) f.style.width = pct + '%';
    const t = $('loading-text');
    if (t && text) t.textContent = text;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function boot() {
    progress(10, 'Lecture de la sauvegarde…');
    if (!webglAvailable()) {
        showFatal('WebGL indisponible',
            'Votre navigateur ou votre appareil ne permet pas l\'affichage 3D (WebGL). Essayez un navigateur récent (Chrome, Firefox, Edge, Safari) et activez l\'accélération matérielle.');
        return;
    }

    const first = !localStorageHasSave();
    loadSave();
    const settings = new SettingsManager(getSave, persist);
    // Premier lancement sur un appareil modeste : profil économique proposé (modifiable dans les options)
    if (first && isLowEndDevice()) settings.set({ graphics: 'eco' });

    await nextFrame();
    progress(35, 'Création de la scène 3D…');
    const canvas = $('game-canvas');
    const sound = new SoundManager();
    let scene;
    try {
        scene = new SceneManager(canvas, settings.profile);
        scene.applyProfile(settings.profile);
    } catch (err) {
        console.error(err);
        showFatal('Impossible de créer la scène 3D',
            'Le contexte WebGL n\'a pas pu être initialisé. Fermez les autres onglets gourmands, puis rechargez la page.', String(err && err.stack || err));
        return;
    }

    await nextFrame();
    progress(70, 'Préparation de la piste…');
    const game = new Game({
        scene, sound, settings,
        store: { getSave, persist, persistNow, resetProgress }
    });
    window.__slalom = game;        // accès pour le débogage et les tests automatisés

    if (game.ui.missing.length) {
        console.error('Identifiants manquants dans index.html :', game.ui.missing.join(', '));
    }

    await nextFrame();
    progress(95, 'Dernières retouches…');
    game.ui.showScreen('start');
    game.ui.setTab('tab-play');
    game.previewCourse();
    game.start();
    progress(100, 'Prêt !');
    window.__slalomBooted = true;
    game.ui.hideLoading();
}

function localStorageHasSave() {
    try { return !!localStorage.getItem('slalom_extreme_save_v2'); } catch (e) { return false; }
}

window.addEventListener('error', (e) => {
    console.error('Erreur :', e.error || e.message);
    if (!window.__slalomBooted) showFatal('Erreur au démarrage', 'Le jeu n\'a pas pu démarrer.', String(e.error && e.error.stack || e.message));
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('Promesse rejetée :', e.reason);
    if (!window.__slalomBooted) showFatal('Erreur au démarrage', 'Le jeu n\'a pas pu démarrer.', String(e.reason && e.reason.stack || e.reason));
});

boot().catch((err) => {
    console.error(err);
    showFatal('Erreur au démarrage', 'Le jeu n\'a pas pu démarrer.', String(err && err.stack || err));
});
