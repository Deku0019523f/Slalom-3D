// Avatar 3D articulé du skieur (entièrement procédural, aucun fichier externe).
//
// Squelette : bassin → buste (colonne) → cou/tête, deux jambes (cuisse, genou, mollet, chaussure rigide, fixation, ski)
// et deux bras (épaule, coude, avant-bras, gant, bâton). Jambes et bras sont placés par cinématique inverse à deux
// segments : le genou intérieur se plie plus que l'extérieur dans les virages, la position de schuss s'accroupit,
// et le bâton est planté au début de chaque virage.
import * as THREE from './vendor/three.module.min.js';
import { findItem, CATALOG, DEFAULT_LOADOUT } from './characters.js';
import { DEFAULT_AVATAR, AVATAR_STYLES } from './avatar-config.js';

const NEG_Y = new THREE.Vector3(0, -1, 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Longueurs des segments (unités du monde ≈ mètres)
const THIGH = 0.44, SHIN = 0.42, UPPER_ARM = 0.27, FOREARM = 0.25;
const STANCE = 0.17;          // demi-écart entre les skis
const ANKLE_H = 0.3;          // hauteur de la cheville au-dessus du ski
const SHOULDER_Y = 0.5, SHOULDER_X = 0.25;

// Vecteurs temporaires (aucune allocation par image)
const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion();
const _root = new THREE.Vector3(), _end = new THREE.Vector3(), _mid = new THREE.Vector3(), _pole = new THREE.Vector3();

/** Cinématique inverse à deux segments : calcule la position du genou/coude. Retourne l'axe orthogonal du pli. */
function solveTwoBone(root, end, l1, l2, pole, outMid) {
    _d.subVectors(end, root);
    let d = _d.length();
    const maxD = (l1 + l2) * 0.998;
    if (d > maxD) { end.copy(root).addScaledVector(_d, maxD / d); d = maxD; _d.subVectors(end, root); }
    d = Math.max(d, 0.2);
    _d.multiplyScalar(1 / Math.max(1e-6, _d.length()));
    const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const a = Math.acos(clamp(cosA, -1, 1));
    _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
    if (_p.lengthSq() < 1e-6) _p.set(0, 0, -1);
    _p.normalize();
    outMid.copy(root).addScaledVector(_d, l1 * Math.cos(a)).addScaledVector(_p, l1 * Math.sin(a));
    return _p;
}

/** Oriente un groupe (géométrie dirigée vers -Y) de `from` vers `to`. */
function aim(group, from, to) {
    _d.subVectors(to, from);
    if (_d.lengthSq() < 1e-8) return;
    _d.normalize();
    group.position.copy(from);
    group.quaternion.copy(_q.setFromUnitVectors(NEG_Y, _d));
}

/** Membre dont la géométrie part de l'origine vers -Y (longueur len). */
function limbGeometry(r, len) {
    const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 4, 10);
    g.translate(0, -len / 2, 0);
    return g;
}

export class SkierAvatar {
    constructor() {
        this.root = new THREE.Group();
        this.pivot = new THREE.Group();
        this.root.add(this.pivot);
        this.geos = new Set();
        this.mats = {};
        this.textures = [];
        this.bibNumber = DEFAULT_AVATAR.bib;
        this.style = DEFAULT_AVATAR.style;
        this.scarfLen = 6;
        this.loadout = null;
        this.s = { crouch: 0.15, lat: 0, tuck: 0, air: 0, plantL: 0, plantR: 0, leftOn: false, rightOn: false, t: 0 };
        this._build();
        this.apply(DEFAULT_LOADOUT, DEFAULT_AVATAR);
    }

    // ------------------------------------------------------------------ outils de construction
    _mat(name, color, opts = {}) {
        const m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...opts });
        this.mats[name] = m;
        return m;
    }
    _mesh(geo, mat, parent, { cast = true, pos, rot, scale } = {}) {
        this.geos.add(geo);
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = cast;
        if (pos) m.position.set(pos[0], pos[1], pos[2]);
        if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
        if (scale) m.scale.set(scale[0], scale[1], scale[2]);
        parent.add(m);
        return m;
    }

    _bibTexture() {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        this.bibCanvas = c;
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        this.textures.push(tex);
        this.bibTex = tex;
        this._drawBib();
        return tex;
    }

    _drawBib() {
        const c = this.bibCanvas, ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, 256, 256);
        const r = 26;
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.moveTo(r, 0); ctx.arcTo(256, 0, 256, 256, r); ctx.arcTo(256, 256, 0, 256, r); ctx.arcTo(0, 256, 0, 0, r); ctx.arcTo(0, 0, 256, 0, r);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 256, 54);
        ctx.fillStyle = '#f8fafc';
        ctx.font = '800 30px system-ui, "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('SLALOM', 128, 28);
        const txt = String(this.bibNumber);
        const size = txt.length >= 3 ? 112 : txt.length === 2 ? 150 : 180;
        ctx.fillStyle = '#0f172a';
        ctx.font = `900 ${size}px system-ui, "Segoe UI", Arial, sans-serif`;
        ctx.fillText(txt, 128, 156);
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 8;
        ctx.strokeRect(10, 10, 236, 236);
        this.bibTex.needsUpdate = true;
    }

    // ------------------------------------------------------------------ construction du squelette
    _build() {
        const M = {
            ski: this._mat('ski', 0xfacc15, { roughness: 0.3, metalness: 0.25 }),
            ski2: this._mat('ski2', 0xfacc15, { roughness: 0.3, metalness: 0.25 }),
            skiTop: this._mat('skiTop', 0x0f172a, { roughness: 0.4 }),
            boot: this._mat('boot', 0x111827, { roughness: 0.45 }),
            chrome: this._mat('chrome', 0xd1d5db, { roughness: 0.2, metalness: 0.9 }),
            pants: this._mat('pants', 0x0f172a, { roughness: 0.7 }),
            jacket: this._mat('jacket', 0xef4444, { roughness: 0.5 }),
            accent: this._mat('accent', 0xffffff, { roughness: 0.5 }),
            skin: this._mat('skin', 0xfdba74, { roughness: 0.7 }),
            hair: this._mat('hair', 0x3b2a1a, { roughness: 0.8 }),
            helmet: this._mat('helmet', 0x2563eb, { roughness: 0.22, metalness: 0.2 }),
            lens: this._mat('lens', 0x06b6d4, { roughness: 0.08, metalness: 0.85, emissive: 0x06b6d4, emissiveIntensity: 0.18, side: THREE.DoubleSide }),
            strap: this._mat('strap', 0x0f172a, { roughness: 0.6 }),
            glove: this._mat('glove', 0x111827, { roughness: 0.65 }),
            pole: this._mat('pole', 0xcbd5e1, { roughness: 0.3, metalness: 0.8 }),
            horn: this._mat('horn', 0xf1f5f9, { roughness: 0.45 }),
            cyber: this._mat('cyber', 0x22d3ee, { roughness: 0.3, emissive: 0x22d3ee, emissiveIntensity: 0.9 }),
            pompom: this._mat('pompom', 0xffffff, { roughness: 0.9 }),
            scarf: this._mat('scarf', 0xef4444, { roughness: 0.85, side: THREE.DoubleSide }),
            gaiter: this._mat('gaiter', 0x1e293b, { roughness: 0.85 }),
            pack: this._mat('pack', 0x334155, { roughness: 0.7 }),
            cape: this._mat('cape', 0xdc2626, { roughness: 0.8, side: THREE.DoubleSide })
        };
        const bibTex = this._bibTexture();
        const bibMat = this._mat('bib', 0xffffff, { map: bibTex, roughness: 0.8, transparent: true, side: THREE.FrontSide });
        const P = this.pivot;

        // ---- Skis (deux groupes indépendants : chacun porte fixation, chaussure et cheville)
        this.skis = [];
        this.ankleJoint = [];
        const skiBody = new THREE.BoxGeometry(0.11, 0.028, 1.5);
        const skiTip = new THREE.BoxGeometry(0.11, 0.026, 0.34);
        const skiTail = new THREE.BoxGeometry(0.11, 0.026, 0.14);
        const plate = new THREE.BoxGeometry(0.1, 0.022, 0.34);
        const toe = new THREE.BoxGeometry(0.07, 0.04, 0.07);
        const heel = new THREE.BoxGeometry(0.07, 0.045, 0.08);
        const sole = new THREE.BoxGeometry(0.112, 0.05, 0.36);
        const shell = new THREE.BoxGeometry(0.1, 0.13, 0.25);
        const cuff = new THREE.CylinderGeometry(0.056, 0.062, 0.15, 12);
        const buckle = new THREE.BoxGeometry(0.014, 0.014, 0.075);
        const bootToe = new THREE.BoxGeometry(0.1, 0.07, 0.12);
        [-1, 1].forEach((side, idx) => {
            const g = new THREE.Group();
            g.position.set(side * STANCE, 0.03, 0);
            const sm = idx === 0 ? M.ski : M.ski2;
            this._mesh(skiBody, sm, g);
            // spatule relevée et talon légèrement relevé
            this._mesh(skiTip, sm, g, { pos: [0, 0.055, -0.86], rot: [0.42, 0, 0] });
            this._mesh(skiTail, sm, g, { pos: [0, 0.018, 0.78], rot: [-0.18, 0, 0] });
            // liseré noir sur le dessus
            this._mesh(new THREE.BoxGeometry(0.03, 0.004, 1.5), M.skiTop, g, { cast: false, pos: [0, 0.016, 0] });
            // fixation
            this._mesh(plate, M.boot, g, { pos: [0, 0.025, 0.02] });
            this._mesh(toe, M.chrome, g, { pos: [0, 0.05, -0.15] });
            this._mesh(heel, M.chrome, g, { pos: [0, 0.052, 0.19] });
            // chaussure rigide : semelle, coque, languette, collerette et boucles chromées
            this._mesh(sole, M.boot, g, { pos: [0, 0.062, 0.02] });
            this._mesh(shell, M.boot, g, { pos: [0, 0.15, 0.06] });
            this._mesh(bootToe, M.boot, g, { pos: [0, 0.105, -0.14] });
            this._mesh(cuff, M.boot, g, { pos: [0, 0.27, 0.075] });
            [0.105, 0.16, 0.215].forEach((y, k) => {
                this._mesh(buckle, M.chrome, g, { cast: false, pos: [side * -0.052, y + (k === 2 ? 0.07 : 0), k === 2 ? 0.08 : -0.03], rot: [0, 0, 0] });
            });
            P.add(g);
            this.skis.push(g);
        });

        // ---- Bassin et buste
        this.hips = new THREE.Group();
        P.add(this.hips);
        this._mesh(new THREE.CapsuleGeometry(0.15, 0.06, 4, 10), M.pants, this.hips, { scale: [1.25, 0.8, 0.9], pos: [0, 0, 0] });

        this.torso = new THREE.Group();
        this.hips.add(this.torso);
        // Buste aérodynamique : capsule aplatie (épaules larges, profil mince)
        this._mesh(new THREE.CapsuleGeometry(0.19, 0.3, 6, 14), M.jacket, this.torso, { scale: [1.2, 1, 0.74], pos: [0, 0.3, 0] });
        this._mesh(new THREE.CapsuleGeometry(0.16, 0.1, 4, 10), M.jacket, this.torso, { scale: [1.12, 1, 0.72], pos: [0, 0.08, 0] });
        // Fermeture éclair + tirette
        this._mesh(new THREE.BoxGeometry(0.014, 0.5, 0.01), M.chrome, this.torso, { cast: false, pos: [0, 0.3, -0.148] });
        this._mesh(new THREE.BoxGeometry(0.03, 0.05, 0.016), M.chrome, this.torso, { cast: false, pos: [0, 0.5, -0.152] });
        // Bandes de course (poitrine, dos) et ceinture
        this._mesh(new THREE.BoxGeometry(0.5, 0.034, 0.3), M.accent, this.torso, { cast: false, pos: [0, 0.4, 0] });
        this._mesh(new THREE.BoxGeometry(0.5, 0.016, 0.3), M.accent, this.torso, { cast: false, pos: [0, 0.34, 0] });
        this._mesh(new THREE.BoxGeometry(0.4, 0.03, 0.27), M.accent, this.torso, { cast: false, pos: [0, 0.0, 0] });
        // Dossard (avant et dos) : plan texturé, numéro dynamique
        const bibGeo = new THREE.PlaneGeometry(0.25, 0.25);
        this._mesh(bibGeo, bibMat, this.torso, { cast: false, pos: [0, 0.22, -0.158], rot: [0, Math.PI, 0] });
        this._mesh(bibGeo, bibMat, this.torso, { cast: false, pos: [0, 0.22, 0.158] });
        this.packAnchor = new THREE.Group();
        this.torso.add(this.packAnchor);

        // ---- Cou, cache-cou, écharpe multi-segments
        this._mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.13, 12), M.gaiter, this.torso, { pos: [0, 0.6, 0] });
        this._mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 16), M.gaiter, this.torso, { pos: [0, 0.57, 0], rot: [Math.PI / 2, 0, 0] });
        this.scarf = new THREE.Group();
        this.scarf.position.set(0.0, 0.58, 0.07);
        this.torso.add(this.scarf);
        this.scarfSegs = [];
        const segGeo = new THREE.BoxGeometry(0.115, 0.012, 0.105);
        let parent = this.scarf;
        for (let i = 0; i < 10; i++) {
            const seg = new THREE.Group();
            if (i > 0) seg.position.set(0, 0, 0.1);     // les segments se suivent le long de -Y local ; voir setPose
            const m = this._mesh(segGeo, M.scarf, seg, { cast: false, pos: [0, 0, 0.0] });
            m.position.set(0, -0.052, 0);
            m.rotation.x = Math.PI / 2;
            if (i > 0) seg.position.set(0, -0.1, 0);
            parent.add(seg);
            this.scarfSegs.push(seg);
            parent = seg;
        }

        // ---- Tête
        this.neck = new THREE.Group();
        this.neck.position.set(0, 0.66, 0);
        this.torso.add(this.neck);
        this.head = new THREE.Group();
        this.head.position.set(0, 0.1, 0);
        this.neck.add(this.head);
        this._mesh(new THREE.SphereGeometry(0.145, 16, 14), M.skin, this.head, { pos: [0, 0.0, 0] });
        // Nez et menton (profil lisible)
        this._mesh(new THREE.SphereGeometry(0.03, 8, 8), M.skin, this.head, { cast: false, pos: [0, -0.015, -0.14] });

        // Casque pro : calotte, liseré, mentonnière
        this.proHelmet = new THREE.Group();
        this.head.add(this.proHelmet);
        this._mesh(new THREE.SphereGeometry(0.185, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.64), M.helmet, this.proHelmet, { pos: [0, 0.02, 0.01] });
        this._mesh(new THREE.TorusGeometry(0.186, 0.012, 6, 28, Math.PI * 2), M.accent, this.proHelmet, { cast: false, pos: [0, 0.092, 0.01], rot: [Math.PI / 2, 0, 0] });
        this._mesh(new THREE.TorusGeometry(0.112, 0.024, 8, 18, Math.PI), M.helmet, this.proHelmet, { pos: [0, -0.09, -0.02], rot: [-Math.PI / 2, 0, 0] });
        // Masque panoramique à effet miroir + bandeau
        const lensArc = 2.5;
        this._mesh(new THREE.CylinderGeometry(0.192, 0.192, 0.095, 24, 1, true, Math.PI - lensArc / 2, lensArc), M.lens, this.head, { cast: false, pos: [0, 0.025, 0.0] });
        this._mesh(new THREE.TorusGeometry(0.192, 0.01, 6, 28), M.strap, this.head, { cast: false, pos: [0, 0.025, 0.0], rot: [Math.PI / 2, 0, 0] });
        this._mesh(new THREE.BoxGeometry(0.1, 0.03, 0.03), M.strap, this.head, { cast: false, pos: [0, -0.03, -0.19] });

        // Styles d'accessoires du casque
        this.styles = {};
        const classic = new THREE.Group();
        this._mesh(new THREE.BoxGeometry(0.05, 0.012, 0.3), M.accent, classic, { cast: false, pos: [0, 0.2, 0.0] });
        this._mesh(new THREE.BoxGeometry(0.1, 0.02, 0.05), M.helmet, classic, { pos: [0, 0.075, 0.18], rot: [0.5, 0, 0] });
        this.styles.classic = classic;
        const crest = new THREE.Group();
        const finShape = new THREE.Shape();
        finShape.moveTo(-0.18, 0); finShape.lineTo(-0.12, 0.1); finShape.lineTo(0.02, 0.2); finShape.lineTo(0.2, 0.07); finShape.lineTo(0.22, 0); finShape.closePath();
        const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.04, bevelEnabled: false });
        finGeo.translate(0, 0, -0.02);
        finGeo.rotateY(Math.PI / 2);   // le profil (x) s'étire alors le long de l'axe avant-arrière (z)
        this._mesh(finGeo, M.helmet, crest, { pos: [0, 0.16, 0.0] });
        this._mesh(new THREE.BoxGeometry(0.042, 0.012, 0.3), M.accent, crest, { cast: false, pos: [0, 0.175, 0.04] });
        this.styles.crest = crest;
        const cyber = new THREE.Group();
        const earGeo = new THREE.ConeGeometry(0.065, 0.2, 3);
        const earIn = new THREE.ConeGeometry(0.035, 0.12, 3);
        for (const s of [-1, 1]) {
            this._mesh(earGeo, M.helmet, cyber, { pos: [s * 0.14, 0.19, 0.0], rot: [0, 0, -s * 0.32] });
            this._mesh(earIn, M.cyber, cyber, { cast: false, pos: [s * 0.14, 0.17, -0.025], rot: [0, 0, -s * 0.32] });
        }
        this._mesh(new THREE.TorusGeometry(0.19, 0.008, 6, 28), M.cyber, cyber, { cast: false, pos: [0, 0.01, 0.01], rot: [Math.PI / 2, 0, 0] });
        this.styles.cyber = cyber;
        const viking = new THREE.Group();
        const hornA = new THREE.CylinderGeometry(0.03, 0.055, 0.15, 10);
        const hornB = new THREE.CylinderGeometry(0.008, 0.03, 0.15, 10);
        for (const s of [-1, 1]) {
            const h = new THREE.Group();
            h.position.set(s * 0.17, 0.08, 0);
            h.rotation.z = -s * 1.15;
            this._mesh(hornA, M.horn, h, { pos: [0, 0.075, 0] });
            const tip = new THREE.Group();
            tip.position.set(0, 0.15, 0);
            tip.rotation.z = s * 0.7;
            this._mesh(hornB, M.horn, tip, { pos: [0, 0.075, 0] });
            h.add(tip);
            viking.add(h);
        }
        this.styles.viking = viking;
        Object.values(this.styles).forEach(g => { g.visible = false; this.proHelmet.add(g); });

        // Bonnet (équipement du catalogue)
        this.beanie = new THREE.Group();
        this._mesh(new THREE.SphereGeometry(0.175, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), M.helmet, this.beanie, { pos: [0, 0.03, 0.01] });
        this._mesh(new THREE.SphereGeometry(0.06, 10, 10), M.pompom, this.beanie, { pos: [0, 0.2, 0.01] });
        this.beanie.visible = false;
        this.head.add(this.beanie);

        // Cheveux (selon le personnage)
        this.hairs = {};
        const pony = new THREE.Group();
        this._mesh(new THREE.SphereGeometry(0.06, 8, 8), M.hair, pony, { pos: [0, 0.03, 0.19] });
        this._mesh(new THREE.ConeGeometry(0.05, 0.3, 7), M.hair, pony, { pos: [0, -0.07, 0.3], rot: [Math.PI / 2 + 0.55, 0, 0] });
        this.hairs.ponytail = pony;
        const fur = new THREE.Group();
        this._mesh(new THREE.SphereGeometry(0.16, 10, 8), M.hair, fur, { pos: [0, -0.07, 0.07], scale: [1.18, 0.9, 1.1] });
        this.hairs.fur = fur;
        const shortHair = new THREE.Group();
        this._mesh(new THREE.SphereGeometry(0.15, 10, 8, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.35), M.hair, shortHair, { pos: [0, 0.0, 0.075], scale: [1, 1, 1] });
        this.hairs.short = shortHair;
        Object.values(this.hairs).forEach(h => { h.visible = false; this.head.add(h); });

        // ---- Jambes (cuisse, genou + genouillère, mollet) : placées par cinématique inverse dans setPose
        this.legs = [];
        const thighGeo = limbGeometry(0.078, THIGH), shinGeo = limbGeometry(0.058, SHIN);
        const padGeo = new THREE.SphereGeometry(0.075, 10, 8);
        [-1, 1].forEach((side) => {
            const thigh = new THREE.Group(), shin = new THREE.Group();
            this._mesh(thighGeo, M.pants, thigh);
            this._mesh(new THREE.CylinderGeometry(0.081, 0.081, 0.04, 12), M.accent, thigh, { cast: false, pos: [0, -0.16, 0] });
            this._mesh(shinGeo, M.pants, shin);
            const pad = this._mesh(padGeo, M.accent, P, { scale: [1, 1, 0.7] });
            P.add(thigh, shin);
            this.legs.push({ side, thigh, shin, pad, knee: new THREE.Vector3(), hip: new THREE.Vector3(), ankle: new THREE.Vector3() });
        });

        // ---- Bras et bâtons
        this.arms = [];
        const upGeo = limbGeometry(0.052, UPPER_ARM), foreGeo = limbGeometry(0.044, FOREARM);
        const gloveGeo = new THREE.SphereGeometry(0.058, 10, 8);
        const poleGeo = new THREE.CylinderGeometry(0.012, 0.009, 1.12, 6);
        poleGeo.translate(0, -0.5, 0);
        const basketGeo = new THREE.TorusGeometry(0.05, 0.006, 6, 12);
        const gripGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8);
        [-1, 1].forEach((side) => {
            const up = new THREE.Group(), fore = new THREE.Group();
            this._mesh(upGeo, M.jacket, up);
            this._mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.03, 10), M.accent, up, { cast: false, pos: [0, -0.12, 0] });
            this._mesh(foreGeo, M.jacket, fore);
            const hand = new THREE.Group();
            this._mesh(gloveGeo, M.glove, hand);
            this._mesh(gripGeo, M.strap, hand, { cast: false, pos: [0, 0.0, 0] });
            const pole = new THREE.Group();
            this._mesh(poleGeo, M.pole, pole, { cast: false });
            this._mesh(basketGeo, M.boot, pole, { cast: false, pos: [0, -1.02, 0], rot: [Math.PI / 2, 0, 0] });
            hand.add(pole);
            this.torso.add(up, fore, hand);
            this.arms.push({ side, up, fore, hand, pole, elbow: new THREE.Vector3(), target: new THREE.Vector3() });
        });

        // ---- Accessoires du catalogue : sac à dos et cape
        const pack = new THREE.Group();
        this._mesh(new THREE.BoxGeometry(0.34, 0.44, 0.17), M.pack, pack, { pos: [0, 0.3, 0.24] });
        this._mesh(new THREE.BoxGeometry(0.26, 0.14, 0.05), M.accent, pack, { cast: false, pos: [0, 0.22, 0.34] });
        pack.visible = false;
        this.torso.add(pack);
        const cape = new THREE.Group();
        this.capeFlap = new THREE.Group();
        this.capeFlap.position.set(0, 0.52, 0.17);
        this._mesh(new THREE.PlaneGeometry(0.5, 0.85), M.cape, this.capeFlap, { pos: [0, -0.4, 0] });
        cape.add(this.capeFlap);
        cape.visible = false;
        this.torso.add(cape);
        this.acc = { backpack: pack, cape };
    }

    // ------------------------------------------------------------------ équipement et personnalisation
    /**
     * @param loadout équipement du catalogue (ids validés)
     * @param custom  personnalisation libre de l'onglet « Avatar 3D » : { jacket, skis, mask, helmet, bib, style }
     */
    apply(loadout, custom = DEFAULT_AVATAR) {
        this.loadout = { ...loadout };
        const cu = { ...DEFAULT_AVATAR, ...(custom || {}) };
        const ch = findItem('character', loadout.character) || CATALOG.character[0];
        const of = findItem('outfit', loadout.outfit) || CATALOG.outfit[0];
        const sk = findItem('skis', loadout.skis) || CATALOG.skis[0];
        const he = findItem('helmet', loadout.helmet) || CATALOG.helmet[0];
        const ac = findItem('accessory', loadout.accessory) || CATALOG.accessory[0];
        const M = this.mats;
        const col = (m, hex) => m.color.set(hex);

        this.root.scale.set(ch.scale[0], ch.scale[1], ch.scale[2]);
        M.skin.color.setHex(ch.skin);
        M.hair.color.setHex(ch.hairColor);
        Object.entries(this.hairs).forEach(([k, g]) => { g.visible = k === ch.hair && !(k === 'short' && he.kind !== 'beanie'); });

        M.jacket.color.setHex(of.jacket);
        M.pants.color.setHex(of.pants);
        M.accent.color.setHex(of.accent);
        M.scarf.color.setHex(of.accent === 0xffffff ? of.jacket : of.accent);
        M.cape.color.setHex(of.jacket);
        M.ski.color.setHex(sk.color);
        M.ski2.color.setHex(sk.color2);
        M.helmet.color.setHex(he.color);
        M.lens.color.setHex(0x06b6d4);
        M.lens.emissive.setHex(0x06b6d4);

        // Personnalisation libre : remplace les couleurs du catalogue quand elle est définie
        if (cu.jacket) { col(M.jacket, cu.jacket); M.cape.color.set(cu.jacket); if (of.accent === 0xffffff) M.scarf.color.set(cu.jacket); }
        if (cu.skis) { col(M.ski, cu.skis); col(M.ski2, cu.skis); }
        if (cu.mask) { col(M.lens, cu.mask); col(M.lens.emissive, cu.mask); }
        if (cu.helmet) col(M.helmet, cu.helmet);

        // Casque : calotte pro (+ style), bonnet ou casque viking du catalogue
        const beanie = he.kind === 'beanie';
        this.proHelmet.visible = !beanie;
        this.beanie.visible = beanie;
        const style = he.kind === 'viking' ? 'viking' : (AVATAR_STYLES.some(s => s.id === cu.style) ? cu.style : 'classic');
        this.style = style;
        Object.entries(this.styles).forEach(([k, g]) => { g.visible = k === style; });

        this.scarfLen = ac.kind === 'scarf' ? 10 : 6;
        this.scarfSegs.forEach((seg, i) => { seg.visible = i < this.scarfLen; });
        Object.entries(this.acc).forEach(([k, g]) => { g.visible = ac.kind === k; });

        this.setBib(cu.bib);
    }

    setBib(n) {
        const v = Math.round(clamp(Number(n) || 0, 0, 999));
        if (v === this.bibNumber && this._bibDrawn) return;
        this.bibNumber = v;
        this._bibDrawn = true;
        this._drawBib();
    }

    // ------------------------------------------------------------------ animation procédurale
    /**
     * Pose du skieur à chaque image.
     * tilt : inclinaison latérale (rad) ; yaw : orientation ; pitch : suit la pente ; crouch 0..1 ; tumble : rotation de chute ;
     * lift : décollage visuel ; arm : amplitude de balancement (chute) ; speedRatio 0..1 ; time (s) ;
     * lat -1..1 : intention de virage ; tuck 0..1 : position de schuss ; air : en l'air ; cheer : bras levés.
     */
    setPose(pose) {
        const { tilt = 0, yaw = 0, pitch = 0, crouch = 0, tumble = 0, lift = 0, arm = 0, speedRatio = 0, time = 0, lat = 0, tuck = 0, air = false, cheer = false } = pose;
        const s = this.s;
        const dt = clamp(time - s.t, 0.0005, 0.1);
        s.t = time;
        const k = (rate) => Math.min(1, dt * rate);
        s.lat += (lat - s.lat) * k(9);
        s.crouch += (crouch - s.crouch) * k(10);
        s.tuck += (tuck - s.tuck) * k(4);
        s.air += ((air ? 1 : 0) - s.air) * k(12);
        const L = s.lat, aL = Math.abs(L);

        // Détection du début de virage → planté de bâton (côté du virage)
        if (L > 0.38 && !s.rightOn) { s.rightOn = true; s.plantR = 1; }
        if (L < 0.15) s.rightOn = false;
        if (L < -0.38 && !s.leftOn) { s.leftOn = true; s.plantL = 1; }
        if (L > -0.15) s.leftOn = false;
        s.plantR = Math.max(0, s.plantR - dt * 3.2);
        s.plantL = Math.max(0, s.plantL - dt * 3.2);
        const envR = Math.sin(Math.PI * (1 - s.plantR)) * (s.plantR > 0 ? 1 : 0);
        const envL = Math.sin(Math.PI * (1 - s.plantL)) * (s.plantL > 0 ? 1 : 0);

        // Pivot : suit la pente, le roulis est réparti entre le corps (55 %) et les skis (45 %, prise de carre)
        this.pivot.rotation.set(pitch + tumble, yaw, tilt * 0.55, 'YXZ');
        this.pivot.position.y = lift;
        const edge = tilt * 0.45;
        const innerSide = Math.sign(L);                // +1 : virage à droite → ski droit à l'intérieur
        this.skis.forEach((ski, i) => {
            const side = i === 0 ? -1 : 1;
            const inner = side === innerSide ? aL : 0;
            ski.rotation.z = edge * (1 + 0.25 * inner);
            ski.position.x = side * STANCE;
            ski.position.y = 0.03 + 0.03 * inner + 0.2 * s.air;
            ski.position.z = -0.05 * inner - 0.04 * s.air;
            ski.rotation.x = -0.18 * s.air;
        });

        // Bassin : plus bas et plus en arrière en schuss, décalé vers l'intérieur du virage (angulation)
        const stance = clamp(s.crouch + 0.12 * s.air, 0, 1);
        const hipY = 0.99 - 0.3 * stance - 0.12 * s.tuck;
        const hipZ = 0.1 + 0.13 * stance + 0.17 * s.tuck;
        const hipX = L * 0.17;
        this.hips.position.set(hipX, hipY, hipZ);
        this.hips.rotation.set(0, 0, 0);
        this.torso.position.set(0, 0.05, 0);
        this.torso.rotation.set(-0.2 - 0.42 * stance - 0.5 * s.tuck, -yaw * 0.55, -tilt * 0.3 + L * 0.0, 'YXZ');
        this.head.rotation.set(0.16 + 0.8 * (0.42 * stance + 0.5 * s.tuck) - 0.05, -L * 0.28 + yaw * 0.55, 0);

        // Jambes : cinématique inverse (hanche → cheville), le genou intérieur se plie davantage
        for (let i = 0; i < 2; i++) {
            const leg = this.legs[i], side = leg.side, ski = this.skis[i];
            leg.hip.set(hipX + side * 0.095, hipY - 0.02, hipZ);
            const phi = ski.rotation.z;
            leg.ankle.set(ski.position.x - Math.sin(phi) * ANKLE_H, ski.position.y + Math.cos(phi) * ANKLE_H, ski.position.z + 0.055);
            _root.copy(leg.hip);
            _end.copy(leg.ankle);
            _pole.set(side * 0.12 - L * 0.08, 0, -1);
            const bend = solveTwoBone(_root, _end, THIGH, SHIN, _pole, leg.knee);
            aim(leg.thigh, leg.hip, leg.knee);
            aim(leg.shin, leg.knee, _end);
            leg.pad.position.copy(leg.knee).addScaledVector(bend, 0.07);
            leg.pad.rotation.set(0, 0, 0);
        }

        // Bras : mains vers des cibles exprimées dans le repère du buste
        const sw = Math.sin(time * 24) * arm * 0.25, sw2 = Math.cos(time * 19) * arm * 0.22;
        for (let i = 0; i < 2; i++) {
            const a = this.arms[i], side = a.side;
            const plant = side > 0 ? envR : envL;
            const t = a.target;
            // position de base : mains devant, bâtons dirigés vers l'arrière ; schuss : mains rapprochées sous le menton
            t.set(side * (0.34 - 0.18 * s.tuck), 0.3 - 0.14 * s.tuck, -0.36 - 0.06 * s.tuck);
            // planté de bâton : la main part vers l'avant et vers le bas
            t.x += side * 0.1 * plant;
            t.y -= 0.2 * plant;
            t.z -= 0.3 * plant;
            // chute / acclamation
            t.y += sw * 0.9 + (cheer ? 0.62 : 0);
            t.x += sw2 * side * 1.0 + (cheer ? side * 0.05 : 0);
            t.z += sw * 0.5 + (cheer ? 0.25 : 0);
            _root.set(side * SHOULDER_X, SHOULDER_Y, 0);
            _end.copy(t);
            _pole.set(side * 0.7, -0.45, 0.5);
            solveTwoBone(_root, _end, UPPER_ARM, FOREARM, _pole, a.elbow);
            aim(a.up, _root, a.elbow);
            aim(a.fore, a.elbow, _end);
            a.hand.position.copy(_end);
            // inclinaison du bâton : pointe vers l'arrière au repos, vers l'avant lors du planté
            const poleTilt = cheer ? -0.4 : -1.0 + 1.08 * plant + (1 - Math.min(1, s.tuck)) * 0 - 0.3 * s.tuck;
            a.pole.rotation.set(poleTilt - this.torso.rotation.x * 0.7 + sw, 0, side * (0.1 + 0.08 * aL));
        }

        // Écharpe : chaîne de segments qui flotte vers l'arrière et ondule avec la vitesse
        // Le premier segment part vers l'arrière (horizontal à grande vitesse), les suivants retombent légèrement en ondulant
        const target = -(0.95 + 0.5 * speedRatio);
        for (let i = 0; i < this.scarfSegs.length; i++) {
            const seg = this.scarfSegs[i];
            const wave = Math.sin(time * 13 - i * 0.85) * 0.16 * (0.4 + speedRatio);
            seg.rotation.x = (i === 0 ? target - this.torso.rotation.x : 0.2 - 0.05 * speedRatio) + wave;
            seg.rotation.z = Math.sin(time * 9.5 - i * 0.7) * 0.2 * (0.3 + speedRatio) + L * 0.2;
        }
        this.capeFlap.rotation.x = -0.15 - speedRatio * 0.85 + Math.sin(time * 18) * 0.07 * speedRatio;
    }

    dispose() {
        this.geos.forEach(g => g.dispose());
        Object.values(this.mats).forEach(m => m.dispose());
        this.textures.forEach(t => t.dispose());
    }
}

/** Fabrique l'avatar articulé complet (squelette, matériaux, dossard, animations procédurales). */
export function createArticulatedSkierAvatar() {
    return new SkierAvatar();
}
