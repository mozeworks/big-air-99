import * as THREE from 'three';

// Finish line: two spring-break fans in bikinis and fuzzy snow boots run out,
// hug the rider, and hearts float up. Played before the RUN COMPLETE screen.
const mat = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const SKIN = [0xe8b896, 0xa86b45];
const SUITS = [[0xff2d8a, 0xffe14d], [0x19d3c5, 0xff7a1a]];      // bikini, then hair
const BOOT = 0xf4efe6;

function box(w, h, d, color, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y, z);
    return m;
}

// Built facing +Z, feet at y = 0. Limbs hang from pivots so they can swing.
function buildFan(i) {
    const skin = SKIN[i], [suit, hair] = SUITS[i];
    const g = new THREE.Group();
    const limb = (x, y, parts) => {
        const p = new THREE.Group();
        p.position.set(x, y, 0);
        for (const m of parts) p.add(m);
        g.add(p);
        return p;
    };
    const legL = limb(-0.09, 0.82, [box(0.12, 0.62, 0.13, skin, 0, -0.31, 0), box(0.17, 0.26, 0.2, BOOT, 0, -0.7, 0.02)]);
    const legR = limb(0.09, 0.82, [box(0.12, 0.62, 0.13, skin, 0, -0.31, 0), box(0.17, 0.26, 0.2, BOOT, 0, -0.7, 0.02)]);
    g.add(box(0.3, 0.14, 0.17, suit, 0, 0.84, 0));                        // bottoms
    g.add(box(0.27, 0.42, 0.16, skin, 0, 1.12, 0));                       // torso
    g.add(box(0.29, 0.11, 0.18, suit, 0, 1.24, 0.005));                   // top
    g.add(box(0.06, 0.12, 0.17, skin, 0, 1.38, 0));                       // neck
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), mat(skin));
    head.position.set(0, 1.52, 0);
    g.add(head);
    g.add(box(0.27, 0.12, 0.26, hair, 0, 1.62, -0.02));                   // hair on top
    g.add(box(0.27, 0.42, 0.08, hair, 0, 1.38, -0.12));                   // and down the back
    g.add(box(0.2, 0.05, 0.04, 0x111111, 0, 1.54, 0.11));                 // shades
    const armL = limb(-0.18, 1.3, [box(0.08, 0.55, 0.09, skin, 0, -0.27, 0)]);
    const armR = limb(0.18, 1.3, [box(0.08, 0.55, 0.09, skin, 0, -0.27, 0)]);
    g.userData = { legL, legR, armL, armR };
    g.scale.setScalar(0.93);
    g.visible = false;
    return g;
}

function heartGeometry() {
    const s = new THREE.Shape();
    s.moveTo(0, -0.5);
    s.bezierCurveTo(-0.15, -0.3, -0.5, -0.1, -0.5, 0.15);
    s.bezierCurveTo(-0.5, 0.45, -0.1, 0.5, 0, 0.25);
    s.bezierCurveTo(0.1, 0.5, 0.5, 0.45, 0.5, 0.15);
    s.bezierCurveTo(0.5, -0.1, 0.15, -0.3, 0, -0.5);
    return new THREE.ShapeGeometry(s, 6);
}

const easeOut = t => 1 - (1 - t) * (1 - t);

export class Celebration {
    constructor(scene, hooks) {
        this.hooks = hooks;              // { groundAt, spray, sound }
        this.fans = [buildFan(0), buildFan(1)];
        scene.add(...this.fans);
        const geo = heartGeometry();
        this.hearts = Array.from({ length: 30 }, (_, i) => {
            const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
                color: i % 3 ? 0xff2d6f : 0xff8fb8, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
            m.visible = false;
            m.userData = { life: 0 };
            scene.add(m);
            return m;
        });
        this.active = false;
        this.duration = 6;
    }

    // at: where the rider stops; along: his direction of travel (unit, flat).
    start(at, along, done) {
        const g = this.hooks.groundAt;
        this.at = at.clone();
        this.done = done;
        this.t = 0;
        this.nextHeart = 0;
        this.active = true;
        // One hugs him from the front, one from behind (he rides sideways).
        const side = new THREE.Vector3(-along.z, 0, along.x);
        this.fans.forEach((f, i) => {
            const s = i ? -1 : 1;
            f.userData.hug = at.clone().addScaledVector(side, 0.5 * s);
            f.userData.from = at.clone().addScaledVector(side, 13 * s).addScaledVector(along, 4 + i * 2);
            f.userData.from.y = g(f.userData.from.x, f.userData.from.z);
            f.position.copy(f.userData.from);
            f.visible = true;
        });
        for (const h of this.hearts) h.visible = false;
        this.hooks.sound?.cheer();
    }

    stop() {
        this.active = false;
        for (const f of this.fans) f.visible = false;
        for (const h of this.hearts) h.visible = false;
    }

    // camera: hearts turn to face it.
    update(dt, camera) {
        if (!this.active) return;
        this.t += dt;
        const t = this.t, g = this.hooks.groundAt;
        this.fans.forEach((f, i) => {
            const u = f.userData;
            // Run in (staggered), then hold on with a little bounce.
            const k = Math.min(1, Math.max(0, (t - 0.3 - i * 0.25) / 1.7));
            f.position.lerpVectors(u.from, u.hug, easeOut(k));
            f.position.y = g(f.position.x, f.position.z);
            f.lookAt(u.hug.x + (this.at.x - u.hug.x) * 4, f.position.y, u.hug.z + (this.at.z - u.hug.z) * 4);
            if (k < 1) {
                const ph = t * 15 + i;
                u.legL.rotation.x = Math.sin(ph) * 0.8;
                u.legR.rotation.x = -Math.sin(ph) * 0.8;
                u.armL.rotation.set(-Math.sin(ph) * 0.9, 0, 0);
                u.armR.rotation.set(Math.sin(ph) * 0.9, 0, 0);
                f.position.y += Math.abs(Math.sin(ph)) * 0.08;
                if (k > 0) this.hooks.spray?.(f.position, 1);
            } else {
                // Arms wrapped around him, one heel kicked up.
                u.legL.rotation.x = 0;
                u.legR.rotation.x = 0.6 + Math.sin(t * 5 + i) * 0.15;     // foot popped up behind
                u.armL.rotation.set(-1.1, 0, 0.5);
                u.armR.rotation.set(-1.1, 0, -0.5);
                f.position.y += Math.abs(Math.sin(t * 5 + i)) * 0.03;
            }
        });

        // Hearts float up from the hug once they've arrived.
        if (t > 2.1 && t < this.duration - 1 && t >= this.nextHeart) {
            this.nextHeart = t + 0.14;
            const h = this.hearts.find(x => !x.visible);
            if (h) {
                h.visible = true;
                h.position.copy(this.at).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 1.3 + Math.random() * 0.4, (Math.random() - 0.5) * 1.2));
                h.userData = { life: 0, max: 1.6 + Math.random() * 0.8, sway: Math.random() * 6, size: 0.18 + Math.random() * 0.16 };
            }
        }
        for (const h of this.hearts) {
            if (!h.visible) continue;
            const u = h.userData;
            u.life += dt;
            if (u.life >= u.max) { h.visible = false; continue; }
            h.position.y += dt * 1.1;
            h.position.x += Math.sin(u.life * 4 + u.sway) * dt * 0.4;
            const pop = Math.min(1, u.life / 0.2);
            h.scale.setScalar(u.size * pop);
            h.material.opacity = Math.min(1, (u.max - u.life) / 0.5);
            h.quaternion.copy(camera.quaternion);
        }

        if (t >= this.duration) {
            this.active = false;          // fans stay posed behind the results screen
            for (const h of this.hearts) h.visible = false;
            this.done?.();
        }
    }
}
