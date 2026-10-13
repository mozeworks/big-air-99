import * as THREE from 'three';
import {
    profileHeight, profileGrade, ledgeDelta, LIP_S, KICKER_START_S, KNUCKLE_S, SWEET_SPOT,
    COURSE_HALF_WIDTH, S_MIN, S_MAX, LIP2_S, CLIFF_S, CLIFF_X, LEDGE_START_S, FEATURES, RAIL,
} from './profile.js';

const W = COURSE_HALF_WIDTH;
const X_EXTENT = 70;

// Cheap deterministic value noise so the mountain looks the same every run.
function hash(i, j) {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
}
function noise2(x, y) {
    const i = Math.floor(x), j = Math.floor(y);
    const fx = x - i, fy = y - j;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// The run sits on a ridge: forested mountainside rising on the right (+X),
// and on the left a low snow berm, then the ground drops away to the valley.
function lateral(x, s) {
    const d = Math.abs(x) - W;
    if (d <= 0) return 0;
    const rough = noise2(x * 0.08, s * 0.05) * 2 + noise2(x * 0.25, s * 0.2) * 0.6;
    const k = Math.min(1, d / 8);
    if (x > 0) return d * 0.32 + d * d * 0.012 + rough * k * 2.2;
    const berm = 1.6 * Math.exp(-((d - 2.5) ** 2) / 4);
    return berm - Math.max(0, d - 4) ** 1.35 * 0.35 + rough * k * 1.6;
}

// 0 on the chute side, 1 on the cliff ledge side, steep wall in between.
function ledgeWeight(x) {
    const t = Math.min(1, Math.max(0, (CLIFF_X - x) / 2.5));
    return t * t * (3 - 2 * t);
}

export function heightAt(x, z) {
    const s = -z;
    return profileHeight(s) + lateral(x, s) + ledgeWeight(x) * ledgeDelta(s);
}

const _n = new THREE.Vector3();
export function normalAt(x, z, out = _n) {
    const e = 0.05;
    const hx = heightAt(x + e, z) - heightAt(x - e, z);
    const hz = heightAt(x, z + e) - heightAt(x, z - e);
    return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
}

export { LIP_S, KICKER_START_S, KNUCKLE_S, SWEET_SPOT, W as COURSE_HALF_WIDTH, S_MIN, S_MAX, profileGrade, LIP2_S, CLIFF_S, CLIFF_X, FEATURES, RAIL };

// ---------------------------------------------------------------- mesh

const SNOW = new THREE.Color(0xf4f8ff);
const SNOW_SHADE = new THREE.Color(0xdde7f7);
const BERM = new THREE.Color(0xd2dcef);
const ROCK = new THREE.Color(0x4a4d57);
const LIP_DYE = new THREE.Color(0xff5a1f);
const BLUE_DYE = new THREE.Color(0x2f6bff);

function buildTerrainMesh() {
    const dx = 1.25, ds = 0.5;
    const cols = Math.round((2 * X_EXTENT) / dx) + 1;
    const rows = Math.round((S_MAX - S_MIN) / ds) + 1;
    const pos = new Float32Array(cols * rows * 3);
    const col = new Float32Array(cols * rows * 3);
    const c = new THREE.Color();

    for (let r = 0; r < rows; r++) {
        const s = S_MIN + r * ds;
        for (let k = 0; k < cols; k++) {
            const x = -X_EXTENT + k * dx;
            const i = (r * cols + k) * 3;
            const y = heightAt(x, -s);
            pos[i] = x; pos[i + 1] = y; pos[i + 2] = -s;

            const d = Math.abs(x) - W;
            if (d > 0) {
                const n = normalAt(x, -s);
                c.copy(BERM);
                if (n.y < 0.62) c.lerp(ROCK, Math.min(1, (0.62 - n.y) * 4));
            } else {
                // Groomed corduroy: alternate faint bands every couple meters.
                c.copy(Math.floor(s / 2) % 2 ? SNOW : SNOW_SHADE);
                const n = normalAt(x, -s);
                if (n.y < 0.5) c.copy(ROCK);
                if (s > LIP_S - 0.9 && s < LIP_S + 0.05) c.copy(LIP_DYE);
                if (s > LIP2_S - 0.9 && s < LIP2_S + 0.05) c.copy(LIP_DYE);
                if (ledgeWeight(x) > 0.5) {
                    if (s > CLIFF_S - 1.8 && s < CLIFF_S - 0.8) c.copy(LIP_DYE);
                    if (s > CLIFF_S - 0.75 && s <= CLIFF_S) c.copy(ROCK); // top of the rock face
                }
                if (Math.abs(s - LEDGE_START_S) < 0.35 && ledgeWeight(x) < 0.1) c.copy(BLUE_DYE);
                if (Math.abs(s - KNUCKLE_S) < 0.35) c.copy(BLUE_DYE);
                if (Math.abs(s - SWEET_SPOT[0]) < 0.3 || Math.abs(s - SWEET_SPOT[1]) < 0.3) c.copy(BLUE_DYE);
                if (Math.abs(Math.abs(x) - W) < 0.7) c.lerp(BLUE_DYE, 0.35);
            }
            col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b;
        }
    }

    const idx = new Uint32Array((cols - 1) * (rows - 1) * 6);
    let p = 0;
    for (let r = 0; r < rows - 1; r++) {
        for (let k = 0; k < cols - 1; k++) {
            const a = r * cols + k, b = a + 1, d = a + cols, e = d + 1;
            idx[p++] = a; idx[p++] = b; idx[p++] = d;
            idx[p++] = b; idx[p++] = e; idx[p++] = d;
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    return new THREE.Mesh(geo, mat);
}

// Low-poly pines, instanced. Returns positions for collision.
function buildTrees(scene) {
    const trees = [];
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let s = S_MIN + 10; s < S_MAX; s += 3.2) {
        for (const side of [-1, 1]) {
            if (rand() < (side > 0 ? 0.3 : 0.7)) continue;
            const x = side * (W + (side > 0 ? 4 : 8) + Math.pow(rand(), 1.6) * 48);
            const zz = -(s + rand() * 3);
            const scale = 0.8 + rand() * 0.9;
            trees.push({ x, z: zz, y: heightAt(x, zz), scale });
        }
    }

    const foliageGeo = new THREE.BufferGeometry();
    const parts = [
        new THREE.ConeGeometry(1.9, 3.2, 6).translate(0, 2.8, 0),
        new THREE.ConeGeometry(1.5, 2.8, 6).translate(0, 4.4, 0),
        new THREE.ConeGeometry(1.0, 2.4, 6).translate(0, 5.9, 0),
    ];
    const merged = mergeGeometries(parts);
    foliageGeo.copy(merged);
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.6, 5).translate(0, 0.8, 0);

    const foliage = new THREE.InstancedMesh(foliageGeo, new THREE.MeshLambertMaterial({ color: 0x1f4a33, flatShading: true }), trees.length);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x4a3222, flatShading: true }), trees.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    trees.forEach((t, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.x * 13.7);
        sc.setScalar(t.scale);
        m.compose(new THREE.Vector3(t.x, t.y - 0.3, t.z), q, sc);
        foliage.setMatrixAt(i, m);
        trunks.setMatrixAt(i, m);
    });
    scene.add(foliage, trunks);
    return trees;
}

function mergeGeometries(geos) {
    const out = new THREE.BufferGeometry();
    const nonIndexed = geos.map(g => g.toNonIndexed());
    const total = nonIndexed.reduce((n, g) => n + g.attributes.position.count, 0);
    const pos = new Float32Array(total * 3);
    let o = 0;
    for (const g of nonIndexed) {
        pos.set(g.attributes.position.array, o);
        o += g.attributes.position.array.length;
    }
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.computeVertexNormals();
    return out;
}

function buildFlags(scene) {
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 3, 5).translate(0, 1.5, 0);
    const flagGeo = new THREE.PlaneGeometry(1.1, 0.7).translate(0.55, 2.6, 0);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const orange = new THREE.MeshLambertMaterial({ color: 0xff5a1f, side: THREE.DoubleSide });
    const blue = new THREE.MeshLambertMaterial({ color: 0x2f6bff, side: THREE.DoubleSide });
    const spots = [
        [LIP_S - 0.4, orange], [KICKER_START_S, blue],
        [SWEET_SPOT[0], blue], [SWEET_SPOT[1], blue],
        [LIP2_S - 0.4, orange], [CLIFF_S - 0.8, orange],
    ];
    for (const [s, mat] of spots) {
        for (const side of [-1, 1]) {
            const x = side * (W + 0.6);
            const g = new THREE.Group();
            g.add(new THREE.Mesh(poleGeo, poleMat));
            const f = new THREE.Mesh(flagGeo, mat);
            f.rotation.y = side > 0 ? Math.PI : 0;
            g.add(f);
            g.position.set(x, heightAt(x, -s), -s);
            scene.add(g);
        }
    }
}

// Roadside signs: chunky 90s course boards.
function buildSigns(scene) {
    const signs = [
        [65, 1, ['RAIL →', 'OLLIE ON']],
        [150, 1, ['KICKER', '55-70 KM/H']],
        [330, 1, ['STEP-DOWN', 'MAX 60 KM/H', '↓ BRAKE']],
        [500, -1, ['← CLIFF', 'MAX 30 KM/H']],
        [500, 1, ['CHUTE →', 'NO SPEED LIMIT']],
    ];
    const post = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5).translate(0, 1.3, 0);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    for (const [s, side, lines] of signs) {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 128;
        const g = canvas.getContext('2d');
        g.fillStyle = '#ffd21f'; g.fillRect(0, 0, 256, 128);
        g.strokeStyle = '#111'; g.lineWidth = 10; g.strokeRect(5, 5, 246, 118);
        g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
        const size = lines.length > 2 ? 30 : 38;
        g.font = `italic 900 ${size}px Impact, 'Arial Black', sans-serif`;
        lines.forEach((l, i) => g.fillText(l, 128, 64 + (i - (lines.length - 1) / 2) * (size + 4)));
        const tex = new THREE.CanvasTexture(canvas);
        tex.magFilter = THREE.NearestFilter;
        const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: tex }));
        board.position.y = 2.6;
        const grp = new THREE.Group();
        const p1 = new THREE.Mesh(post, postMat); p1.position.x = -0.9;
        const p2 = new THREE.Mesh(post, postMat); p2.position.x = 0.9;
        grp.add(board, p1, p2);
        const x = side * (W - 1.2);
        grp.position.set(x, heightAt(x, -s), -s);
        grp.rotation.y = -side * 0.35;
        scene.add(grp);
    }
}

function buildRail(scene) {
    const a = new THREE.Vector3(RAIL.x, heightAt(RAIL.x, -RAIL.s0) + RAIL.height, -RAIL.s0);
    const b = new THREE.Vector3(RAIL.x, heightAt(RAIL.x, -RAIL.s1) + RAIL.height, -RAIL.s1);
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, len, 8).translate(0, len / 2, 0),
        new THREE.MeshLambertMaterial({ color: 0xff3b1f }),
    );
    tube.position.copy(a);
    tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    scene.add(tube);
    const postGeo = new THREE.CylinderGeometry(0.04, 0.04, RAIL.height, 5).translate(0, RAIL.height / 2, 0);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    for (let k = 0; k <= len; k += 3.5) {
        const p = a.clone().addScaledVector(d, k / len);
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(p.x, p.y - RAIL.height, p.z);
        scene.add(post);
    }
    return { a, b, dir: d.clone().normalize(), len };
}

function buildBackdrop(scene) {
    // Distant peaks, ring-placed. Not fogged so they read through the haze.
    const mat = new THREE.MeshLambertMaterial({ color: 0x8fa3c4, flatShading: true, fog: false });
    const cap = new THREE.MeshLambertMaterial({ color: 0xf4f8ff, flatShading: true, fog: false });
    let seed = 3;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2 + rand() * 0.2;
        const dist = 620 + rand() * 260;
        const h = 140 + rand() * 220;
        const r = 120 + rand() * 120;
        const cx = Math.sin(a) * dist, cz = -400 + Math.cos(a) * dist;
        const base = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5 + Math.floor(rand() * 3)), mat);
        base.position.set(cx, -160 + h / 2, cz);
        base.rotation.y = rand() * 6;
        const top = new THREE.Mesh(new THREE.ConeGeometry(r * 0.36, h * 0.36, base.geometry.parameters.radialSegments), cap);
        top.position.set(0, h * 0.32 + 0.5, 0);
        base.add(top);
        scene.add(base);
    }
}

export function buildCourse(scene) {
    scene.add(buildTerrainMesh());
    const trees = buildTrees(scene);
    buildFlags(scene);
    buildSigns(scene);
    const rail = buildRail(scene);
    buildBackdrop(scene);

    // Bucket trees by downhill distance for cheap collision checks.
    const buckets = new Map();
    for (const t of trees) {
        const b = Math.floor(-t.z / 10);
        if (!buckets.has(b)) buckets.set(b, []);
        buckets.get(b).push(t);
    }
    return {
        rail,
        treeNear(x, y, z) {
            const b = Math.floor(-z / 10);
            for (const k of [b - 1, b, b + 1]) {
                for (const t of buckets.get(k) || []) {
                    const dx = t.x - x, dz = t.z - z;
                    const r = 0.75 * t.scale + 0.35;
                    if (dx * dx + dz * dz < r * r && y < t.y + 6 * t.scale) return t;
                }
            }
            return null;
        },
    };
}
