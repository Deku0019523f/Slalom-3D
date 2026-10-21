// Tests de logique pure (Node) : équité du couloir, génération déterministe, limites de vitesse latérale.
import { Course } from '../js/obstacles.js';
import { TRACKS, TRACK_ORDER, DIST_FACTOR } from '../js/tracks.js';
import { DIFFICULTY_PRESETS } from '../js/settings.js';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  ✗', msg); } };

for (const tid of TRACK_ORDER) {
    for (const dk of Object.keys(DIFFICULTY_PRESETS)) {
        for (const mode of ['endless', 'timetrial']) {
            for (const seed of [1, 2, 3, 99, 12345]) {
                const track = TRACKS[tid];
                const diff = DIFFICULTY_PRESETS[dk];
                const c = new Course({ track, seed, mode, diff, lengthM: mode === 'timetrial' ? track.lengthM : null });
                const zEnd = -(mode === 'timetrial' ? track.lengthM / DIST_FACTOR : 5000);
                const problems = c.validateLane(0, zEnd, 0.5);
                ok(problems.length === 0, `${tid}/${dk}/${mode}/seed ${seed}: couloir bloqué ${JSON.stringify(problems.slice(0, 3))}`);
            }
        }
    }
}

// Pente latérale du couloir vs vitesse latérale max
const LAT_MAX = 26;
for (const tid of TRACK_ORDER) {
    for (const dk of Object.keys(DIFFICULTY_PRESETS)) {
        const track = TRACKS[tid], diff = DIFFICULTY_PRESETS[dk];
        const c = new Course({ track, seed: 7, mode: 'endless', diff });
        let worst = 0;
        for (let z = -80; z > -9000; z -= 1) {
            const s = Math.abs(c.laneX(z - 0.5) - c.laneX(z + 0.5)) ;
            if (s > worst) worst = s;
        }
        const vmax = diff.maxSpeed * track.speedMaxMul;
        const need = worst * vmax;
        const ratio = need / LAT_MAX;
        console.log(`${tid.padEnd(9)} ${dk.padEnd(8)} pente couloir max ${worst.toFixed(3)}  vmax ${vmax.toFixed(0)}  latéral requis ${need.toFixed(1)} / ${LAT_MAX}  (${(ratio * 100).toFixed(0)} %)`);
        ok(ratio < 0.92, `${tid}/${dk}: couloir trop raide (${(ratio * 100).toFixed(0)} %)`);
    }
}

// Déterminisme
{
    const track = TRACKS.alpine, diff = DIFFICULTY_PRESETS.normal;
    const a = new Course({ track, seed: 5, mode: 'timetrial', diff, lengthM: 1000 });
    const b = new Course({ track, seed: 5, mode: 'timetrial', diff, lengthM: 1000 });
    a.ensure(-300, 4); b.ensure(-300, 4);
    const sa = JSON.stringify([...a.chunks.values()].map(c => c.colliders));
    const sb = JSON.stringify([...b.chunks.values()].map(c => c.colliders));
    ok(sa === sb, 'génération non déterministe');
}

if (failures) { console.error(`\n${failures} échec(s)`); process.exit(1); }
console.log('\nTous les tests de course passent.');
