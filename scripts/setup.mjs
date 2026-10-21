// Télécharge Three.js r160 (module ES minifié) dans js/vendor/ s'il est absent ou s'il s'agit du fichier relais.
// Usage : node scripts/setup.mjs [--force]
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'js', 'vendor', 'three.module.min.js');
const URL_ = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';
const force = process.argv.includes('--force');

if (!force && existsSync(target) && statSync(target).size > 100000) {
    console.log('three.module.min.js déjà présent : rien à faire.');
    process.exit(0);
}
mkdirSync(dirname(target), { recursive: true });
const res = await fetch(URL_);
if (!res.ok) {
    console.error(`Échec du téléchargement (${res.status}). Téléchargez ${URL_} à la main vers js/vendor/three.module.min.js`);
    process.exit(1);
}
writeFileSync(target, Buffer.from(await res.arrayBuffer()));
console.log('three.module.min.js (r160) installé dans js/vendor/.');
