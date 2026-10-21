// Génération procédurale de la piste (portes, obstacles, reliefs, pièces) et rendu instancié.
//  - Course : logique pure (positions, collisions, hauteur du sol) – testable sans navigateur.
//  - CourseRenderer : modèles 3D procéduraux, un InstancedMesh par type d'objet.
//
// Équité : un "couloir" (lane) traverse le centre de chaque porte. Aucun obstacle dangereux n'est généré
// dans ce couloir, dont la pente latérale est bornée : une trajectoire sans collision existe toujours.
import * as THREE from './vendor/three.module.min.js';
import {
    TrackTerrain, CHUNK_LEN, DIST_FACTOR, clamp, lerp, smoothstep, hash32, rand01, mulberry32
} from './tracks.js';
import {
    part, mergeParts, jitterGeometry, composeMatrix, makeSoftDiscTexture, makeBannerTexture
} from './geometry.js';

const SKIER_RADIUS = 0.32;
const START_CLEAR = 85;        // unités sans obstacle au départ
const FINISH_CLEAR = 30;       // unités sans obstacle avant l'arrivée
const RAMP_EXTRA = {           // pente supplémentaire du tremplin par rapport à la pente de la piste
    beginner: [0.13, 0.18], alpine: [0.17, 0.24], forest: [0.15, 0.20], extreme: [0.20, 0.28], night: [0.16, 0.23]
};

function boxWin(v, a, b, m) {
    return smoothstep(a - m, a + m, v) * (1 - smoothstep(b - m, b + m, v));
}

export class Course {
    /**
     * @param {object} o  { track, seed, mode, diff, decorDensity, lengthM, coins, obstacleMul }
     */
    constructor(o) {
        this.track = o.track;
        this.seed = o.seed | 0;
        this.mode = o.mode || 'endless';
        this.diff = o.diff;
        this.decorDensity = o.decorDensity == null ? 1 : o.decorDensity;
        this.coinsOn = o.coins !== false;
        this.obstacleMul = o.obstacleMul == null ? 1 : o.obstacleMul;
        this.terrain = new TrackTerrain(this.track, this.seed);
        this.gatesEnabled = this.mode !== 'free';
        this.spacing = this.track.gateSpacing;
        this.firstGate = 72;
        this.gateWidthBase = this.track.gateWidth * this.diff.gateWidthMul;
        this.finishZ = o.lengthM ? -(o.lengthM / DIST_FACTOR) : null;
        this.laneHalf = this.track.laneHalf;
        this.chunks = new Map();
        this.version = 0;
        this.coinsTaken = 0;
    }

    // ------------------------------------------------------------------ portes & couloir
    gateZ(k) { return -(this.firstGate + k * this.spacing); }
    isRed(k) { return (k & 1) === 0; }
    gateWidth(k) {
        if (this.mode !== 'endless') return this.gateWidthBase;
        const distM = -this.gateZ(k) * DIST_FACTOR;
        return this.gateWidthBase * (1 - 0.14 * clamp(distM / 2500, 0, 1));
    }
    gateOffset(k) {
        const [a, b] = this.track.gateOffset;
        const m = a + (b - a) * rand01(this.seed, k, 77);
        return (k & 1) ? -m : m;
    }
    gateX(k) { return this.terrain.centerX(this.gateZ(k)) + this.gateOffset(k); }

    /** Axe du couloir garanti libre : relie le centre de chaque porte. */
    laneX(z) {
        const t = (-z - this.firstGate) / this.spacing;
        if (t <= 0) {
            const s = smoothstep(0, this.firstGate, -z);
            return this.gateX(0) * s;
        }
        const k = Math.floor(t);
        return lerp(this.gateX(k), this.gateX(k + 1), t - k);
    }

    /** Indices des portes dont z est dans ]zb, za]. */
    gatesIn(za, zb) {
        const kMin = Math.max(0, Math.ceil((-za - this.firstGate) / this.spacing));
        const kMax = Math.ceil((-zb - this.firstGate) / this.spacing) - 1;
        const out = [];
        for (let k = kMin; k <= kMax; k++) out.push(k);
        return out;
    }
    gateNear(za, zb, pad) {
        const kMin = Math.max(0, Math.floor((-za - pad - this.firstGate) / this.spacing));
        const kMax = Math.ceil((-zb + pad - this.firstGate) / this.spacing);
        for (let k = kMin; k <= kMax; k++) {
            const z = this.gateZ(k);
            if (z <= za + pad && z >= zb - pad) return true;
        }
        return false;
    }

    // ------------------------------------------------------------------ progression de difficulté
    _prog(z) {
        const dm = Math.max(0, -z * DIST_FACTOR - 80);
        return this.mode === 'endless' ? clamp(dm / 2000, 0, 1) : clamp(dm / 500, 0, 1);
    }

    // ------------------------------------------------------------------ gestion des segments
    chunkIndexOf(z) { return Math.floor(-z / CHUNK_LEN); }

    /** Génère les segments autour de z ; retourne true si quelque chose a changé. */
    ensure(z, ahead) {
        const ic = this.chunkIndexOf(z);
        const from = ic - 1, to = ic + ahead;
        let changed = false;
        for (let i = from; i <= to; i++) {
            if (!this.chunks.has(i)) { this.chunks.set(i, this._gen(i)); changed = true; }
        }
        for (const i of Array.from(this.chunks.keys())) {
            if (i < from || i > to + 1) { this.chunks.delete(i); changed = true; }
        }
        if (changed) this.version++;
        return changed;
    }

    chunkAtZ(z) { return this.chunks.get(this.chunkIndexOf(z)); }

    // ------------------------------------------------------------------ hauteur du sol
    _delta(ch, x, z) {
        let d = 0;
        for (const b of ch.bumps) {
            const dx = x - b.x, dz = z - b.z;
            const q = (dx * dx + dz * dz) / (b.r * b.r);
            if (q < 1) d += b.h * (1 - q) * (1 - q);
        }
        for (const r of ch.ravines) {
            d -= r.depth * boxWin(z, r.zb, r.za, 1.8) * boxWin(x, r.xa, r.xb, 1.4);
        }
        return d;
    }

    /** Hauteur du terrain nu (bosses et ravins inclus, tremplins exclus) : utilisée pour le rendu du sol. */
    terrainY(x, z) {
        const ch = this.chunks.get(this.chunkIndexOf(z));
        return this.terrain.baseHeight(x, z) + (ch ? this._delta(ch, x, z) : 0);
    }

    rampHeight(ch, x, z) {
        let h = 0;
        for (const r of ch.ramps) {
            const u = (r.z - z) / r.L;
            if (u <= 0 || u >= 1) continue;
            const side = smoothstep(r.W / 2, r.W / 2 - 0.7, Math.abs(x - r.x));
            if (side <= 0) continue;
            h += r.H * Math.pow(u, 1.6) * side;
        }
        return h;
    }

    /** Hauteur du sol sous le skieur (tremplins inclus). */
    groundY(x, z) {
        const ch = this.chunks.get(this.chunkIndexOf(z));
        const base = this.terrain.baseHeight(x, z);
        if (!ch) return base;
        return base + this._delta(ch, x, z) + this.rampHeight(ch, x, z);
    }

    /** Informations de surface : neige profonde, ravin, hors-piste (0..1). */
    zoneAt(x, z) {
        const ch = this.chunks.get(this.chunkIndexOf(z));
        let deep = 0, ravine = 0;
        if (ch) {
            for (const d of ch.deeps) {
                deep = Math.max(deep, boxWin(z, d.zb, d.za, 1.5) * boxWin(x, d.xa, d.xb, 1.5));
            }
            for (const r of ch.ravines) {
                ravine = Math.max(ravine, boxWin(z, r.zb, r.za, 1.8) * boxWin(x, r.xa, r.xb, 1.4));
            }
        }
        return { deep, ravine, off: this.terrain.offPiste(x, z) };
    }

    // ------------------------------------------------------------------ collisions
    /**
     * Cherche un obstacle touché par le skieur (cercle de rayon SKIER_RADIUS) à (x, z), altitude absolue y.
     * Retourne le collider ou null.
     */
    collide(x, z, y, r = SKIER_RADIUS) {
        const ic = this.chunkIndexOf(z);
        for (let i = ic - 1; i <= ic + 1; i++) {
            const ch = this.chunks.get(i);
            if (!ch) continue;
            const list = ch.colliders;
            for (let n = 0; n < list.length; n++) {
                const c = list[n];
                const dz = z - c.z;
                if (dz > 4 || dz < -4) continue;
                if (y > c.y0 + c.top) continue;      // le skieur saute par-dessus
                if (c.t === 'c') {
                    const dx = x - c.x;
                    const rr = c.r + r;
                    if (dx * dx + dz * dz < rr * rr) return c;
                } else {
                    const px = clamp(x, c.x - c.hx, c.x + c.hx);
                    const pz = clamp(z, c.z - c.hz, c.z + c.hz);
                    const dx = x - px, dzz = z - pz;
                    if (dx * dx + dzz * dzz < r * r) return c;
                }
            }
        }
        return null;
    }

    /** Ramasse les pièces proches ; retourne le nombre ramassé. */
    pickCoins(x, y, z) {
        let n = 0;
        const ic = this.chunkIndexOf(z);
        for (let i = ic - 1; i <= ic + 1; i++) {
            const ch = this.chunks.get(i);
            if (!ch) continue;
            for (const c of ch.coins) {
                if (c.taken) continue;
                const dz = z - c.z;
                if (dz > 2.2 || dz < -2.2) continue;
                const dx = x - c.x, dy = (y + 0.9) - c.y;
                if (dx * dx + dy * dy + dz * dz < 2.4 * 2.4) {
                    c.taken = true;
                    n++;
                }
            }
        }
        if (n) { this.coinsTaken += n; this.version++; }
        return n;
    }

    // ------------------------------------------------------------------ validation (tests)
    /** Vérifie qu'aucun danger ne se trouve sur le couloir entre za et zb. Retourne les problèmes trouvés. */
    validateLane(za, zb, step = 0.5) {
        const problems = [];
        for (let z = za; z > zb; z -= step) {
            this.ensure(z, 3);
            const x = this.laneX(z);
            const hit = this.collide(x, z, this.groundY(x, z), SKIER_RADIUS + 0.2);
            if (hit) problems.push({ z, x, kind: hit.kind });
            const zone = this.zoneAt(x, z);
            if (zone.ravine > 0.05) problems.push({ z, x, kind: 'ravine' });
            if (Math.abs(x - this.terrain.centerX(z)) > this.terrain.halfW - 1) problems.push({ z, x, kind: 'edge' });
        }
        return problems;
    }

    // ------------------------------------------------------------------ génération d'un segment
    _gen(i) {
        const L = CHUNK_LEN;
        const z0 = -i * L, z1 = -(i + 1) * L;
        const T = this.track, terr = this.terrain, sp = T.specials;
        const rng = mulberry32(hash32(this.seed, i, 99));
        const R = (a, b) => a + (b - a) * rng();
        const ch = { i, z0, z1, colliders: [], items: {}, coins: [], gates: [], ramps: [], bumps: [], ravines: [], deeps: [] };
        const reserved = [];
        const add = (kind, o) => { (ch.items[kind] || (ch.items[kind] = [])).push(o); };
        const ty = (x, z) => terr.baseHeight(x, z) + this._delta(ch, x, z);
        const prog = this._prog((z0 + z1) / 2);
        const fMul = (this.mode === 'endless' ? lerp(0.5, 1.3, prog) : lerp(0.7, 1.0, prog)) * this.obstacleMul * this.diff.obstacleMul;
        const sMul = lerp(0.45, 1.0, prog) * (this.mode === 'free' ? 0.6 : 1);
        const finishZ = this.finishZ;
        const playable = (z) => z < -START_CLEAR && (finishZ == null || z > finishZ + FINISH_CLEAR);
        const isFree = (za, zb) => reserved.every(r => !(zb <= r[0] && za >= r[1]));
        const cxAt = (z) => terr.centerX(z);
        const halfW = terr.halfW, bound = terr.boundaryHalf;
        const forest = T.id === 'forest';

        // --- portes
        if (this.gatesEnabled) {
            for (const k of this.gatesIn(z0, z1)) {
                const z = this.gateZ(k);
                if (finishZ != null && z <= finishZ + 12) continue;
                const w = this.gateWidth(k), x = this.gateX(k), red = this.isRed(k);
                const gate = { k, x, z, w, red, state: 0 };
                ch.gates.push(gate);
                const y = ty(x, z);
                const slope = terr.gradeAt(z);
                add(red ? 'poleRed' : 'poleBlue', { x: x + w / 2, y: ty(x + w / 2, z), z, ry: 0, sx: 1, sy: 1, sz: 1 });
                add(red ? 'poleRed' : 'poleBlue', { x: x - w / 2, y: ty(x - w / 2, z), z, ry: Math.PI, sx: 1, sy: 1, sz: 1 });
                add(red ? 'lineRed' : 'lineBlue', { x, y: y + 0.03, z, ry: 0, sx: w, sy: 1, sz: 1, shear: slope });
            }
        }

        // --- tremplins
        if (rng() < sp.ramps * sMul) {
            const [e0, e1] = RAMP_EXTRA[T.id] || RAMP_EXTRA.alpine;
            for (let tries = 0; tries < 4; tries++) {
                const Lr = R(8.5, 11), Wr = R(6.0, 7.5);
                const zr = R(z1 + Lr + 22, z0 - 8);
                if (!playable(zr - Lr - 28)) continue;
                if (this.gateNear(zr + 2, zr - Lr - 2, 4)) continue;
                if (!isFree(zr + 2, zr - Lr - 2)) continue;
                const xr = this.laneX(zr - Lr / 2) + R(-1.0, 1.0);
                const extra = R(e0, e1);
                const H = Math.min(3.6, (T.grade + extra) * Lr / 1.6);
                ch.ramps.push({ x: xr, z: zr, L: Lr, W: Wr, H });
                reserved.push([zr + 2, zr - Lr - 2]);
                add('ramp', { x: xr, y: ty(xr, zr - Lr / 2), z: zr, ry: 0, sx: Wr, sy: H, sz: Lr, shear: terr.gradeAt(zr) });
                // arc de pièces au-dessus de la zone de réception (calculé pour ~45 u/s)
                if (this.coinsOn) {
                    const vref = 45, vy = vref * extra, zl = zr - Lr;
                    const yl = ty(xr, zl) + H;
                    for (let j = 1; j <= 4; j++) {
                        const tau = j * 0.2;
                        ch.coins.push({ x: xr, y: yl + vy * tau - 11 * tau * tau + 0.8, z: zl - vref * tau, taken: false });
                    }
                }
                break;
            }
        }

        // --- ravin (zone interdite signalée)
        if (T.specials.ravine && rng() < sp.ravine * sMul) {
            for (let tries = 0; tries < 4; tries++) {
                const Lz = R(11, 16);
                const zTop = R(z1 + Lz + 8, z0 - 26);
                const zBot = zTop - Lz;
                if (!playable(zBot - 8)) continue;
                if (this.gateNear(zTop + 14, zBot - 3, 3)) continue;
                if (!isFree(zTop + 14, zBot - 3)) continue;
                const laneA = this.laneX(zTop), laneB = this.laneX(zBot);
                const cx = cxAt(zTop);
                const roomR = (cx + bound) - (Math.max(laneA, laneB) + this.laneHalf + 2.5);
                const roomL = (Math.min(laneA, laneB) - this.laneHalf - 2.5) - (cx - bound);
                if (Math.max(roomR, roomL) < 6) continue;
                const s = roomR >= roomL ? 1 : -1;
                let xa, xb;
                if (s > 0) { xa = Math.max(laneA, laneB) + this.laneHalf + 2.5; xb = cx + bound + 8; }
                else { xb = Math.min(laneA, laneB) - this.laneHalf - 2.5; xa = cx - bound - 8; }
                ch.ravines.push({ xa, xb, za: zTop, zb: zBot, depth: 2.6 });
                reserved.push([zTop + 14, zBot - 3]);
                // Ruban de signalisation (obstacle bas, franchissable en sautant) + panneaux d'avertissement
                const edgeX = s > 0 ? xa : xb;
                const tapeFrom = Math.max(xa, cx - bound), tapeTo = Math.min(xb, cx + bound);
                for (let bx = tapeFrom + 1.8; bx < tapeTo; bx += 3.6) {
                    const zt = zTop + 2.4;
                    add('barrier', { x: bx, y: ty(bx, zt), z: zt, ry: 0, sx: 1, sy: 1, sz: 1 });
                    ch.colliders.push({ t: 'b', x: bx, z: zt, hx: 1.8, hz: 0.25, y0: ty(bx, zt), top: 0.9, kind: 'barrier', hard: false });
                }
                for (const dz of [24, 11]) {
                    const zs = zTop + dz;
                    const sx = edgeX - s * 1.4;
                    add('signWarn', { x: sx, y: ty(sx, zs), z: zs, ry: 0, sx: 1, sy: 1, sz: 1 });
                    ch.colliders.push({ t: 'c', x: sx, z: zs, r: 0.3, y0: ty(sx, zs), top: 2.3, kind: 'sign', hard: false });
                }
                break;
            }
        }

        // --- bosses
        if (rng() < sp.bumps * sMul) {
            const zc = R(z1 + 16, z0 - 16);
            if (playable(zc - 10) && isFree(zc + 10, zc - 10)) {
                const nb = Math.floor(R(3, 6));
                const hm = T.id === 'extreme' ? 1.3 : 1;
                for (let n = 0; n < nb; n++) {
                    const z = clamp(zc + R(-10, 10), z1 + 6, z0 - 6);
                    const x = cxAt(z) + R(-1, 1) * (halfW - 3);
                    ch.bumps.push({ x, z, r: R(3.5, 5.5), h: R(0.3, 0.55) * hm });
                }
            }
        }

        // --- neige profonde (ralentit, jamais sur le couloir)
        if (rng() < sp.deepSnow * sMul) {
            const Lz = R(14, 26), w = R(7, 12);
            const zTop = R(z1 + Lz + 2, z0 - 2);
            if (playable(zTop - Lz)) {
                const laneA = this.laneX(zTop), laneB = this.laneX(zTop - Lz);
                const s = rng() < 0.5 ? 1 : -1;
                let xa, xb;
                if (s > 0) { xa = Math.max(laneA, laneB) + this.laneHalf + 1.0; xb = Math.min(xa + w, cxAt(zTop) + bound); }
                else { xb = Math.min(laneA, laneB) - this.laneHalf - 1.0; xa = Math.max(xb - w, cxAt(zTop) - bound); }
                if (xb - xa > 3) ch.deeps.push({ xa, xb, za: zTop, zb: zTop - Lz });
            }
        }

        // --- murs de passage étroit (le couloir reste ouvert)
        if (T.specials.narrow && rng() < sp.narrow * sMul) {
            for (let tries = 0; tries < 3; tries++) {
                const zc = R(z1 + 16, z0 - 16);
                if (!playable(zc - 8)) continue;
                if (this.gateNear(zc + 6, zc - 8, 4)) continue;
                if (!isFree(zc + 6, zc - 8)) continue;
                reserved.push([zc + 6, zc - 8]);
                const useTree = forest || rng() < 0.4;
                for (const [row, zRow] of [[0, zc], [1, zc - 2.7]]) {
                    const cx = cxAt(zRow), lane = this.laneX(zRow);
                    const from = cx - (bound - 0.8), to = cx + (bound - 0.8);
                    for (let x = from + (row ? 1.2 : 0); x <= to; x += 2.4) {
                        const sc = R(0.8, 1.1);
                        const rad = useTree ? 0.85 * sc : 1.1 * sc;
                        if (Math.abs(x - lane) < this.laneHalf + rad + 0.15) continue;
                        this._placeObstacle(ch, add, ty, useTree ? 'tree' : 'rock', x, zRow, sc, R);
                    }
                }
                break;
            }
        }

        // --- obstacles dispersés
        {
            const expected = T.obstaclesPer100m * (L / 100) * fMul;
            let n = Math.floor(expected) + (rng() < expected - Math.floor(expected) ? 1 : 0);
            const rock = T.rockShare;
            while (n-- > 0) {
                for (let a = 0; a < 6; a++) {
                    const z = R(z1 + 3, z0 - 3);
                    if (!playable(z)) continue;
                    const x = cxAt(z) + R(-1, 1) * (halfW - 1.4);
                    const isRock = rng() < rock;
                    const sc = isRock ? R(0.7, 1.35) : R(T.treeScale[0], T.treeScale[1]);
                    const rad = isRock ? 1.1 * sc : 0.85 * sc;
                    if (!this._obstacleOk(ch, x, z, rad)) continue;
                    this._placeObstacle(ch, add, ty, isRock ? 'rock' : 'tree', x, z, sc, R);
                    if (isRock && rng() < 0.4) {
                        const x2 = x + R(1.6, 2.6) * (rng() < 0.5 ? -1 : 1), z2 = z + R(-1.5, 1.5);
                        const sc2 = sc * R(0.5, 0.7);
                        if (this._obstacleOk(ch, x2, z2, 1.1 * sc2)) this._placeObstacle(ch, add, ty, 'rock', x2, z2, sc2, R);
                    }
                    break;
                }
            }
        }

        // --- rangées de barrières (chicanes basses, franchissables)
        if (rng() < sp.barrier * sMul) {
            const z = R(z1 + 10, z0 - 10);
            if (playable(z - 6) && isFree(z + 3, z - 3) && !this.gateNear(z + 2, z - 2, 4)) {
                const lane = this.laneX(z), cx = cxAt(z);
                const s = rng() < 0.5 ? 1 : -1;
                const start = lane + s * (this.laneHalf + 0.5);
                for (let j = 0; j < 8; j++) {
                    const bx = start + s * (1.8 + 3.6 * j);
                    if (Math.abs(bx - cx) > halfW + 0.6) break;
                    add('barrier', { x: bx, y: ty(bx, z), z, ry: 0, sx: 1, sy: 1, sz: 1 });
                    ch.colliders.push({ t: 'b', x: bx, z, hx: 1.8, hz: 0.25, y0: ty(bx, z), top: 0.9, kind: 'barrier', hard: false });
                }
            }
        }

        // --- panneaux directionnels (courbes)
        if (rng() < sp.sign * sMul) {
            const z = R(z1 + 6, z0 - 6);
            if (playable(z)) {
                const slope = terr.centerSlope(z);
                const cx = cxAt(z);
                const side = rng() < 0.5 ? 1 : -1;
                const x = cx + side * (halfW + 0.9);
                // La flèche indique le sens du virage : dx/dz = -pente
                add('signArrow', { x, y: ty(x, z), z, ry: slope > 0 ? Math.PI : 0, sx: 1, sy: 1, sz: 1 });
            }
        }

        // --- pièces (sur le couloir : toujours atteignables)
        if (this.coinsOn && this.mode !== 'free' && rng() < T.coinRate) {
            const zStart = R(z1 + 12, z0 - 12);
            const n = Math.floor(R(5, 8));
            const zig = rng() < 0.5;
            for (let j = 0; j < n; j++) {
                const z = zStart - j * 5;
                if (z <= z1 + 1 || !playable(z)) continue;
                if (reserved.some(r => z <= r[0] && z >= r[1])) continue;
                const x = this.laneX(z) + (zig ? Math.sin(j * 1.1) * 2.2 : 0);
                ch.coins.push({ x, y: ty(x, z) + 1.1, z, taken: false });
            }
        }

        // --- limite visible de la zone jouable
        if (forest) {
            for (const s of [-1, 1]) {
                for (let z = z0 - R(0, 3); z > z1; z -= 3.3) {
                    const zz = z + R(-0.8, 0.8);
                    const x = cxAt(zz) + s * (halfW + 0.6 + R(0, 2.8));
                    const sc = R(T.treeScale[0], T.treeScale[1] + 0.2);
                    this._placeObstacle(ch, add, ty, 'tree', x, zz, sc, R);
                }
            }
        } else {
            for (const s of [-1, 1]) {
                for (let z = z0 - 2; z > z1; z -= 4) {
                    const x = cxAt(z) + s * bound;
                    add('net', { x, y: ty(x, z), z, ry: -Math.atan(terr.centerSlope(z)), sx: 1, sy: 1, sz: 1, shear: terr.gradeAt(z) });
                }
            }
        }

        // --- sapins décoratifs au-delà de la piste (sans collision)
        {
            const per = (L / T.decorSpacing) * T.forestEdge * this.decorDensity;
            for (const s of [-1, 1]) {
                let n = Math.floor(per) + (rng() < per - Math.floor(per) ? 1 : 0);
                while (n-- > 0) {
                    const z = R(z1, z0);
                    const x = cxAt(z) + s * (bound + 2.5 + Math.pow(rng(), 1.5) * 42);
                    const sc = R(0.9, 1.9);
                    add('tree', { x, y: ty(x, z), z, ry: R(0, 6.28), sx: sc, sy: sc * R(0.95, 1.2), sz: sc, tint: R(0.82, 1.1) });
                }
            }
        }

        // --- lampadaires (piste nocturne)
        if (T.lamps) {
            for (let z = z0 - ((i * 7) % 4); z > z1; z -= 26) {
                const s = (Math.round(z / 26) & 1) ? 1 : -1;
                const x = cxAt(z) + s * (halfW + 1.5);
                const y = ty(x, z);
                const ry = s > 0 ? Math.PI : 0;
                add('lamp', { x, y, z, ry, sx: 1, sy: 1, sz: 1 });
                add('lampHead', { x: x - s * 1.15, y: y + 6.55, z, ry, sx: 1, sy: 1, sz: 1 });
                const gx = x - s * 6.5;
                add('lampGlow', { x: gx, y: ty(gx, z) + 0.08, z, ry: 0, sx: 1, sy: 1, sz: 1, shear: terr.gradeAt(z) });
                ch.colliders.push({ t: 'c', x, z, r: 0.3, y0: y, top: 6, kind: 'sign', hard: false });
            }
        }

        return ch;
    }

    _obstacleOk(ch, x, z, rad) {
        // couloir libre
        if (Math.abs(x - this.laneX(z)) < this.laneHalf + rad) return false;
        // abords des portes
        const k = Math.round((-z - this.firstGate) / this.spacing);
        if (k >= 0) {
            const gz = this.gateZ(k);
            if (Math.abs(z - gz) < 3.5 && Math.abs(x - this.gateX(k)) < this.gateWidth(k) / 2 + rad + 1.5) return false;
        }
        for (const r of ch.ramps) {
            if (z < r.z + 2 && z > r.z - r.L - 2 && Math.abs(x - r.x) < r.W / 2 + rad + 1.2) return false;
        }
        for (const v of ch.ravines) {
            if (z < v.za + 3 && z > v.zb - 3 && x > v.xa - 1.5 && x < v.xb + 1.5) return false;
        }
        return true;
    }

    _placeObstacle(ch, add, ty, kind, x, z, sc, R) {
        const y = ty(x, z);
        if (kind === 'tree') {
            add('tree', { x, y, z, ry: R(0, 6.28), sx: sc, sy: sc, sz: sc, tint: R(0.85, 1.1) });
            ch.colliders.push({ t: 'c', x, z, r: 0.85 * sc, y0: y, top: 4.4 * sc, kind: 'tree', hard: true });
        } else {
            const sy = sc * R(0.8, 1.1);
            add('rock', { x, y, z, ry: R(0, 6.28), sx: sc * R(0.9, 1.15), sy, sz: sc * R(0.9, 1.15) });
            ch.colliders.push({ t: 'c', x, z, r: 1.05 * sc, y0: y, top: 1.35 * sy, kind: 'rock', hard: true });
        }
    }
}

// ===========================================================================
// Modèles 3D procéduraux
// ===========================================================================
function cyl(rt, rb, h, seg, y = 0) { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(0, y, 0); return g; }
function box(w, h, d, x = 0, y = 0, z = 0) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }

function buildTreeGeometry() {
    const parts = [];
    parts.push(part(cyl(0.22, 0.32, 1.2, 6, 0.6), 0x5c4033, null, { flat: true }));
    const levels = [
        { y: 1.7, r: 1.45, h: 1.9 },
        { y: 2.8, r: 1.12, h: 1.65 },
        { y: 3.75, r: 0.78, h: 1.35 }
    ];
    const green = new THREE.Color(0x14532d);
    for (const l of levels) {
        const cone = new THREE.ConeGeometry(l.r, l.h, 7);
        cone.translate(0, l.y, 0);
        const y0 = l.y - l.h / 2, y1 = l.y + l.h / 2;
        parts.push(part(cone, green, null, {
            flat: true,
            colorFn: (x, y) => {
                const t = (y - y0) / (y1 - y0);
                const k = 0.7 + 0.5 * t;
                return [green.r * k, green.g * k * 1.05, green.b * k];
            }
        }));
        const cap = new THREE.ConeGeometry(l.r * 0.82, l.h * 0.45, 7);
        cap.translate(0, l.y + l.h * 0.3, 0);
        parts.push(part(cap, 0xf8fafc, null, { flat: true }));
    }
    return mergeParts(parts);
}

function buildRockGeometry() {
    const parts = [];
    const m = new THREE.Matrix4();
    const main = new THREE.DodecahedronGeometry(1.05, 0);
    m.compose(new THREE.Vector3(0, 0.55, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.8, 0.2)), new THREE.Vector3(1.2, 0.85, 1.0));
    main.applyMatrix4(m);
    jitterGeometry(main, 0.12, 3);
    parts.push(part(main, 0x64748b, null, { flat: true }));
    const side = new THREE.DodecahedronGeometry(0.65, 0);
    m.compose(new THREE.Vector3(0.7, 0.35, 0.25), new THREE.Quaternion().setFromEuler(new THREE.Euler(1.1, 0.3, 0.5)), new THREE.Vector3(1, 1, 1));
    side.applyMatrix4(m);
    jitterGeometry(side, 0.08, 5);
    parts.push(part(side, 0x5b6779, null, { flat: true }));
    const snow = new THREE.DodecahedronGeometry(0.78, 0);
    m.compose(new THREE.Vector3(-0.05, 0.85, 0), new THREE.Quaternion(), new THREE.Vector3(1.1, 0.4, 0.9));
    snow.applyMatrix4(m);
    jitterGeometry(snow, 0.06, 9);
    parts.push(part(snow, 0xf1f5f9, null, { flat: true }));
    return mergeParts(parts);
}

function buildNetGeometry() {
    const parts = [];
    for (const z of [-1.95, 1.95]) parts.push(part(box(0.09, 1.15, 0.09, 0, 0.575, z), 0x475569));
    parts.push(part(box(0.05, 0.85, 3.9, 0, 0.62, 0), 0xf97316));
    parts.push(part(box(0.07, 0.07, 4.0, 0, 1.08, 0), 0xffffff));
    parts.push(part(box(0.07, 0.07, 4.0, 0, 0.2, 0), 0xea580c));
    return mergeParts(parts);
}

function buildBarrierGeometry() {
    const parts = [];
    parts.push(part(box(0.1, 1.0, 0.1, -1.7, 0.5, 0), 0x475569));
    parts.push(part(box(0.1, 1.0, 0.1, 1.7, 0.5, 0), 0x475569));
    for (let n = 0; n < 6; n++) {
        parts.push(part(box(0.58, 0.5, 0.12, -1.45 + n * 0.58, 0.68, 0), n % 2 ? 0xffffff : 0xdc2626));
    }
    parts.push(part(box(3.5, 0.08, 0.14, 0, 0.38, 0), 0xdc2626));
    return mergeParts(parts);
}

function buildWarnSignGeometry() {
    const parts = [];
    parts.push(part(cyl(0.05, 0.05, 2.4, 6, 1.2), 0x94a3b8));
    const diamond = (s, th, col, z) => {
        const g = new THREE.BoxGeometry(s, s, th);
        g.rotateZ(Math.PI / 4);
        g.translate(0, 1.95, z);
        return part(g, col);
    };
    parts.push(diamond(0.9, 0.1, 0x111827, 0));
    parts.push(diamond(0.76, 0.14, 0xfacc15, 0));
    parts.push(part(box(0.1, 0.34, 0.16, 0, 2.02, 0), 0x111827));
    parts.push(part(box(0.1, 0.1, 0.16, 0, 1.78, 0), 0x111827));
    return mergeParts(parts);
}

function buildArrowSignGeometry() {
    const parts = [];
    parts.push(part(cyl(0.05, 0.05, 2.2, 6, 1.1), 0x94a3b8));
    parts.push(part(box(1.2, 0.75, 0.1, 0, 1.85, 0), 0x1d4ed8));
    for (const sgn of [1, -1]) {
        const g = new THREE.BoxGeometry(0.46, 0.1, 0.14);
        g.rotateZ(sgn * 0.75);
        g.translate(-0.1, 1.85 + sgn * 0.14, 0);
        parts.push(part(g, 0xffffff));
    }
    return mergeParts(parts);
}

function buildGatePoleGeometry(colorHex) {
    const parts = [];
    parts.push(part(cyl(0.065, 0.065, 2.5, 8, 1.25), colorHex));
    parts.push(part(cyl(0.055, 0.055, 2.5, 8, 1.25).translate(0.65, 0, 0), colorHex));
    const banner = new THREE.PlaneGeometry(0.65, 0.52);
    banner.translate(0.325, 1.95, 0);
    parts.push(part(banner, colorHex));
    const stripe = new THREE.PlaneGeometry(0.45, 0.14);
    stripe.translate(0.325, 1.95, 0.012);
    parts.push(part(stripe, 0xffffff));
    return mergeParts(parts);
}

function buildCoinGeometry() {
    const parts = [];
    const disc = new THREE.CylinderGeometry(0.42, 0.42, 0.09, 14);
    disc.rotateX(Math.PI / 2);
    parts.push(part(disc, 0xfbbf24));
    const inner = new THREE.CylinderGeometry(0.27, 0.27, 0.12, 14);
    inner.rotateX(Math.PI / 2);
    parts.push(part(inner, 0xfde68a));
    return mergeParts(parts);
}

function buildLampGeometry() {
    const parts = [];
    parts.push(part(cyl(0.09, 0.13, 6.8, 6, 3.4), 0x334155));
    parts.push(part(box(1.3, 0.1, 0.1, -0.6, 6.7, 0), 0x334155));
    parts.push(part(box(0.6, 0.12, 0.4, -1.15, 6.62, 0), 0x1e293b));
    return mergeParts(parts);
}

function buildLampHeadGeometry() {
    return mergeParts([part(box(0.5, 0.08, 0.32, 0, 0, 0), 0xfff1b8)]);
}

/** Tremplin unitaire : largeur 1 (x), longueur 1 (z négatif), hauteur 1 ; profil de montée u^1.6. */
function buildRampGeometry() {
    const N = 10, pos = [], col = [];
    const topCol = new THREE.Color(0xe6eefb), sideCol = new THREE.Color(0x9fb4d6), lipCol = new THREE.Color(0xf97316), lipCol2 = new THREE.Color(0xffffff);
    const prof = (u) => Math.pow(u, 1.6);
    const tri = (a, b, c, color) => {
        for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); col.push(color.r, color.g, color.b); }
    };
    const bottom = -0.9;
    for (let n = 0; n < N; n++) {
        const u0 = n / N, u1 = (n + 1) / N;
        const c = n === N - 1 ? lipCol : (n === N - 2 ? lipCol2 : topCol);
        const a = [-0.5, prof(u0), -u0], b = [0.5, prof(u0), -u0], d = [-0.5, prof(u1), -u1], e = [0.5, prof(u1), -u1];
        tri(a, d, b, c); tri(b, d, e, c);
        // flancs
        tri([-0.5, bottom, -u0], [-0.5, bottom, -u1], a, sideCol); tri(a, [-0.5, bottom, -u1], d, sideCol);
        tri([0.5, bottom, -u0], b, [0.5, bottom, -u1], sideCol); tri(b, e, [0.5, bottom, -u1], sideCol);
    }
    // face arrière (lèvre)
    tri([-0.5, bottom, -1], [-0.5, 1, -1], [0.5, bottom, -1], sideCol);
    tri([0.5, bottom, -1], [-0.5, 1, -1], [0.5, 1, -1], sideCol);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
}

// ===========================================================================
// Rendu instancié
// ===========================================================================
class InstancePool {
    constructor(parent, geometry, material, capacity, { shadow = false, tint = false } = {}) {
        this.capacity = capacity;
        this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;
        this.mesh.castShadow = shadow;
        this.mesh.receiveShadow = shadow;
        this.tint = tint;
        if (tint) this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
        parent.add(this.mesh);
        this._m = new THREE.Matrix4();
        this._c = new THREE.Color();
        this.warned = false;
    }
    set(list) {
        let n = list.length;
        if (n > this.capacity) {
            if (!this.warned) { console.warn('InstancePool saturé :', n, '>', this.capacity); this.warned = true; }
            n = this.capacity;
        }
        for (let i = 0; i < n; i++) {
            const it = list[i];
            composeMatrix(this._m, it.x, it.y, it.z, it.ry || 0, it.sx || 1, it.sy || 1, it.sz || 1, it.shear || 0);
            this.mesh.setMatrixAt(i, this._m);
            if (this.tint) { const t = it.tint || 1; this._c.setRGB(t, t, t); this.mesh.setColorAt(i, this._c); }
        }
        this.mesh.count = n;
        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.tint && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
}

export class CourseRenderer {
    constructor(scene, profile) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.group.name = 'course';
        scene.add(this.group);
        this.pools = {};
        this.ownedGeos = [];
        this.ownedMats = [];
        this.coinPool = null;
        this.arches = [];
        this._m = new THREE.Matrix4();

        const lit = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
        const glossy = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide });
        const coinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.55, emissive: 0x6b4700, emissiveIntensity: 0.55 });
        const headMat = new THREE.MeshBasicMaterial({ vertexColors: true });
        const mkLine = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        this.glowTex = makeSoftDiscTexture(128);
        const glowMat = new THREE.MeshBasicMaterial({ map: this.glowTex, color: 0xffd58a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
        const flat = (w, d) => { const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); return g; };
        this.ownedMats.push(lit, glossy, coinMat, headMat, glowMat);

        const mk = (kind, geo, mat, cap, opts) => {
            this.ownedGeos.push(geo);
            this.pools[kind] = new InstancePool(this.group, geo, mat, cap, opts);
        };
        const redLine = mkLine(0xef4444), blueLine = mkLine(0x2563eb);
        this.ownedMats.push(redLine, blueLine);
        mk('tree', buildTreeGeometry(), lit, 1500, { shadow: true, tint: true });
        mk('rock', buildRockGeometry(), lit, 400, { shadow: true });
        mk('net', buildNetGeometry(), lit, 400, { shadow: false });
        mk('barrier', buildBarrierGeometry(), lit, 160, { shadow: true });
        mk('signWarn', buildWarnSignGeometry(), lit, 40, { shadow: true });
        mk('signArrow', buildArrowSignGeometry(), lit, 60, { shadow: true });
        mk('poleRed', buildGatePoleGeometry(0xef4444), glossy, 60, { shadow: true });
        mk('poleBlue', buildGatePoleGeometry(0x2563eb), glossy, 60, { shadow: true });
        mk('lineRed', flat(1, 0.34), redLine, 40);
        mk('lineBlue', flat(1, 0.34), blueLine, 40);
        mk('ramp', buildRampGeometry(), lit, 40, { shadow: true });
        mk('lamp', buildLampGeometry(), lit, 40, { shadow: true });
        mk('lampHead', buildLampHeadGeometry(), headMat, 40);
        mk('lampGlow', flat(15, 15), glowMat, 40);

        // pièces : animées à chaque image
        const coinGeo = buildCoinGeometry();
        this.ownedGeos.push(coinGeo);
        this.coinPool = new InstancePool(this.group, coinGeo, coinMat, 200, { shadow: false });
        this._coinList = [];

        this._buildArches();
        this.lastVersion = -1;
    }

    _buildArches() {
        this.startArch = new THREE.Group();
        this.finishArch = new THREE.Group();
        this.group.add(this.startArch, this.finishArch);
        this.startArch.visible = false;
        this.finishArch.visible = false;
    }

    _makeArch(group, text, halfW, opts) {
        // Nettoie un éventuel ancien arc
        while (group.children.length) {
            const c = group.children.pop();
            if (c.geometry) c.geometry.dispose();
            const mats = Array.isArray(c.material) ? c.material : (c.material ? [c.material] : []);
            for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
        }
        const w = halfW * 2 + 3.2;
        const postMat = new THREE.MeshStandardMaterial({ color: opts.post, roughness: 0.5 });
        for (const s of [-1, 1]) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 7, 0.7), postMat);
            post.position.set(s * (w / 2), 3.5, 0);
            post.castShadow = true;
            group.add(post);
        }
        const tex = makeBannerTexture(text, opts);
        // La bannière est très large : le texte se répète pour garder des proportions lisibles
        tex.wrapS = THREE.RepeatWrapping;
        tex.repeat.set(Math.max(1, Math.round(w / 9.6)), 1);
        const ban = new THREE.Mesh(new THREE.BoxGeometry(w, 1.5, 0.35), [
            new THREE.MeshStandardMaterial({ color: opts.post }), new THREE.MeshStandardMaterial({ color: opts.post }),
            new THREE.MeshStandardMaterial({ color: opts.post }), new THREE.MeshStandardMaterial({ color: opts.post }),
            new THREE.MeshBasicMaterial({ map: tex }), new THREE.MeshBasicMaterial({ map: tex })
        ]);
        ban.position.set(0, 6.6, 0);
        ban.castShadow = true;
        group.add(ban);
    }

    /** Place les arches de départ et d'arrivée pour la course donnée. */
    setCourse(course) {
        const t = course.terrain;
        this._makeArch(this.startArch, 'DÉPART', t.halfW, { bg: '#1d4ed8', fg: '#ffffff', post: 0x1e3a8a });
        this.startArch.position.set(t.centerX(-6), t.pathHeight(-6), -6);
        this.startArch.visible = true;
        if (course.finishZ != null) {
            const z = course.finishZ;
            this._makeArch(this.finishArch, 'ARRIVÉE', t.halfW, { bg: '#f8fafc', fg: '#0f172a', post: 0x111827, checker: true });
            this.finishArch.position.set(t.centerX(z), t.pathHeight(z), z);
            this.finishArch.visible = true;
        } else {
            this.finishArch.visible = false;
        }
        this.lastVersion = -1;
    }

    /** Réécrit les instances à partir des segments actifs (appelé seulement quand la piste change). */
    rebuild(course) {
        if (course.version === this.lastVersion) return;
        this.lastVersion = course.version;
        const agg = {};
        const coins = [];
        for (const ch of course.chunks.values()) {
            for (const kind of Object.keys(ch.items)) {
                const dst = agg[kind] || (agg[kind] = []);
                const src = ch.items[kind];
                for (let n = 0; n < src.length; n++) dst.push(src[n]);
            }
            for (const c of ch.coins) if (!c.taken) coins.push(c);
        }
        for (const kind of Object.keys(this.pools)) this.pools[kind].set(agg[kind] || []);
        this._coinList = coins;
    }

    /** Fait tourner les pièces (cheap : quelques dizaines d'instances). */
    updateCoins(timeSec, zRef) {
        const list = this._coinList;
        let n = 0;
        const cap = this.coinPool.capacity;
        for (let i = 0; i < list.length && n < cap; i++) {
            const c = list[i];
            if (c.taken || c.z > zRef + 30 || c.z < zRef - 220) continue;
            const ry = timeSec * 3.2 + c.x * 0.7;
            composeMatrix(this._m, c.x, c.y + Math.sin(timeSec * 2.4 + c.z) * 0.12, c.z, ry, 1, 1, 1, 0);
            this.coinPool.mesh.setMatrixAt(n++, this._m);
        }
        this.coinPool.mesh.count = n;
        this.coinPool.mesh.instanceMatrix.needsUpdate = true;
    }

    /** Active ou non les éléments propres à la nuit. */
    setNight(on) {
        this.pools.lampHead.mesh.visible = true;
        this.pools.lampGlow.mesh.visible = on;
    }

    dispose() {
        this.scene.remove(this.group);
        this.ownedGeos.forEach(g => g.dispose());
        this.ownedMats.forEach(m => m.dispose());
        for (const g of [this.startArch, this.finishArch]) {
            g.traverse(o => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); }
            });
        }
        this.glowTex.dispose();
        Object.values(this.pools).forEach(p => p.mesh.dispose());
        this.coinPool.mesh.dispose();
    }
}
