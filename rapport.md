# Rapport — Slalom Extrême 3D (refonte)

Rapport au 2026-10-21. Il distingue strictement ce qui a été **exécuté** de ce qui ne l'a **pas** été.

## 1. Livré

- Architecture modulaire ES (Three.js r160 local, sans framework ni backend).
- Monde 3D procédural : terrain par segments recyclés, décor en `InstancedMesh`, ciel, montagnes lointaines, neige, projections, traces de ski, résolution dynamique, gestion de la perte de contexte WebGL.
- 5 pistes, 4 modes (course infinie, contre-la-montre, défis, libre), progression et déblocages, sauvegarde v2 avec validation, migration et repli mémoire.
- Équipement, contrôles clavier et tactiles, audio, profils graphiques (Équilibré par défaut).
- **Avatar 3D articulé** : cuisses, genoux avec genouillères, tibias, chaussures rigides à boucles chromées, fixations, skis de slalom à spatules relevées ; torse aéro avec zip, bandes, dossard numéroté (225 par défaut) devant et derrière sur texture Canvas ; tour de cou et écharpe segmentée qui flotte ; casque pro, masque miroir, mentonnière, 4 styles (Classique Pro, Crête Aéro, Oreilles Cyber, Cornes Viking).
- **Animations procédurales** : flexion asymétrique du genou intérieur, carving sur les carres, position de schuss à haute vitesse, planté de bâton.
- **Onglet « ⛷️ Avatar 3D »** : couleurs de veste, skis, masque et casque, numéro de dossard, style de casque, enregistrés dans localStorage ; caméra d'inspection orbitale (360°, Face, Profil, Dos) ; bouton « 👁️ Aperçu 3D » pour l'aperçu plein écran avec poses de démonstration.

## 2. Tests

| Test | Commande | Résultat |
|---|---|---|
| Logique (storage, modes, progression, avatar) | `node tests/logic.test.mjs` | **Exécuté : 28/28 réussis** |
| Statique (modules, identifiants HTML/JS) | `node tests/static.test.mjs` | **Exécuté : 375/375 réussis** |
| Parcours (équité des couloirs, déterminisme) | `node tests/course.test.mjs` | **Exécuté : réussi** |
| E2E avatar (Playwright + Chromium SwiftShader) | `node tests/e2e-avatar.mjs` | **Exécuté : 8/8 réussis** (rendu, onglet, couleurs, dossard, persistance après rechargement, aperçu plein écran) |

Vérifications visuelles par captures : avatar de face, de profil, de dos, aperçu plein écran avec démo de slalom.

### Non exécuté à ce jour

Ces scénarios **n'ont pas été testés** et ne doivent pas être considérés comme validés :

- pause / redémarrage / retour menu ;
- clavier et tactile en situation de course ;
- collisions et perte de vies ;
- 4 modes × toutes les pistes ;
- arrivée du contre-la-montre et médailles ;
- achat d'équipement ;
- mobile 390×844 et 844×390 (absence de défilement horizontal) ;
- localStorage indisponible ;
- échec de chargement du module ;
- pause automatique à la perte de focus ;
- perte et restauration du contexte WebGL ;
- réinitialisation avec confirmation ;
- persistance des options ;
- fuites mémoire au redémarrage (`renderer.info`).

Les tests tournent sur un rendu logiciel (SwiftShader) : ils ne mesurent **pas** les performances réelles (FPS) sur appareil.

## 3. Problèmes rencontrés et corrigés

- Dispose d'un matériau tableau dans les arches d'obstacles ; étirement de la texture des bannières ; éclats aux bords du terrain.
- Profil « Économie » choisi à tort sur un conteneur à ≤ 2 cœurs : détection resserrée.
- Écharpe orientée vers le haut : angle cible désormais exprimé dans le repère monde.
- Vue de face : tête coupée, distance d'inspection et décalage de cadrage ajustés.
- Clic sur la barre d'aperçu intercepté par le canvas : `pointer-events:auto` sur la barre.
- Persistance e2e : l'enregistrement est différé de 200 ms, le test attend avant de lire localStorage.

## 4. Limites connues

- `MEDAL_TIMES` contient des valeurs provisoires, à calibrer.
- Quelques `void` provisoires subsistent dans `js/game.js`.
- Poses en jeu (schuss, planté de bâton, écharpe) non revues visuellement en conditions réelles.
- `js/vendor/three.module.min.js` n'est pas dans le dépôt : voir le README (`node scripts/setup.mjs`).

## 5. Publication GitHub

`git push` direct et `gh api` en écriture sont refusés (403) depuis cet environnement. Les fichiers sont poussés avec le connecteur GitHub sur `main`. Dernière vérification d'identité dépôt/local : à faire une fois la poussée terminée.
