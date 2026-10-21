# Plan — Slalom Extrême 3D (refonte)

Plan de travail, état d'avancement et reste à faire. Mis à jour le 2026-10-21.

## 1. Objectifs

- Refonte du jeu de ski 3D navigateur en **modules ES** (Three.js r160 local, aucun framework lourd, aucun backend).
- 3D procédurale réaliste, **5 pistes**, **4 modes**, progression et déblocages (localStorage), personnages et équipements, contrôles mobiles, audio, profils de performance (Équilibré par défaut), gestion d'erreurs.
- **Avatar 3D articulé** (`createArticulatedSkierAvatar`) + onglet « ⛷️ Avatar 3D » + caméra d'inspection orbitale + « 👁️ Aperçu 3D » plein écran.
- Tests honnêtes (jamais de test annoncé réussi sans exécution), README, liste des améliorations, ZIP propre.

## 2. Architecture

| Module | Rôle |
|---|---|
| `js/main.js` | Démarrage, chargement, erreurs fatales |
| `js/game.js` | Machine d'états (menu, compte à rebours, jeu, pause, résultat), boucle, caméra, avatar |
| `js/physics.js` | Physique en sous-pas ≤ 1/90 s |
| `js/tracks.js`, `js/obstacles.js` | Pistes, terrain par segments, portes, décor (InstancedMesh) |
| `js/scene.js`, `js/geometry.js` | Rendu, ciel, terrain recyclé, particules, traces |
| `js/avatar.js`, `js/avatar-config.js` | Skieur articulé (IK deux os), sanitisation de la config |
| `js/characters.js`, `js/progression.js`, `js/storage.js` | Catalogue, déblocages, sauvegarde v2 |
| `js/modes.js`, `js/settings.js` | Règles des modes, profils graphiques |
| `js/ui.js`, `js/controls.js`, `js/audio.js` | Interface (textContent uniquement), entrées, son |
| `tests/` | Tests logique, statique, parcours, e2e avatar |

## 3. Étapes

| # | Étape | État |
|---|---|---|
| 1 | Analyse du projet existant | Fait |
| 2 | Architecture modulaire, scène, terrain, obstacles | Fait |
| 3 | Modes, pistes, progression, sauvegarde v2 (migration, repli mémoire) | Fait |
| 4 | Équipement, contrôles tactiles, audio, profils graphiques | Fait |
| 5 | Avatar 3D articulé + animations (virage, carving, schuss, planté de bâton) | Fait |
| 6 | Onglet Avatar 3D, couleurs, dossard, styles de casque, caméra orbitale, Aperçu 3D | Fait |
| 7 | Tests logique / statique / parcours / e2e avatar | Fait (voir `rapport.md`) |
| 8 | Poussée progressive vers GitHub | En cours (voir §4) |
| 9 | README, `package.json`, script d'installation de Three.js | À finir |
| 10 | Tests E2E élargis (liste §5) | À faire |
| 11 | Calibrage des temps de médailles (`MEDAL_TIMES`) | À faire |
| 12 | ZIP final propre | À faire |

## 4. Publication GitHub

- `git push` direct et `gh api` en écriture sont refusés (403) depuis cet environnement.
- Les fichiers sont poussés via le connecteur GitHub (`push_files`, branche `main`).
- `js/vendor/three.module.min.js` (≈ 1 Mo) n'est **pas** poussé par le connecteur : à récupérer avec `node scripts/setup.mjs` (ou `npm run setup`) ou à committer depuis un poste local.

## 5. Reste à faire

- E2E : pause / redémarrage / menu ; clavier + tactile ; collisions et vies ; 4 modes × pistes ; contre-la-montre et médailles ; achat d'équipement ; mobile 390×844 et 844×390 sans défilement horizontal ; localStorage indisponible ; échec de chargement du module ; pause auto au blur ; perte/restauration du contexte WebGL ; réinitialisation avec confirmation ; persistance des options ; fuite mémoire au redémarrage (`renderer.info`).
- Nettoyer les `void` provisoires de `game.js` (RAMP_UP, syncUnlocks, TRACKS, sel).
- Contrôle visuel des poses en jeu (schuss, planté de bâton, écharpe).
- Calibrer `MEDAL_TIMES` sur des temps de course mesurés.
