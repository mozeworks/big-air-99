import * as THREE from 'three';

// A chunky low-poly bear that guards the out-of-bounds. It charges in on all
// fours, rears up and swipes. Root faces +Z; the body sits on its own group so
// it can rear up without moving the feet.
const FUR = 0x4a2f1c, FUR_DARK = 0x2e1d11, SNOUT = 0x8a6a4a;
const mat = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

export class Bear {
    constructor(scene) {
        this.root = new THREE.Group();
        this.body = new THREE.Group();
        this.root.add(this.body);

        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.85, 1.6), mat(FUR));
        torso.position.set(0, 0.95, 0);
        const hump = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.6), mat(FUR));
        hump.position.set(0, 1.45, 0.35);
        const head = new THREE.Group();
        head.position.set(0, 1.25, 0.95);
        const skull = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.55, 0.55), mat(FUR));
        const snout = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 0.32), mat(SNOUT));
        snout.position.set(0, -0.08, 0.38);
        const nose = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.06), mat(0x111111));
        nose.position.set(0, -0.02, 0.56);
        const earGeo = new THREE.BoxGeometry(0.16, 0.16, 0.08);
        const earL = new THREE.Mesh(earGeo, mat(FUR_DARK)); earL.position.set(-0.22, 0.32, -0.05);
        const earR = earL.clone(); earR.position.x = 0.22;
        head.add(skull, snout, nose, earL, earR);
        this.head = head;
        this.body.add(torso, hump, head);

        // Legs pivot at the shoulder/hip so they can swing.
        const legGeo = new THREE.BoxGeometry(0.28, 0.8, 0.32).translate(0, -0.4, 0);
        this.legs = [[-0.3, 0.6], [0.3, 0.6], [-0.3, -0.6], [0.3, -0.6]].map(([x, z]) => {
            const leg = new THREE.Mesh(legGeo, mat(FUR_DARK));
            leg.position.set(x, 0.8, z);
            this.body.add(leg);
            return leg;
        });
        this.root.visible = false;
        scene.add(this.root);
        this.t = 0;
        this.active = false;
    }

    // Start a charge from `from` toward a moving target. Returns nothing; call
    // update() each frame with the target's position until it reports a hit.
    charge(from, duration = 1.1) {
        this.root.position.copy(from);
        this.start = from.clone();
        this.duration = duration;
        this.t = 0;
        this.active = true;
        this.root.visible = true;
    }

    // Returns true on the frame the bear reaches its target.
    update(dt, target, groundAt) {
        if (!this.active) return false;
        this.t += dt;
        const k = Math.min(1, this.t / this.duration);
        const e = k * k * (3 - 2 * k);
        const p = this.root.position.lerpVectors(this.start, target, e);
        p.y = groundAt(p.x, p.z);
        const dx = target.x - p.x, dz = target.z - p.z;
        if (dx * dx + dz * dz > 0.01) this.root.rotation.y = Math.atan2(dx, dz);
        // Galloping legs, then rear up for the last stretch.
        const gallop = Math.sin(this.t * 18);
        this.legs.forEach((leg, i) => { leg.rotation.x = (i % 2 ? 1 : -1) * gallop * 0.7 * (1 - k); });
        this.body.rotation.x = -Math.max(0, (k - 0.7) / 0.3) * 0.9;
        this.head.rotation.x = Math.sin(this.t * 9) * 0.15;
        return k >= 1;
    }

    // Freeze in the reared-up pose (used while the crash plays out).
    hold() { this.active = false; }

    hide() {
        this.active = false;
        this.root.visible = false;
    }

    snapshot() {
        return { visible: this.root.visible, pos: this.root.position.clone(), rotY: this.root.rotation.y, bodyX: this.body.rotation.x };
    }

    restore(s) {
        this.root.visible = s.visible;
        this.root.position.copy(s.pos);
        this.root.rotation.y = s.rotY;
        this.body.rotation.x = s.bodyX;
    }
}
