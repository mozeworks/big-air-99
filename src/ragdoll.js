import * as THREE from 'three';

// Position-based ragdoll for the rider. Nine particles — two hip joints, two
// shoulders, the head, both feet (the board is rigid between them) and both
// hands — are simulated in world space with gravity, distance constraints
// (bones can't stretch, arms and legs can't reach farther than they're long)
// and the snow. Each frame the result is written back into the rider's pose
// (positions plus torso / head / board orientations) so the usual rig, replay
// and rescue code render it without knowing anything changed.

const HL = 0, HR = 1, SL = 2, SR = 3, HD = 4, FL = 5, FR = 6, AL = 7, AR = 8, N = 9;
const RADIUS = [0.12, 0.12, 0.1, 0.1, 0.13, 0.12, 0.12, 0.07, 0.07];
const STANCE = 0.27, BOARD_HALF = 0.56, FOOT_UP = 0.12;
const ARM = 0.62, LEG = 0.88;
const NECK_BEND = 50 * Math.PI / 180;
const RIGID = 0, MAX = 1, MIN = 2;
const CONSTRAINTS = [
    // Pelvis + shoulders: one stiff plate (the spine doesn't fold in half).
    [HL, HR, 0.22, RIGID], [SL, SR, 0.40, RIGID],
    [HL, SL, 0.488, RIGID], [HR, SR, 0.488, RIGID],
    [HL, SR, 0.571, RIGID], [HR, SL, 0.571, RIGID],
    // Head hangs off the shoulders and can loll but not fold into the belly.
    [HD, SL, 0.305, RIGID], [HD, SR, 0.305, RIGID], [HD, HL, 0.42, MIN], [HD, HR, 0.42, MIN],
    // Strapped in: the feet stay a board-width apart.
    [FL, FR, STANCE * 2, RIGID],
    // Limbs: reach limits only, so they fold and whip freely.
    [SL, AL, ARM, MAX], [SR, AR, ARM, MAX], [HL, FL, LEG, MAX], [HR, FR, LEG, MAX],
    [HL, FL, 0.28, MIN], [HR, FR, 0.28, MIN], [HL, FR, 0.28, MIN], [HR, FL, 0.28, MIN],
];

const v3 = () => new THREE.Vector3();

export class Ragdoll {
    constructor() {
        this.p = Array.from({ length: N }, v3);
        this.prev = Array.from({ length: N }, v3);
        this.contact = new Array(N).fill(false);
        this.active = false;
        this._a = v3(); this._b = v3(); this._c = v3(); this._d = v3();
        this._m = new THREE.Matrix4();
        this._L = Array.from({ length: N }, v3);
        this._q = new THREE.Quaternion();
        this.lastQ = { torso: new THREE.Quaternion(), head: new THREE.Quaternion(), board: new THREE.Quaternion() };
    }

    // Seed the particles from wherever the rig's joints are right now, so
    // there's no pop at the moment of impact. `omega` is the body's angular
    // velocity (world), `vel` its linear velocity.
    start(rider, pos, vel, omega) {
        rider.root.updateMatrixWorld(true);
        const { parts, board } = rider;
        const rigW = v => rider.rig.localToWorld(v);
        const P = this.p;
        rigW(P[HL].copy(parts.lThigh.position)); rigW(P[HR].copy(parts.rThigh.position));
        rigW(P[SL].copy(parts.lUpper.position)); rigW(P[SR].copy(parts.rUpper.position));
        rigW(P[HD].copy(rider.head.position));
        board.localToWorld(P[FL].set(0, FOOT_UP, -STANCE)); board.localToWorld(P[FR].set(0, FOOT_UP, STANCE));
        rigW(P[AL].copy(rider.lGlove.position)); rigW(P[AR].copy(rider.rGlove.position));
        const c = this._a.set(0, 0, 0);
        for (const q of P) c.add(q);
        c.divideScalar(N);
        for (let i = 0; i < N; i++) {
            const r = this._b.subVectors(P[i], c);
            const v = this._d.copy(omega).cross(r);
            // A kick of chaos so no two wipeouts look alike; the extremities get the most.
            const k = i >= FL ? 2.6 : 1.2;
            v.x += (Math.random() - 0.5) * k; v.y += (Math.random() - 0.3) * k; v.z += (Math.random() - 0.5) * k;
            this.prev[i].copy(P[i]).addScaledVector(v, -1 / 120);  // verlet-style: prev = p - v*dt (one substep)
            this.contact[i] = false;
        }
        this.offY = c.y - pos.y;
        this.lastPos = (this.lastPos || v3()).copy(pos);
        this.lastVel = (this.lastVel || v3()).copy(vel);
        this.active = true;
        this.goofy = rider.goofy;
    }

    stop() { this.active = false; }

    // The rider's own sliding body (player.pos / player.vel) carries the whole
    // ragdoll along; the particles only simulate motion *relative* to it. So
    // the ragdoll can't drift off the terrain, and when the body is jolted
    // (landing, snow drag) loose limbs keep going and whip past it.
    // dt: seconds; groundAt(x,z) -> y; g: gravity; grounded: body on snow.
    step(dt, groundAt, g, pos, vel, grounded) {
        const P = this.p, Q = this.prev, SUB = 2, h = dt / SUB;
        const d = this._a.subVectors(pos, this.lastPos);
        const dv = this._b.subVectors(vel, this.lastVel);
        this.lastPos.copy(pos); this.lastVel.copy(vel);
        for (let i = 0; i < N; i++) {
            P[i].add(d); Q[i].add(d);
            // Free limbs keep their old velocity: seen from the body they swing the other way.
            const w = (i === HD || i >= FL ? 0.75 : 0.1) * SUB;
            Q[i].addScaledVector(dv, w * h);
        }
        for (let s = 0; s < SUB; s++) this._substep(h, groundAt, grounded ? g : 0);
        // Keep the torso with the body: limbs are free, but the whole figure
        // can't wander off from where the slide says the rider is.
        const c = this._a.set(0, 0, 0);
        for (const i of [HL, HR, SL, SR]) c.add(P[i]);
        c.multiplyScalar(0.25);
        const k = Math.min(1, 12 * dt);
        const fx = (pos.x - c.x) * k, fz = (pos.z - c.z) * k;
        const fy = grounded ? 0 : (pos.y + this.offY - c.y) * k;
        for (let i = 0; i < N; i++) { P[i].x += fx; P[i].z += fz; P[i].y += fy; Q[i].x += fx; Q[i].z += fz; Q[i].y += fy; }
    }

    _substep(h, groundAt, g) {
        const P = this.p, Q = this.prev;
        const drag = Math.exp(-0.25 * h);
        for (let i = 0; i < N; i++) {
            const v = this._b.subVectors(P[i], Q[i]).multiplyScalar(drag);
            Q[i].copy(P[i]);
            v.y -= g * h * h;
            if (v.length() > 30 * h) v.setLength(30 * h);
            P[i].add(v);
        }
        for (let it = 0; it < 6; it++) {
            for (const [a, b, rest, type] of CONSTRAINTS) {
                const d = this._c.subVectors(P[b], P[a]);
                const len = d.length() || 1e-6;
                if ((type === MAX && len <= rest) || (type === MIN && len >= rest)) continue;
                d.multiplyScalar((len - rest) / len * 0.5);
                P[a].add(d); P[b].sub(d);
            }
            // Head follows the line of the spine a little, like neck muscles.
            this._headSpring();
            this._collide(groundAt, h);
        }
    }

    _headSpring() {
        const P = this.p, up = this._d;
        up.addVectors(P[SL], P[SR]).multiplyScalar(0.5);
        const mid = this._c.copy(up);
        up.sub(this._a.addVectors(P[HL], P[HR]).multiplyScalar(0.5)).normalize();
        const target = mid.addScaledVector(up, 0.23);
        P[HD].lerp(target, 0.04);
    }

    _collide(groundAt, h) {
        const P = this.p, Q = this.prev;
        for (let i = 0; i < N; i++) {
            const gy = groundAt(P[i].x, P[i].z) + RADIUS[i];
            this.contact[i] = P[i].y < gy;
            if (this.contact[i]) {
                P[i].y = gy;
                // Snow grips: bleed the tangential velocity (prev moves toward p), kill the vertical.
                const f = Math.min(0.5, 2.2 * h);
                Q[i].x += (P[i].x - Q[i].x) * f;
                Q[i].z += (P[i].z - Q[i].z) * f;
                Q[i].y = P[i].y;
            }
        }
        // Board ends can dig in too: lift the nearer foot.
        const dir = this._a.subVectors(P[FR], P[FL]).normalize();
        for (const [foot, sign] of [[FL, -1], [FR, 1]]) {
            const end = this._b.copy(P[foot]).addScaledVector(dir, sign * (BOARD_HALF - STANCE));
            const gy = groundAt(end.x, end.z) + 0.05;
            if (end.y < gy) P[foot].y += gy - end.y;
        }
    }

    // Write the ragdoll into a pose. `rootPos` is the rider root's world
    // position (its rotation is identity during a crash).
    writePose(pose, rootPos) {
        const L = this._L, goofy = this.goofy;
        for (let i = 0; i < N; i++) {
            L[i].subVectors(this.p[i], rootPos);
            if (goofy) L[i].x = -L[i].x;
        }
        const hipMid = this._a.addVectors(L[HL], L[HR]).multiplyScalar(0.5);
        const shMid = this._b.addVectors(L[SL], L[SR]).multiplyScalar(0.5);
        const up = new THREE.Vector3().subVectors(shMid, hipMid).normalize();
        const lat = new THREE.Vector3().subVectors(L[SR], L[SL]).add(this._c.subVectors(L[HR], L[HL])).normalize();
        lat.addScaledVector(up, -lat.dot(up)).normalize();
        const fwd = new THREE.Vector3().crossVectors(up, lat);

        const origin = hipMid.clone().addScaledVector(up, 0.02);
        pose.rag = 1;
        pose.hip = [origin.x, origin.y, origin.z];
        this._setQ(pose.torsoQ, this.lastQ.torso, fwd, up, lat);

        // Head orientation: its up axis points from the shoulders to the skull.
        const hUp = new THREE.Vector3().subVectors(L[HD], shMid).normalize();
        // A neck only bends so far, however hard the head is thrown.
        const bend = up.angleTo(hUp);
        if (bend > NECK_BEND) {
            const axis = this._c.crossVectors(up, hUp);
            if (axis.lengthSq() < 1e-6) axis.copy(lat);
            hUp.copy(up).applyAxisAngle(axis.normalize(), NECK_BEND);
        }
        const hLat = lat.clone().addScaledVector(hUp, -lat.dot(hUp)).normalize();
        const hFwd = new THREE.Vector3().crossVectors(hUp, hLat);
        this._setQ(pose.headQ, this.lastQ.head, hFwd, hUp, hLat);

        // Board: long axis between the feet; its toe edge faces where the torso faces.
        const bz = new THREE.Vector3().subVectors(L[FR], L[FL]).normalize();
        const bx = fwd.clone().addScaledVector(bz, -fwd.dot(bz));
        if (bx.lengthSq() < 1e-4) bx.copy(up).addScaledVector(bz, -up.dot(bz));
        bx.normalize();
        const by = new THREE.Vector3().crossVectors(bz, bx);
        this._setQ(pose.boardQ, this.lastQ.board, bx, by, bz);
        const c = this._d.addVectors(L[FL], L[FR]).multiplyScalar(0.5).addScaledVector(by, -FOOT_UP);
        pose.board = [c.x, c.y, c.z];

        pose.lHand = [L[AL].x, L[AL].y, L[AL].z];
        pose.rHand = [L[AR].x, L[AR].y, L[AR].z];
        pose.lGrab = pose.rGrab = 0;
        pose.knee = [fwd.x, fwd.y, fwd.z];
        pose.kneeLocal = pose.kneeBoard = 0;
        pose.twist = 0;
    }

    _setQ(out, last, x, y, z) {
        this._m.makeBasis(x, y, z);
        this._q.setFromRotationMatrix(this._m);
        if (this._q.dot(last) < 0) { this._q.x *= -1; this._q.y *= -1; this._q.z *= -1; this._q.w *= -1; }
        last.copy(this._q);
        out[0] = this._q.x; out[1] = this._q.y; out[2] = this._q.z; out[3] = this._q.w;
    }
}
