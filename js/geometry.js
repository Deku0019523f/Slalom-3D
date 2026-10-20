// Outils de géométrie procédurale : fusion de pièces colorées (un seul draw call par modèle),
// déformation déterministe, textures générées par canevas.
import * as THREE from './vendor/three.module.min.js';

const _tmpColor = new THREE.Color();

/** Couleur (hex, CSS ou THREE.Color) → [r, g, b] dans l'espace de travail linéaire de Three.js. */
export function rgb(c) {
    _tmpColor.set(c);
    return [_tmpColor.r, _tmpColor.g, _tmpColor.b];
}

/** Décrit une pièce à fusionner : géométrie + couleur (ou fonction de couleur) + matrice optionnelle. */
export function part(geometry, color, matrix = null, opts = {}) {
    return { geometry, color, matrix, flat: !!opts.flat, colorFn: opts.colorFn || null };
}

/** Fusionne plusieurs pièces en une géométrie non indexée avec attribut "color" (vertexColors). */
export function mergeParts(parts) {
    const pos = [], nor = [], col = [];
    for (const p of parts) {
        let g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone();
        if (p.matrix) g.applyMatrix4(p.matrix);
        if (p.flat) g.computeVertexNormals();
        const P = g.attributes.position;
        const N = g.attributes.normal;
        const base = p.colorFn ? null : rgb(p.color);
        for (let i = 0; i < P.count; i++) {
            const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
            pos.push(x, y, z);
            nor.push(N.getX(i), N.getY(i), N.getZ(i));
            if (base) col.push(base[0], base[1], base[2]);
            else { const c = p.colorFn(x, y, z); col.push(c[0], c[1], c[2]); }
        }
        g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
}

/** Déplace chaque sommet de façon déterministe (les sommets confondus bougent ensemble). */
export function jitterGeometry(geo, amount, seed = 1) {
    const P = geo.attributes.position;
    for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        // Coordonnées quantifiées : les sommets confondus (coutures, sommet du cône) reçoivent exactement le même décalage
        const qx = Math.round(x * 50) / 50, qy = Math.round(y * 50) / 50, qz = Math.round(z * 50) / 50;
        const h = (a, b) => {
            const s = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453;
            return s - Math.floor(s) - 0.5;
        };
        P.setXYZ(i,
            x + h(qy + qz, qx) * amount,
            y + h(qx + qz, qy) * amount,
            z + h(qx + qy, qz) * amount);
    }
    P.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
}

/** Matrice de transformation : translation + rotation Y + échelle + cisaillement (suit la pente du terrain). */
export function composeMatrix(out, x, y, z, ry, sx, sy, sz, shear = 0) {
    const c = Math.cos(ry), s = Math.sin(ry);
    out.set(
        c * sx, 0, s * sz, x,
        0, sy, shear * sz, y,
        -s * sx, 0, c * sz, z,
        0, 0, 0, 1
    );
    return out;
}

/** Texture de neige procédurale : fines variations + scintillements (aucun fichier externe). */
export function makeSnowTexture(size = 256) {
    const cvs = document.createElement('canvas');
    cvs.width = cvs.height = size;
    const ctx = cvs.getContext('2d');
    ctx.fillStyle = '#f4f7fb';
    ctx.fillRect(0, 0, size, size);
    // Grandes ondulations douces (vents / tassement)
    for (let i = 0; i < 140; i++) {
        const x = Math.random() * size, y = Math.random() * size, r = 14 + Math.random() * 46;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const dark = Math.random() < 0.5;
        g.addColorStop(0, dark ? 'rgba(180,200,225,0.20)' : 'rgba(255,255,255,0.30)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
            ctx.save(); ctx.translate(ox, oy); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
    }
    // Grain fin
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 14;
        img.data[i] = Math.min(255, Math.max(0, img.data[i] + n));
        img.data[i + 1] = Math.min(255, Math.max(0, img.data[i + 1] + n));
        img.data[i + 2] = Math.min(255, Math.max(0, img.data[i + 2] + n * 0.9));
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cvs);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

/** Disque lumineux doux (flocons, halos de lampadaires). */
export function makeSoftDiscTexture(size = 64, inner = 0.0) {
    const cvs = document.createElement('canvas');
    cvs.width = cvs.height = size;
    const ctx = cvs.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, size * inner, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

/** Bannière (DÉPART / ARRIVÉE) dessinée sur un canevas. */
export function makeBannerTexture(text, { bg = '#1d4ed8', fg = '#ffffff', checker = false } = {}) {
    const w = 1024, h = 160;
    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (checker) {
        const s = 20;
        for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) {
            if (((x / s) + (y / s)) % 2 === 0 && (y < s * 1.5 || y > h - s * 1.5)) {
                ctx.fillStyle = '#0f172a'; ctx.fillRect(x, y, s, s);
            }
        }
    }
    ctx.fillStyle = fg;
    ctx.font = '900 96px Montserrat, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}
