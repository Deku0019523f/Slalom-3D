// Physique du skieur : glisse, virages, dérapage, sauts, réception, chutes et reprise.
// Intégration à pas variable (sous-pas ≤ 1/90 s) : le comportement ne dépend pas du nombre d'images par seconde.
import { clamp, DIST_FACTOR, KMH_FACTOR } from './tracks.js';

export const PHYS = {
    G: 22,               // gravité (unités/s²)
    HOP_VY: 6.5,         // impulsion du petit saut manuel
    HOP_COOLDOWN: 0.45,
    LAT_ACCEL: 78,       // réactivité des virages (valeur d'origine)
    LAT_DAMP: 6.2,       // amortissement latéral (valeur d'origine)
    LAT_MAX: 26,         // vitesse latérale max (valeur d'origine)
    LEAVE_GAP: 0.2,      // écart minimal pour décoller du sol
    SUBSTEP: 1 / 90,
    FALL_TIME: 1.25,
    RECOVER_TIME: 0.55,
    INVULN_AFTER_FALL: 2.4,
    RADIUS: 0.32
};

export class SkierPhysics {
    /**
     * @param course  instance de Course
     * @param opts    { diff, sensitivity }
     */
    constructor(course, opts) {
        this.course = course;
        this.track = course.track;
        this.terrain = course.terrain;
        this.diff = opts.diff;
        this.sensitivity = opts.sensitivity || 100;
        this.vmin = this.diff.minSpeed * this.track.speedMinMul;
        this.vmax = this.diff.maxSpeed * this.track.speedMaxMul;
        this.reset();
    }

    reset() {
        const c = this.course;
        this.x = 0;
        this.z = 0;
        this.y = c.groundY(0, 0);
        this.vx = 0;
        this.vy = 0;
        this.speed = this.vmin;
        this.grounded = true;
        this.airTime = 0;
        this.phase = 'ride';      // ride | fall | recover | finish
        this.phaseT = 0;
        this.skid = false;
        this.skidT = 0;
        this.stumbleT = 0;
        this.invuln = 0;
        this.hopCd = 0;
        this.landT = 0;
        this.lastGy = this.y;
        this.nextGate = 0;
        this.pitch = 0;
        this.zone = { deep: 0, ravine: 0, off: 0 };
        this.lastTurn = 0;
        this.fallCause = '';
        this.finishZ = c.finishZ;
        this.latMax = PHYS.LAT_MAX;
    }

    get kmh() { return Math.round(this.speed * KMH_FACTOR); }
    get speedRatio() { return clamp((this.speed - this.vmin) / (this.vmax - this.vmin), 0, 1); }
    get distM() { return Math.max(0, -this.z * DIST_FACTOR); }
    get turnIntensity() { return clamp(Math.abs(this.vx) / this.latMax, 0, 1); }
    get canControl() { return this.phase === 'ride'; }

    /** Avance la simulation de dt secondes. input = { turn: -1..1, jump: bool (front montant) }. Retourne les évènements. */
    update(dt, input) {
        const events = [];
        if (input.jump) this._hopRequested = true;
        const n = Math.max(1, Math.ceil(dt / PHYS.SUBSTEP));
        const h = dt / n;
        for (let i = 0; i < n; i++) this._step(h, input.turn || 0, events);
        // Pente du terrain sous le skieur (pour incliner le modèle)
        const c = this.course;
        const slope = (c.groundY(this.x, this.z + 1.5) - c.groundY(this.x, this.z - 1.5)) / 3;
        const targetPitch = Math.atan(slope) * 0.9;
        this.pitch += (targetPitch - this.pitch) * Math.min(1, 10 * dt);
        return events;
    }

    _step(h, turn, events) {
        const c = this.course, T = this.track, terr = this.terrain;
        this.phaseT += h;
        if (this.invuln > 0) this.invuln -= h;
        if (this.stumbleT > 0) this.stumbleT -= h;
        if (this.landT > 0) this.landT -= h;
        if (this.hopCd > 0) this.hopCd -= h;

        const sr = this.speedRatio;
        this.latMax = PHYS.LAT_MAX * (0.85 + 0.15 * sr);
        const zone = c.zoneAt(this.x, this.z);
        this.zone = zone;

        if (this.phase === 'ride') {
            // --- Direction latérale
            const latAccel = PHYS.LAT_ACCEL * (this.sensitivity / 100);
            let grip = this.grounded ? 1 : 0.3;
            if (this.skid) grip *= 0.55;
            if (this.stumbleT > 0) grip *= 0.6;
            grip *= 1 - 0.35 * zone.deep;
            if (turn !== 0) this.vx += turn * latAccel * grip * h;
            else this.vx -= this.vx * PHYS.LAT_DAMP * (this.grounded ? 1 : 0.15) * h;
            this.vx = clamp(this.vx, -this.latMax, this.latMax);
            this.lastTurn = turn;

            // --- Dérapage contrôlé : virage maintenu à la limite d'adhérence
            const edge = Math.abs(this.vx) / this.latMax;
            if (this.grounded && edge > 0.9 && turn !== 0 && Math.sign(turn) === Math.sign(this.vx)) this.skidT += h;
            else this.skidT = Math.max(0, this.skidT - 2 * h);
            this.skid = this.skidT > 0.35 || (this.skid && this.skidT > 0.12);

            // --- Vitesse : pente, inertie, frictions
            if (this.grounded) {
                const slopeRatio = terr.gradeAt(this.z) / T.grade;
                const t = clamp((this.speed - this.vmin) / (this.vmax - this.vmin), 0, 1);
                const a = this.diff.accel * T.slopeAccel * (0.55 + 0.45 * slopeRatio) * (1 - 0.6 * t * t);
                this.speed += a * h;
                let drag = 0.05 * edge * edge + zone.deep * 1.1 + zone.off * 0.5;
                if (this.skid) drag += 0.2;
                this.speed -= this.speed * drag * h;
            } else {
                this.speed -= this.speed * 0.015 * h;
            }
            this.speed = clamp(this.speed, this.vmin * 0.55, this.vmax * 1.06);

            // --- Petit saut manuel
            if (this._hopRequested) {
                this._hopRequested = false;
                if (this.grounded && this.hopCd <= 0) {
                    this.grounded = false;
                    this.vy = Math.max(this.vy, 0) + PHYS.HOP_VY;
                    this.airTime = 0;
                    this.hopCd = PHYS.HOP_COOLDOWN;
                    events.push({ type: 'hop' });
                }
            }
        } else {
            this._hopRequested = false;
            this.vx -= this.vx * 3 * h;
            if (this.phase === 'fall') this.speed -= this.speed * 2.3 * h;
            if (this.phase === 'finish') this.speed -= this.speed * 1.5 * h;
            this.skid = false;
        }

        // --- Déplacement horizontal
        const zPrev = this.z, xPrev = this.x;
        this.z -= this.speed * h;
        this.x += this.vx * h;

        // Limite jouable : filet/mur invisible → ricochet (récupérable)
        const cx = terr.centerX(this.z);
        const bound = terr.boundaryHalf;
        if (Math.abs(this.x - cx) > bound) {
            this.x = cx + Math.sign(this.x - cx) * (bound - 0.05);
            if (this.phase === 'ride' && this.invuln <= 0) {
                this.vx = -this.vx * 0.4;
                this.speed = Math.max(this.vmin * 0.6, this.speed * 0.78);
                this.stumbleT = 0.5;
                this.invuln = 0.6;
                events.push({ type: 'stumble', kind: 'net' });
            } else this.vx = 0;
        }

        // --- Verticalité : suivi du sol, décollage, vol, réception
        const gy = c.groundY(this.x, this.z);
        if (this.grounded) {
            const yb = this.y + this.vy * h - 0.5 * PHYS.G * h * h;
            if (this.phase === 'ride' && yb > gy + PHYS.LEAVE_GAP) {
                this.grounded = false;
                this.airTime = 0;
                events.push({ type: 'takeoff', vy: this.vy });
            } else {
                this.vy = (gy - this.y) / h;
                this.y = gy;
            }
        }
        if (!this.grounded) {
            this.vy -= PHYS.G * h;
            this.y += this.vy * h;
            this.airTime += h;
            if (this.y <= gy) {
                const gv = (gy - this.lastGy) / h;
                const impact = Math.max(0, -(this.vy - gv));
                const air = this.airTime;
                this.y = gy;
                this.vy = gv;
                this.grounded = true;
                const hard = impact > 9;
                if (hard) this.speed = Math.max(this.vmin * 0.6, this.speed * (1 - clamp((impact - 9) * 0.015, 0, 0.2)));
                if (air > 0.12) this.landT = 0.32;
                events.push({ type: 'land', air, impact, hard });
                this.airTime = 0;
            }
        }
        this.lastGy = gy;

        // --- Dangers (uniquement en course normale et hors invulnérabilité)
        if (this.phase === 'ride' && this.invuln <= 0) {
            const hit = c.collide(this.x, this.z, this.y);
            if (hit) {
                if (hit.hard) this._startFall(hit.kind, events);
                else {
                    this.speed = Math.max(this.vmin * 0.6, this.speed * 0.62);
                    this.vx *= -0.3;
                    this.stumbleT = 0.5;
                    this.invuln = 0.6;
                    events.push({ type: 'stumble', kind: hit.kind });
                }
            } else if (this.grounded && zone.ravine > 0.55) {
                this._startFall('ravine', events);
            }
        }

        // --- Franchissement des portes (interpolé : aucune porte ne peut être "sautée")
        if (c.gatesEnabled && this.phase !== 'fall') {
            while (this.z <= c.gateZ(this.nextGate)) {
                const gz = c.gateZ(this.nextGate);
                const f = zPrev === this.z ? 1 : (zPrev - gz) / (zPrev - this.z);
                const xc = xPrev + (this.x - xPrev) * clamp(f, 0, 1);
                const k = this.nextGate++;
                if (this.finishZ != null && gz <= this.finishZ + 12) continue;
                events.push({ type: 'gate', k, dx: xc - c.gateX(k), halfW: c.gateWidth(k) / 2, y: this.y });
            }
        } else if (c.gatesEnabled) {
            while (this.z <= c.gateZ(this.nextGate)) this.nextGate++;   // une chute fait manquer la porte sans la juger
        }

        // --- Pièces
        if (c.coinsOn && this.phase !== 'fall') {
            const n = c.pickCoins(this.x, this.y, this.z);
            if (n) events.push({ type: 'coin', n });
        }

        // --- Ligne d'arrivée
        if (this.finishZ != null && this.phase === 'ride' && this.z <= this.finishZ) {
            this.phase = 'finish';
            this.phaseT = 0;
            events.push({ type: 'finish' });
        }

        // --- Transitions de phase
        if (this.phase === 'fall' && this.phaseT >= PHYS.FALL_TIME) {
            this.phase = 'recover';
            this.phaseT = 0;
            // Reprise : on repose le skieur sur le couloir libre, un peu plus bas dans la pente
            this.z -= 4;
            this.x = c.laneX(this.z);
            this.vx = 0;
            this.speed = this.vmin;
            this.grounded = true;
            this.y = c.groundY(this.x, this.z);
            this.vy = 0;
            this.invuln = PHYS.INVULN_AFTER_FALL;
            this.stumbleT = 0;
            events.push({ type: 'recover' });
        } else if (this.phase === 'recover' && this.phaseT >= PHYS.RECOVER_TIME) {
            this.phase = 'ride';
            this.phaseT = 0;
        }
    }

    _startFall(cause, events) {
        this.phase = 'fall';
        this.phaseT = 0;
        this.fallCause = cause;
        this.skid = false;
        events.push({ type: 'fall', cause });
    }
}
