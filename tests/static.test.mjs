// Tests statiques : syntaxe JS, imports/exports, chemins HTML/CSS, identifiants DOM utilisés par le code.
// Exécution : node tests/static.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0, checks = 0;
const ok = (c, msg) => { checks++; if (!c) { failures++; console.log('  ÉCHEC :', msg); } };
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const jsFiles = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);

console.log('1) Syntaxe JavaScript');
for (const f of jsFiles) {
    const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: read(f), encoding: 'utf8' });
    ok(r.status === 0, `${f} : ${r.stderr.split('\n')[0]}`);
}
console.log(`   ${jsFiles.length} fichiers vérifiés`);

console.log('2) Imports : fichiers existants et noms exportés');
const exportsOf = (file) => {
    const src = read(file);
    const names = new Set();
    for (const m of src.matchAll(/export\s+(?:const|let|var|function\*?|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
    for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) m[1].split(',').forEach(n => names.add(n.trim().split(/\s+as\s+/).pop()));
    return names;
};
for (const f of jsFiles) {
    const src = read(f);
    for (const m of src.matchAll(/import\s+(?:(\*\s+as\s+\w+)|\{([^}]*)\})\s+from\s+'([^']+)'/g)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[3]));
        ok(fs.existsSync(path.join(root, target)), `${f} importe ${m[3]} : fichier absent`);
        if (m[2] && !target.includes('vendor')) {
            const ex = exportsOf(target);
            for (const n of m[2].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) ok(ex.has(n), `${f} importe « ${n} » absent de ${target}`);
        }
    }
}

console.log('3) Chemins (HTML et CSS)');
const html = read('index.html');
for (const m of html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)) ok(fs.existsSync(path.join(root, m[1])), `index.html référence ${m[1]} : fichier absent`);
for (const f of fs.readdirSync(path.join(root, 'css'))) {
    const css = read('css/' + f);
    for (const m of css.matchAll(/url\(([^)]+)\)/g)) {
        const u = m[1].replace(/['"]/g, '');
        if (/^(data:|https?:)/.test(u)) continue;
        ok(fs.existsSync(path.join(root, 'css', u)), `css/${f} : url(${u}) absent`);
    }
    ok((css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length, `css/${f} : accolades déséquilibrées`);
}

console.log('4) Identifiants DOM');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const dupes = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) !== i);
ok(dupes.length === 0, `identifiants dupliqués : ${dupes.join(', ')}`);
let used = 0;
for (const f of jsFiles) {
    const src = read(f);
    for (const m of src.matchAll(/(?:getElementById|\$|_set|_show)\(\s*'([a-z][a-z0-9-]*[a-z0-9])'/g)) {
        used++;
        ok(ids.has(m[1]), `${f} utilise #${m[1]} absent de index.html`);
    }
    for (const m of src.matchAll(/\bscreen-'\s*\+/g)) void m;
}
for (const s of ['start', 'pause', 'gameover']) ok(ids.has('screen-' + s), `#screen-${s} absent`);
for (const m of html.matchAll(/data-tab="([^"]+)"/g)) ok(ids.has(m[1]), `onglet data-tab="${m[1]}" sans contenu`);
console.log(`   ${used} références vérifiées, ${ids.size} identifiants dans la page`);

console.log('5) Sélecteurs CSS par identifiant');
for (const f of fs.readdirSync(path.join(root, 'css'))) {
    let css = read('css/' + f).replace(/\/\*[\s\S]*?\*\//g, '');
    // On retire les déclarations { ... } pour ne garder que les sélecteurs (couleurs #fff exclues)
    for (let i = 0; i < 4; i++) css = css.replace(/\{[^{}]*\}/g, ';');
    for (const m of css.matchAll(/(^|[\s,>+~])#([A-Za-z][\w-]*)/g)) ok(ids.has(m[2]), `css/${f} : sélecteur #${m[2]} sans élément`);
}

console.log(`\n${checks} vérifications, ${failures} échec(s).`);
process.exit(failures ? 1 : 0);
