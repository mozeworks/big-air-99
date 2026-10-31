import * as THREE from 'three';

// Loose pieces knocked off the rider in a crash — beanie, goggles, gloves,
// the board (or both halves of it). Each piece is a copy of the rider's mesh
// placed in the world, then tumbles, bounces and settles on the snow.
const G = 9.81;

export class Debris {
    constructor(scene) {
        this.scene = scene;
        this.pieces = [];
        this._q = new THREE.Quaternion();
        this._axis = new THREE.Vector3();
    }

    // Copy `source` (a mesh or group on the rider) into the world at its
    // current place and send it flying.
    spawn(source, vel, spin = 8) {
        source.updateWorldMatrix(true, true);
        const obj = source.clone(true);
        source.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale);
        obj.visible = true;
        this.scene.add(obj);
        const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        this.pieces.push({ obj, vel: vel.clone(), axis, spin: spin * (0.6 + Math.random() * 0.8), resting: false });
        return obj;
    }

    // A board broken in two: two half-length boards along its length.
    spawnSnapped(board, vel) {
        board.updateWorldMatrix(true, true);
        const halves = [];
        for (const side of [-1, 1]) {
            const half = new THREE.Group();
            for (const child of board.children) {
                // Everything on this half except the full-length deck (replaced below).
                if (child === board.children[0] || Math.sign(child.position.z) !== side) continue;
                half.add(child.clone(true));
            }
            const deck = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.035, 0.5), board.children[0].material);
            deck.position.z = side * 0.28;
            half.add(deck);
            board.matrixWorld.decompose(half.position, half.quaternion, half.scale);
            this.scene.add(half);
            const v = vel.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3));
            const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            this.pieces.push({ obj: half, vel: v, axis, spin: 10 + Math.random() * 6, resting: false });
            halves.push(half);
        }
        return halves;
    }

    update(dt, groundAt) {
        for (const p of this.pieces) {
            if (p.resting) continue;
            p.vel.y -= G * dt;
            p.vel.multiplyScalar(1 - 0.15 * dt);
            p.obj.position.addScaledVector(p.vel, dt);
            this._q.setFromAxisAngle(p.axis, p.spin * dt);
            p.obj.quaternion.premultiply(this._q);
            const gy = groundAt(p.obj.position.x, p.obj.position.z) + 0.05;
            if (p.obj.position.y < gy) {
                p.obj.position.y = gy;
                // Bounce a little, scrub speed, slow the spin.
                p.vel.y = Math.abs(p.vel.y) * 0.3;
                p.vel.x *= 0.6; p.vel.z *= 0.6;
                p.spin *= 0.6;
                if (p.vel.length() < 0.6) p.resting = true;
            }
        }
    }

    clear() {
        for (const p of this.pieces) this.scene.remove(p.obj);
        this.pieces = [];
    }

    // For the replay.
    snapshot() {
        return this.pieces.map(p => [p.obj.position.clone(), p.obj.quaternion.clone()]);
    }

    restore(s) {
        this.pieces.forEach((p, i) => {
            p.obj.visible = i < s.length;
            if (i < s.length) { p.obj.position.copy(s[i][0]); p.obj.quaternion.copy(s[i][1]); }
        });
    }

    // After the replay, put every piece back where it came to rest.
    showAll() {
        for (const p of this.pieces) p.obj.visible = true;
    }
}
