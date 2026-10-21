// Test navigateur de l'avatar 3D (nécessite Playwright et un serveur local : python3 -m http.server 8123)
// Exécution : node tests/e2e-avatar.mjs [url]
import { chromium } from 'playwright';
const URL_ = process.argv[2] || 'http://localhost:8123/index.html';
const exe = process.env.CHROMIUM_PATH || undefined;
const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1100, height: 700 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
let n = 0, bad = 0;
const ok = (name, cond) => { n++; if (!cond) bad++; console.log(cond ? '  ok  ' : '  ÉCHEC', name); };
await p.goto(URL_);
await p.waitForFunction(() => window.__slalomBooted, null, { timeout: 60000 });
await p.click('[data-tab="tab-avatar"]');
ok('onglet Avatar 3D visible', await p.isVisible('#tab-avatar'));
await p.fill('#av-bib', '77'); await p.dispatchEvent('#av-bib', 'change');
await p.fill('#av-jacket', '#00aa44');
await p.click('#avatar-styles button:nth-child(3)');
await p.waitForTimeout(1200);   // l'écriture du stockage est différée
const sv = await p.evaluate(() => JSON.parse(localStorage.getItem('slalom_extreme_save_v2')).avatar);
ok('personnalisation sauvegardée (dossard 77, veste, style cyber)', sv.bib === 77 && sv.jacket === '#00aa44' && sv.style === 'cyber');
await p.reload();
await p.waitForFunction(() => window.__slalomBooted, null, { timeout: 60000 });
const g = await p.evaluate(() => ({ bib: window.__slalom.skier.bibNumber, style: window.__slalom.skier.style, col: window.__slalom.skier.mats.jacket.color.getHexString() }));
ok('personnalisation restaurée après rechargement', g.bib === 77 && g.style === 'cyber' && g.col === '00aa44');
await p.click('[data-tab="tab-avatar"]');
await p.click('#avatar-views [data-view="back"]');
await p.waitForTimeout(2500);
const yaw = await p.evaluate(() => window.__slalom.inspect.yaw);
ok('vue Dos : caméra derrière le skieur', Math.abs(((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) < 0.1);
await p.click('#btn-preview3d');
ok('aperçu plein écran : menu masqué', !(await p.isVisible('#screen-start')) && await p.isVisible('#preview-bar'));
await p.click('#btn-preview-back');
ok('retour au menu', await p.isVisible('#screen-start'));
await p.click('#av-reset');
await p.waitForTimeout(1200);
const rs = await p.evaluate(() => JSON.parse(localStorage.getItem('slalom_extreme_save_v2')).avatar);
ok('réinitialisation : couleurs du catalogue, dossard conservé', rs.jacket === '' && rs.style === 'classic' && rs.bib === 77);
// Partie : aucune exception pendant quelques secondes de jeu
await p.click('[data-tab="tab-play"]'); await p.click('#btn-start');
await p.waitForTimeout(6000);
ok('aucune erreur JavaScript', errs.length === 0);
if (errs.length) console.log(errs.join('\n'));
console.log(`\n${n} vérifications, ${bad} échec(s).`);
await b.close();
process.exit(bad ? 1 : 0);
