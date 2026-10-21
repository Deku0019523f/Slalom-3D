// Scène Three.js : rendu, éclairage, ciel, montagnes lointaines, terrain par segments recyclés,
// flocons, projections de neige et traces de ski.
import * as THREE from './vendor/three.module.min.js';
import { CHUNK_LEN, clamp, lerp, smoothstep, noise2, mulberry32 } from './tracks.js';
import { part, mergeParts, jitterGeometry, composeMatrix, makeSnowTexture, makeSoftDiscTexture, rgb } from './geometry.js';
import { CourseRenderer } from './obstacles.js';

const OUTER_OFFSETS = [1.5, 3, 4, 6, 8.5, 12, 17, 24, 34, 48, 66, 90, 120, 160, 220];

// ---------------------------------------------------------------------------
// Matériau de particules (flocons, projections) : taille en perspective, fondu, brouillard
// ---------------------------------------------------------------------------
function makeParticleMaterial(tex, withAlphaAttr) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uMap: { value: tex },
            uScale: { value: 400 },
            uColor: { value: new THREE.Color(0xffffff) },
            uFogColor: { value: new THREE.Color(0xdbeafe) },
            uFogDensity: { value: 0.006 },
            uOpacity: { value: 0.9 }
        },
        vertexShader: `
            attribute float aSize;
            ${withAlphaAttr ? 'attribute float aAlpha; varying float vA;' : ''}
            uniform float uScale;
            uniform float uFogDensity;
            varying float vFog;
            void main() {
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mv;
                float d = max(0.5, -mv.z);
                gl_PointSize = clamp(aSize * uScale / d, 0.0, 64.0);
                vFog = 1.0 - exp(-pow(uFogDensity * d, 2.0));
                ${withAlphaAttr ? 'vA = aAlpha;' : ''}
            }`,
        fragmentShader: `
            uniform sampler2D uMap;
            uniform vec3 uColor;
            uniform vec3 uFogColor;
            uniform float uOpacity;
            varying float vFog;
            ${withAlphaAttr ? 'varying float vA;' : ''}
            void main() {
                float a = texture2D(uMap, gl_PointCoord).a * uOpacity * ${withAlphaAttr ? 'vA' : '1.0'};
                a *= (1.0 - vFog * 0.75);
                if (a < 0.01) discard;
                gl_FragColor = vec4(mix(uColor, uFogColor, vFog), a);
                #include <colorspace_fragment>
            }`,
        transparent: true,
        depthWrite: false
    });
}

// ---------------------------------------------------------------------------
// Segment de terrain recyclable
// ---------------------------------------------------------------------------
class TerrainSlot {
    constructor(group, layout, material, lineMaterial) {
        this.index = null;
        this.layout = layout;
        const { nCols, nRows } = layout;
        const nV = nCols * nRows;
        this.pos = new Float32Array(nV * 3);
        this.nor = new Float32Array(nV * 3);
        this.col = new Float32Array(nV * 3);
        this.uv = new Float32Array(nV * 2);
        this.geo = new THREE.BufferGeometry();
        this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
        this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
        this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
        this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
        this.geo.setIndex(layout.index);
        this.mesh = new THREE.Mesh(this.geo, material);
        this.mesh.receiveShadow = true;
        this.mesh.frustumCulled = false;
        group.add(this.mesh);

        // Lignes de bord de piste (deux rubans bleus)
        this.linePos = new Float32Array(nRows * 4 * 3);
        this.lineGeo = new THREE.BufferGeometry();
        this.lineGeo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
        const idx = [];
        for (let s = 0; s < 2; s++) {
            for (let r = 0; r < nRows - 1; r++) {
                const a = s * nRows * 2 + r * 2;
                idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
            }
        }
        this.lineGeo.setIndex(idx);
        this.lineMesh = new THREE.Mesh(this.lineGeo, lineMaterial);
        this.lineMesh.frustumCulled = false;
        group.add(this.lineMesh);
    }
    dispose() {
        this.geo.dispose();
        this.lineGeo.dispose();
    }
}

export class SceneManager {
    constructor(canvas, profile) {
        this.canvas = canvas;
        this.profile = profile;
        this.renderScale = 1;
        this.fovBase = 62;
        this.onContextLost = null;
        this.onContextRestored = null;

        this.renderer = new THREE.WebGLRenderer({
            canvas, antialias: !!profile.antialias, powerPreference: 'high-performance', alpha: false
        });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.setClearColor(0xdbeafe, 1);
        canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (this.onContextLost) this.onContextLost(); });
        canvas.addEventListener('webglcontextrestored', () => { if (this.onContextRestored) this.onContextRestored(); });

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0xdbeafe, 0.006);
        this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1600);
        this.camera.position.set(0, 6, 12);

        // Lumières
        this.hemi = new THREE.HemisphereLight(0xffffff, 0x93c5fd, 1.5);
        this.scene.add(this.hemi);
        this.sun = new THREE.DirectionalLight(0xfffbeb, 2.6);
        this.sunOffset = new THREE.Vector3(35, 62, 34);
        this.sun.castShadow = true;
        const d = 48;
        Object.assign(this.sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 10, far: 220 });
        this.sun.shadow.bias = -0.0006;
        this.sun.shadow.normalBias = 0.05;
        this.scene.add(this.sun, this.sun.target);
        this.lamp = new THREE.SpotLight(0xfff0cc, 0, 110, 0.55, 0.65, 1.1);
        this.lamp.visible = false;
        this.scene.add(this.lamp, this.lamp.target);

        // Textures et matériaux partagés
        this.snowTex = makeSnowTexture(256);
        this.groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: this.snowTex, roughness: 0.9, metalness: 0 });
        this.lineMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        this.softTex = makeSoftDiscTexture(64);

        this._buildSky();
        this.mountains = null;
        this.mountainMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
        this.mountainGroup = new THREE.Group();
        this.scene.add(this.mountainGroup);

        this.terrainGroup = new THREE.Group();
        this.scene.add(this.terrainGroup);
        this.slots = [];
        this.layout = null;

        this.courseRenderer = new CourseRenderer(this.scene, profile);
        this._buildParticles();
        this._buildTrails();

        this.course = null;
        this.amb = null;
        this.frameAvg = 1 / 60;
        this.adaptT = 0;
        this.upT = 0;
        this.applyProfile(profile);
        this.resize();
    }

    // ------------------------------------------------------------------ ciel & montagnes
    _buildSky() {
        const geo = new THREE.SphereGeometry(1200, 24, 14);
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
        this.skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
        this.sky = new THREE.Mesh(geo, this.skyMat);
        this.sky.renderOrder = -20;
        this.sky.frustumCulled = false;
        this.scene.add(this.sky);

        // Halo solaire / lune
        this.glowMat = new THREE.MeshBasicMaterial({ map: this.softTex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
        this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glowMat);
        this.glow.renderOrder = -19;
        this.glow.frustumCulled = false;
        this.scene.add(this.glow);

        // Étoiles
        const n = 420, p = new Float32Array(n * 3), sz = new Float32Array(n);
        const rng = mulberry32(31337);
        for (let i = 0; i < n; i++) {
            const a = rng() * Math.PI * 2, e = 0.08 + rng() * 0.92;
            const r = 1100;
            p[i * 3] = Math.cos(a) * Math.sqrt(1 - e * e) * r;
            p[i * 3 + 1] = e * r;
            p[i * 3 + 2] = Math.sin(a) * Math.sqrt(1 - e * e) * r;
            sz[i] = 1.2 + rng() * 2.2;
        }
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.BufferAttribute(p, 3));
        sg.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
        this.starMat = makeParticleMaterial(this.softTex, false);
        this.starMat.uniforms.uFogDensity.value = 0;
        this.starMat.uniforms.uScale.value = 1100;
        this.starMat.uniforms.uOpacity.value = 0.95;
        this.stars = new THREE.Points(sg, this.starMat);
        this.stars.renderOrder = -18;
        this.stars.frustumCulled = false;
        this.stars.visible = false;
        this.scene.add(this.stars);
    }

    _applySky(amb) {
        const top = new THREE.Color(amb.skyTop), hor = new THREE.Color(amb.skyHorizon), c = new THREE.Color();
        const P = this.sky.geometry.attributes.position, C = this.sky.geometry.attributes.color;
        for (let i = 0; i < P.count; i++) {
            const t = clamp(P.getY(i) / 1200, 0, 1);
            c.copy(hor).lerp(top, Math.pow(t, 0.55));
            C.setXYZ(i, c.r, c.g, c.b);
        }
        C.needsUpdate = true;
        this.glowMat.color.set(amb.night ? 0xdfe9ff : amb.sunColor);
        this.glowMat.opacity = amb.night ? 0.9 : (amb.fogDensity > 0.011 ? 0 : 0.4);
        const size = amb.night ? 150 : 400;
        this.glow.scale.set(size, size, 1);
        this.glow.userData.dir = new THREE.Vector3(-0.28, amb.night ? 0.42 : 0.12 + amb.sunElevation * 0.22, -1).normalize();
        this.stars.visible = !!amb.night;
    }

    _buildMountains(amb) {
        if (this.mountains) { this.mountainGroup.remove(this.mountains); this.mountains.geometry.dispose(); this.mountains = null; }
        if (!this.profile.farMountains) return;
        const rng = mulberry32(777);
        const base = new THREE.Color(amb.mountainTint);
        const fog = new THREE.Color(amb.fogColor);
        const snow = new THREE.Color(amb.night ? 0x9db4e8 : 0xffffff).lerp(fog, amb.night ? 0.25 : 0.18);
        const parts = [];
        for (let i = 0; i < 24; i++) {
            const a = (rng() * 2 - 1) * 1.95;
            const dist = 560 + rng() * 360;
            const x = Math.sin(a) * dist, z = -Math.cos(a) * dist;
            const h = 150 + rng() * 210, r = 170 + rng() * 210;
            const cone = new THREE.ConeGeometry(r, h, 7, 3);
            cone.rotateY(rng() * 6.28);
            cone.translate(x, h / 2 - 60, z);
            jitterGeometry(cone, 26, 11 + i);
            const y0 = -60, y1 = h - 60;
            const rock = base.clone().lerp(fog, 0.22);
            parts.push(part(cone, rock, null, {
                flat: true,
                colorFn: (px, py) => {
                    const t = clamp((py - y0) / (y1 - y0), 0, 1);
                    const k = smoothstep(0.38, 0.6, t);
                    const rr = lerp(rock.r * (0.7 + 0.5 * t), snow.r, k);
                    const gg = lerp(rock.g * (0.7 + 0.5 * t), snow.g, k);
                    const bb = lerp(rock.b * (0.72 + 0.5 * t), snow.b, k);
                    return [rr, gg, bb];
                }
            }));
        }
        const geo = mergeParts(parts);
        // Ombrage des facettes (éclairage fixe, sans coût GPU)
        const col = geo.attributes.color, pos = geo.attributes.position;
        const L = new THREE.Vector3(-0.4, 0.55, 0.7).normalize();
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
        for (let i = 0; i < pos.count; i += 3) {
            a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
            n.crossVectors(b.sub(a), c.sub(a)).normalize();
            const k = (amb.night ? 0.55 : 0.62) + 0.5 * Math.max(0, n.dot(L));
            for (let j = 0; j < 3; j++) col.setXYZ(i + j, col.getX(i + j) * k, col.getY(i + j) * k, col.getZ(i + j) * k);
        }
        this.mountains = new THREE.Mesh(geo, this.mountainMat);
        this.mountains.frustumCulled = false;
        this.mountains.renderOrder = -15;
        this.mountainGroup.add(this.mountains);
    }

    // ------------------------------------------------------------------ particules, traces
    _buildParticles() {
        // Flocons
        this.snowCap = 1700;
        const n = this.snowCap;
        this.snowPos = new Float32Array(n * 3);
        this.snowVel = new Float32Array(n * 3);
        const sizes = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            this.snowPos[i * 3] = (Math.random() - 0.5) * 80;
            this.snowPos[i * 3 + 1] = Math.random() * 30 - 8;
            this.snowPos[i * 3 + 2] = -Math.random() * 120 + 10;
            this.snowVel[i * 3] = (Math.random() - 0.5) * 2.2;
            this.snowVel[i * 3 + 1] = -(3.5 + Math.random() * 4.5);
            this.snowVel[i * 3 + 2] = (Math.random() - 0.5) * 2.0;
            sizes[i] = 0.22 + Math.random() * 0.3;
        }
        this.snowGeo = new THREE.BufferGeometry();
        this.snowAttr = new THREE.BufferAttribute(this.snowPos, 3);
        this.snowAttr.setUsage(THREE.DynamicDrawUsage);
        this.snowGeo.setAttribute('position', this.snowAttr);
        this.snowGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        this.snowMat = makeParticleMaterial(this.softTex, false);
        this.snowMat.uniforms.uOpacity.value = 0.85;
        this.snowPoints = new THREE.Points(this.snowGeo, this.snowMat);
        this.snowPoints.frustumCulled = false;
        this.scene.add(this.snowPoints);
        this.snowCount = 0;

        // Projections de neige
        this.sprayCap = 400;
        const m = this.sprayCap;
        this.sprayPos = new Float32Array(m * 3);
        this.sprayVel = new Float32Array(m * 3);
        this.sprayLife = new Float32Array(m);
        this.sprayMaxLife = new Float32Array(m).fill(1);
        this.spraySize = new Float32Array(m);
        this.sprayAlpha = new Float32Array(m);
        this.sprayGeo = new THREE.BufferGeometry();
        this.sprayPosAttr = new THREE.BufferAttribute(this.sprayPos, 3);
        this.sprayPosAttr.setUsage(THREE.DynamicDrawUsage);
        this.spraySizeAttr = new THREE.BufferAttribute(this.spraySize, 1);
        this.sprayAlphaAttr = new THREE.BufferAttribute(this.sprayAlpha, 1);
        this.spraySizeAttr.setUsage(THREE.DynamicDrawUsage);
        this.sprayAlphaAttr.setUsage(THREE.DynamicDrawUsage);
        this.sprayGeo.setAttribute('position', this.sprayPosAttr);
        this.sprayGeo.setAttribute('aSize', this.spraySizeAttr);
        this.sprayGeo.setAttribute('aAlpha', this.sprayAlphaAttr);
        this.sprayMat = makeParticleMaterial(this.softTex, true);
        this.sprayMat.uniforms.uColor.value.set(0xf4f8ff);
        this.sprayPoints = new THREE.Points(this.sprayGeo, this.sprayMat);
        this.sprayPoints.frustumCulled = false;
        this.scene.add(this.sprayPoints);
        this.sprayHead = 0;
        this.sprayLimit = 200;
    }

    _buildTrails() {
        this.trailCap = 900;
        const g = new THREE.PlaneGeometry(0.14, 1.0);
        g.rotateX(-Math.PI / 2);
        this.trailMat = new THREE.MeshBasicMaterial({ color: 0x8ea3c2, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
        this.trails = new THREE.InstancedMesh(g, this.trailMat, this.trailCap);
        this.trails.frustumCulled = false;
        this.trails.count = 0;
        this.scene.add(this.trails);
        this.trailHead = 0;
        this.trailFilled = 0;
        this._tm = new THREE.Matrix4();
    }

    /** Ajoute une trace de glisse (deux skis). */
    addTrail(x, y, z, yaw, shear, slip) {
        const cap = Math.min(this.trailCap, this.profile.trailCapacity);
        const c = Math.cos(yaw), s = Math.sin(yaw);
        for (const off of [-0.24, 0.24]) {
            composeMatrix(this._tm, x + c * off, y + 0.035, z - s * off, yaw, 1 + slip * 0.5, 1, 1.2, shear);
            this.trails.setMatrixAt(this.trailHead, this._tm);
            this.trailHead = (this.trailHead + 1) % cap;
            if (this.trailFilled < cap) this.trailFilled++;
        }
        this.trails.count = this.trailFilled;
        this.trails.instanceMatrix.needsUpdate = true;
    }

    clearTrails() {
        this.trailHead = 0;
        this.trailFilled = 0;
        this.trails.count = 0;
    }

    /** Émet des particules de neige projetée. */
    spray(x, y, z, count, { vx = 0, vy = 3, vz = 4, spread = 2.5, size = 0.5, life = 0.8 } = {}) {
        const lim = Math.min(this.sprayCap, this.profile.sprayMax, this.sprayLimit);
        for (let n = 0; n < count; n++) {
            const i = this.sprayHead;
            this.sprayHead = (this.sprayHead + 1) % lim;
            this.sprayPos[i * 3] = x + (Math.random() - 0.5) * 0.5;
            this.sprayPos[i * 3 + 1] = y + 0.1 + Math.random() * 0.25;
            this.sprayPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.5;
            this.sprayVel[i * 3] = vx + (Math.random() - 0.5) * spread * 2;
            this.sprayVel[i * 3 + 1] = vy * (0.5 + Math.random());
            this.sprayVel[i * 3 + 2] = vz * (0.5 + Math.random());
            const l = life * (0.6 + Math.random() * 0.6);
            this.sprayLife[i] = l;
            this.sprayMaxLife[i] = l;
            this.spraySize[i] = size * (0.6 + Math.random() * 0.8);
        }
    }

    // ------------------------------------------------------------------ profil, résolution, ambiance
    applyProfile(profile) {
        this.profile = profile;
        this.sprayLimit = Math.min(this.sprayCap, profile.sprayMax);
        this.renderer.shadowMap.enabled = !!profile.shadows;
        this.renderer.shadowMap.type = profile.shadowMapSize >= 2048 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
        this.sun.castShadow = !!profile.shadows;
        if (this.sun.shadow.mapSize.x !== profile.shadowMapSize) {
            this.sun.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
            if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
        }
        // Le matériau doit être recompilé quand les ombres sont activées/désactivées
        this.groundMat.needsUpdate = true;
        this.renderScale = 1;
        this.resize();
        if (this.amb) {
            this._buildMountains(this.amb);
            this._applyFog(this.amb);
        }
        if (this.course) this.setCourse(this.course, this.track, this.amb);
    }

    resize() {
        const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
        const dpr = Math.min(window.devicePixelRatio || 1, this.profile.pixelRatioCap) * this.renderScale;
        this.renderer.setPixelRatio(dpr);
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.aspect = w / h;
        this._updateFov(this.fovBase);
        const scale = (h * dpr) * 0.5 / Math.tan(THREE.MathUtils.degToRad(30));
        for (const m of [this.snowMat, this.sprayMat]) m.uniforms.uScale.value = scale * 0.5;
        this.starMat.uniforms.uScale.value = 1100 * dpr;
    }

    /** Champ de vision vertical adapté au format (portrait : élargi pour garder la piste visible). */
    _updateFov(base) {
        let f = base;
        if (this.aspect < 1.25) {
            const k = Math.pow(1.25 / this.aspect, 0.55);
            f = Math.min(92, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base) / 2) * k)));
        }
        if (Math.abs(this.camera.fov - f) > 0.01) {
            this.camera.fov = f;
            this.camera.updateProjectionMatrix();
        }
    }
    setFov(base) { this.fovBase = base; this._updateFov(base); }

    /** Résolution dynamique : réduit le rendu si la machine peine, le restaure si elle respire. */
    trackFrame(dt, playing) {
        if (!this.profile.dynamicResolution || !playing || dt <= 0 || dt > 0.25) return;
        this.frameAvg += (dt - this.frameAvg) * 0.05;
        this.adaptT += dt;
        if (this.adaptT < 1.5) return;
        this.adaptT = 0;
        if (this.frameAvg > 0.027 && this.renderScale > 0.6) {
            this.renderScale = Math.max(0.6, this.renderScale - 0.1);
            this.upT = 0;
            this.resize();
        } else if (this.frameAvg < 0.0185 && this.renderScale < 1) {
            this.upT += 1.5;
            if (this.upT >= 6) { this.renderScale = Math.min(1, this.renderScale + 0.05); this.upT = 0; this.resize(); }
        }
    }

    _applyFog(amb) {
        const eco = this.profile.viewChunks <= 3 ? 1.35 : 1;
        this.scene.fog.color.setHex(amb.fogColor);
        this.scene.fog.density = amb.fogDensity * eco;
        this.renderer.setClearColor(amb.fogColor, 1);
        for (const m of [this.snowMat, this.sprayMat]) {
            m.uniforms.uFogColor.value.setHex(amb.fogColor);
            m.uniforms.uFogDensity.value = amb.fogDensity * eco;
        }
        this.snowMat.uniforms.uColor.value.set(amb.night ? 0xcbd8f5 : 0xffffff);
        this.sprayMat.uniforms.uColor.value.set(amb.night ? 0xcbd8f5 : 0xf4f8ff);
    }

    applyAmbience(amb) {
        this.amb = amb;
        this._applyFog(amb);
        this.hemi.color.setHex(amb.hemiSky);
        this.hemi.groundColor.setHex(amb.hemiGround);
        this.hemi.intensity = amb.hemiInt;
        this.sun.color.setHex(amb.sunColor);
        this.sun.intensity = amb.sunInt;
        this.sunOffset.set(35, 30 + 40 * amb.sunElevation, 34);
        this._applySky(amb);
        this._buildMountains(amb);
        this.lamp.visible = !!amb.night;
        this.lamp.intensity = amb.night ? 650 : 0;
        this.courseRenderer.setNight(!!amb.night);
        if (this.course) this._rebakeAll();
    }

    // ------------------------------------------------------------------ terrain
    /** Prépare la scène pour une nouvelle course (piste, graine, difficulté). */
    setCourse(course, track, amb) {
        this.course = course;
        this.track = track;
        this.courseRenderer.setCourse(course);
        this.courseRenderer.lastVersion = -1;
        this.clearTrails();
        this._buildLayout(course);
        if (amb) this.applyAmbience(amb); else if (this.amb) this._rebakeAll();
    }

    _buildLayout(course) {
        // Dispose l'ancien terrain
        this.slots.forEach(s => { this.terrainGroup.remove(s.mesh); this.terrainGroup.remove(s.lineMesh); s.dispose(); });
        this.slots = [];
        const halfW = course.terrain.halfW;
        const offsets = [];
        const n = Math.max(6, Math.ceil(halfW * 2 / 2.5));
        for (let k = 0; k <= n; k++) offsets.push(-halfW + (2 * halfW * k) / n);
        for (const o of OUTER_OFFSETS) { offsets.unshift(-halfW - o); offsets.push(halfW + o); }
        const step = this.profile.terrainRowStep;
        const nRows = Math.round(CHUNK_LEN / step) + 1;
        const nCols = offsets.length;
        const index = [];
        for (let r = 0; r < nRows - 1; r++) {
            for (let c = 0; c < nCols - 1; c++) {
                const a = r * nCols + c, b = a + 1, d = a + nCols, e = d + 1;
                index.push(a, d, b, b, d, e);
            }
        }
        this.layout = { offsets, nCols, nRows, step, index };
        const N = this.profile.viewChunks + 2;
        for (let i = 0; i < N; i++) this.slots.push(new TerrainSlot(this.terrainGroup, this.layout, this.groundMat, this.lineMat));
    }

    _rebakeAll() {
        for (const s of this.slots) if (s.index !== null) this._bake(s, s.index);
    }

    _bake(slot, i) {
        const course = this.course, terr = course.terrain, L = this.layout, amb = this.amb || this.course.track.ambience;
        const snow = new THREE.Color(amb.snowTint);
        const mount = new THREE.Color(amb.mountainTint);
        const rockC = new THREE.Color(0x6b7280).lerp(mount, 0.35);
        const deepC = new THREE.Color(0xbcd0ee);
        const ravC = new THREE.Color(0x0b1424);
        const fogC = new THREE.Color(amb.fogColor);
        const z0 = -i * CHUNK_LEN;
        const { nCols, nRows, offsets, step } = L;
        const e = 1.2;
        const halfW = terr.halfW;
        const ty = (x, z) => course.terrainY(x, z);
        const c = new THREE.Color();
        const lineW = 0.28;
        for (let r = 0; r < nRows; r++) {
            const z = z0 - r * step;
            const cx = terr.centerX(z);
            for (let k = 0; k < nCols; k++) {
                const off = offsets[k];
                const x = cx + off;
                const y = ty(x, z);
                const vi = r * nCols + k;
                slot.pos[vi * 3] = x; slot.pos[vi * 3 + 1] = y; slot.pos[vi * 3 + 2] = z;
                const hx = (ty(x + e, z) - ty(x - e, z)) / (2 * e);
                const hz = (ty(x, z + e) - ty(x, z - e)) / (2 * e);
                const inv = 1 / Math.sqrt(hx * hx + 1 + hz * hz);
                const nx = -hx * inv, ny = inv, nz = -hz * inv;
                slot.nor[vi * 3] = nx; slot.nor[vi * 3 + 1] = ny; slot.nor[vi * 3 + 2] = nz;
                slot.uv[vi * 2] = x * 0.07; slot.uv[vi * 2 + 1] = z * 0.07;

                // Couleur : neige damée sur la piste, poudreuse hors piste, roche sur les pentes raides
                const d = Math.abs(off) - halfW;
                const pisteMask = 1 - smoothstep(-0.8, 1.6, d);
                const n1 = noise2(x * 0.09, z * 0.09, 5);
                const n2 = noise2(x * 0.4, z * 0.4, 9);
                c.copy(snow);
                const groom = 1 - 0.035 * Math.sin(x * 2.1) * pisteMask;
                const shade = (0.9 + 0.1 * n1) * (1 - 0.05 * n2) * groom;
                c.multiplyScalar(shade);
                // piste légèrement bleutée
                c.r *= 1 - 0.05 * pisteMask; c.g *= 1 - 0.015 * pisteMask;
                const zone = course.zoneAt(x, z);
                if (zone.deep > 0) c.lerp(deepC, zone.deep * 0.75);
                if (zone.ravine > 0) c.lerp(ravC, Math.min(1, zone.ravine * 1.15));
                const slope = 1 - ny;
                const above = y - terr.pathHeight(z);
                let rock = smoothstep(0.22, 0.42, slope) * 0.85 + smoothstep(35, 110, above) * (0.35 + 0.5 * n1);
                rock = Math.min(0.92, rock) * (d > 0 ? 1 : 0);
                if (rock > 0) c.lerp(rockC, rock);
                const far = smoothstep(45, 200, d) * 0.8;
                if (far > 0) c.lerp(mount, far).lerp(fogC, far * 0.1);
                slot.col[vi * 3] = c.r; slot.col[vi * 3 + 1] = c.g; slot.col[vi * 3 + 2] = c.b;
            }
            // lignes de bord (deux rubans)
            for (let s = 0; s < 2; s++) {
                const sg = s === 0 ? -1 : 1;
                const xa = cx + sg * (halfW - lineW - 0.1), xb = cx + sg * (halfW + 0.1);
                const base = (s * nRows + r) * 2 * 3;
                slot.linePos[base] = xa; slot.linePos[base + 1] = ty(xa, z) + 0.07; slot.linePos[base + 2] = z;
                slot.linePos[base + 3] = xb; slot.linePos[base + 4] = ty(xb, z) + 0.07; slot.linePos[base + 5] = z;
            }
        }
        slot.geo.attributes.position.needsUpdate = true;
        slot.geo.attributes.normal.needsUpdate = true;
        slot.geo.attributes.color.needsUpdate = true;
        slot.geo.attributes.uv.needsUpdate = true;
        slot.lineGeo.attributes.position.needsUpdate = true;
        slot.index = i;
    }

    // ------------------------------------------------------------------ mise à jour par image
    /**
     * Synchronise le monde avec la position du skieur.
     * @param focus  { x, y, z } position du skieur
     * @param cam    position caméra pour recyclage des flocons
     */
    update(dt, time, focus, speed, snowIntensity) {
        const course = this.course;
        if (!course) return;
        const ahead = this.profile.viewChunks;
        course.ensure(focus.z, ahead);
        this.courseRenderer.rebuild(course);
        this.courseRenderer.updateCoins(time, focus.z);
        const ic = course.chunkIndexOf(focus.z);
        const N = this.slots.length;
        for (let i = ic - 1; i <= ic + ahead; i++) {
            const slot = this.slots[((i % N) + N) % N];
            if (slot.index !== i) this._bake(slot, i);
        }

        // Ciel et montagnes suivent la caméra (parallaxe lente pour les sommets)
        const cam = this.camera.position;
        this.sky.position.copy(cam);
        this.stars.position.copy(cam);
        const gd = this.glow.userData.dir || new THREE.Vector3(0, 0.3, -1);
        this.glow.position.set(cam.x + gd.x * 1000, cam.y + gd.y * 1000, cam.z + gd.z * 1000);
        this.glow.lookAt(cam);
        this.mountainGroup.position.set(cam.x * 0.92, focus.y * 0.9, cam.z * 0.985);

        // Soleil : ombres centrées sur le skieur
        this.sun.position.set(focus.x + this.sunOffset.x, focus.y + this.sunOffset.y, focus.z + this.sunOffset.z);
        this.sun.target.position.set(focus.x, focus.y, focus.z - 14);
        this.sun.target.updateMatrixWorld();
        if (this.lamp.visible) {
            this.lamp.position.set(focus.x, focus.y + 2.4, focus.z + 1);
            this.lamp.target.position.set(focus.x, focus.y - 0.5, focus.z - 26);
            this.lamp.target.updateMatrixWorld();
        }

        this._updateSnow(dt, cam, snowIntensity);
        this._updateSpray(dt, speed);
    }

    _updateSnow(dt, cam, intensity) {
        const boost = this.amb && this.amb.fogDensity > 0.011 ? 1.7 : 1;
        const count = Math.min(this.snowCap, Math.floor(this.profile.snowMax * boost * clamp(intensity / 100, 0, 1)));
        this.snowGeo.setDrawRange(0, count);
        this.snowCount = count;
        if (!count) return;
        const P = this.snowPos, V = this.snowVel;
        const zMax = cam.z + 14, zMin = cam.z - 125;
        const yMin = cam.y - 10, yMax = cam.y + 24;
        for (let i = 0; i < count; i++) {
            const k = i * 3;
            P[k] += V[k] * dt;
            P[k + 1] += V[k + 1] * dt;
            P[k + 2] += V[k + 2] * dt;
            if (P[k + 1] < yMin) { P[k + 1] = yMax - Math.random() * 6; P[k] = cam.x + (Math.random() - 0.5) * 80; }
            if (P[k + 2] > zMax) { P[k + 2] = zMin + Math.random() * 8; P[k] = cam.x + (Math.random() - 0.5) * 80; P[k + 1] = yMin + Math.random() * (yMax - yMin); }
            else if (P[k + 2] < zMin - 10) { P[k + 2] = zMax - Math.random() * 6; }
            const dx = P[k] - cam.x;
            if (dx > 42) P[k] -= 84; else if (dx < -42) P[k] += 84;
        }
        this.snowAttr.needsUpdate = true;
    }

    _updateSpray(dt, speed) {
        const lim = Math.min(this.sprayCap, this.profile.sprayMax, this.sprayLimit);
        const P = this.sprayPos, V = this.sprayVel;
        let any = false;
        for (let i = 0; i < lim; i++) {
            if (this.sprayLife[i] <= 0) { if (this.sprayAlpha[i] !== 0) { this.sprayAlpha[i] = 0; any = true; } continue; }
            any = true;
            const k = i * 3;
            V[k + 1] -= 14 * dt;
            P[k] += V[k] * dt;
            P[k + 1] += V[k + 1] * dt;
            P[k + 2] += V[k + 2] * dt;
            this.sprayLife[i] -= dt;
            const t = Math.max(0, this.sprayLife[i] / this.sprayMaxLife[i]);
            this.sprayAlpha[i] = t < 0.5 ? t * 2 : 1;
        }
        if (any) {
            this.sprayPosAttr.needsUpdate = true;
            this.sprayAlphaAttr.needsUpdate = true;
            this.spraySizeAttr.needsUpdate = true;
        }
        this.sprayGeo.setDrawRange(0, lim);
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    dispose() {
        this.slots.forEach(s => s.dispose());
        this.courseRenderer.dispose();
        this.renderer.dispose();
    }
}
