# Slalom Extrême 3D

Jeu de ski 3D dans le navigateur (ordinateur et mobile). Three.js r160, modules ES, aucun framework lourd, aucun backend. Les modèles sont générés par code ; la progression est stockée dans `localStorage`.

## Installation

```bash
git clone https://github.com/Deku0019523f/Slalom-3D.git
cd Slalom-3D
node scripts/setup.mjs      # télécharge three.module.min.js (r160) dans js/vendor/
```

`js/vendor/three.module.min.js` n'est pas versionné par défaut : le script ci-dessus le récupère (réseau requis une seule fois). Vous pouvez aussi le placer à la main (voir `js/vendor/THREE-LICENSE.txt`).

## Lancement en local

Les modules ES sont **bloqués par les navigateurs en `file://`** : ouvrir `index.html` par double-clic n'affiche qu'un message d'explication. Servez le dossier en HTTP :

```bash
python3 -m http.server 8000     # puis http://localhost:8000
# ou : npx serve .
```

## Hébergement

Site 100 % statique : GitHub Pages, Netlify, Cloudflare Pages ou tout hébergeur de fichiers. Publiez le dossier tel quel (avec `js/vendor/three.module.min.js`). HTTPS recommandé. Aucune variable d'environnement.

## Contrôles

- Clavier : ◄ ► ou Q/D (tourner), Espace (saut), C (caméra), P ou Échap (pause), M (son).
- Tactile : boutons ◄ ► et saut, ou glisser le doigt.

## Fonctionnalités

- 5 pistes, 4 modes (course infinie, contre-la-montre, défis, libre), niveaux, pièces, trophées, missions.
- Équipement et déblocages ; profils graphiques Économie / **Équilibré (défaut)** / Élevé, résolution dynamique, reprise après perte de contexte WebGL.
- **Avatar 3D articulé** : onglet « ⛷️ Avatar 3D » (couleurs de veste, skis, masque et casque, dossard 0–999, 4 styles de casque), caméra d'inspection orbitale (360°, Face, Profil, Dos) et bouton « 👁️ Aperçu 3D » (plein écran, poses de démonstration). Les choix sont enregistrés dans `localStorage`.

## Structure

```
index.html            page unique
css/                  style, menu, game, mobile
js/main.js            démarrage
js/game.js            états, boucle, caméra
js/scene.js           rendu, terrain, particules
js/avatar.js          skieur articulé (IK)
js/…                  physique, pistes, obstacles, modes, progression, stockage, UI, audio
tests/                tests Node et E2E Playwright
scripts/setup.mjs     installation de Three.js
plan.md  rapport.md   plan de travail et rapport de tests
```

## Tests

```bash
npm test                      # logique + statique + parcours (Node, sans navigateur)
python3 -m http.server 8123 &   # puis, avec Playwright + Chromium :
node tests/e2e-avatar.mjs
```

L'état réel des tests (exécutés / non exécutés) est détaillé dans `rapport.md`.

## Licence

Three.js : MIT (voir `js/vendor/THREE-LICENSE.txt`).
