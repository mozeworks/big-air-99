import * as THREE from 'three';

// Rider rig. Everything lives in the root's local space:
//   board long axis = Z (nose toward -Z, the travel direction),
//   rider faces +X (toeside), regular stance: left foot forward at -Z.
// Each frame a pose (plain numbers) is blended toward a target pose, then
// legs and arms are solved with two-bone IK so the feet stay in the bindings
// and a grabbing hand stays on the board edge no matter how hard it's tweaked.

const UP = new THREE.Vector3(0, 1, 0);
const THIGH = 0.46, SHIN = 0.46, UPPER_ARM = 0.30, FOREARM = 0.29, SPINE = 0.52;
const STANCE = 0.27;

const COLORS = {
    jacket: 0xe8532b, panel: 0x8a8f99, pants: 0x17181c, glove: 0x111111,
    skin: 0xe0b48f, beanie: 0x141414, goggle: 0xf2e019, board: 0xf3f1ea,
    boardGraphic: 0x1c1c1c, binding: 0x222428, boot: 0x2b2d33,
};

const mat = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

// --------------------------------------------------------------- poses
// v3 arrays are [x, y, z]; rotations are Euler [x, y, z] radians.
export const POSES = {
    ride: {
        hip: [0.03, 0.80, 0], torso: [0, 0.35, -0.14], head: [0, 0.95, -0.15],
        board: [0, 0, 0], boardRot: [0, 0, 0],
        lHand: [0.22, 0.86, -0.52], rHand: [0.16, 0.74, 0.48],
        lGrab: 0, grabPt: [-0.13, 0.05, -0.1], knee: [1, 0.35, 0],
    },
    crouch: {
        hip: [0.08, 0.56, 0], torso: [0, 0.3, -0.42], head: [0, 0.9, -0.05],
        board: [0, 0, 0], boardRot: [0, 0, 0],
        lHand: [0.38, 0.55, -0.42], rHand: [0.3, 0.5, 0.42],
        lGrab: 0, grabPt: [-0.13, 0.05, -0.1], knee: [1, 0.35, 0],
    },
    tuck: {
        hip: [0.06, 0.58, 0.02], torso: [0, 0.75, -0.5], head: [0, 1.05, 0.05],
        board: [0, 0, 0], boardRot: [0, 0, 0],
        lHand: [0.32, 0.6, -0.5], rHand: [0.32, 0.58, -0.25],
        lGrab: 0, grabPt: [-0.13, 0.05, -0.1], knee: [1, 0.2, -0.2],
    },
    brake: {
        hip: [-0.08, 0.66, 0], torso: [0, 0.1, 0.22], head: [0, 0.9, -0.2],
        board: [0, 0, 0], boardRot: [0, 0, 0],
        lHand: [0.05, 0.85, -0.55], rHand: [0.0, 0.8, 0.55],
        lGrab: 0, grabPt: [-0.13, 0.05, -0.1], knee: [1, 0.3, 0],
    },
    air: {
        hip: [0.02, 0.70, 0], torso: [0, 0.3, -0.1], head: [0, 1.0, -0.3],
        board: [0, 0.05, 0], boardRot: [0, 0, 0],
        lHand: [0.1, 1.08, -0.72], rHand: [0.05, 1.02, 0.72],
        lGrab: 0, grabPt: [-0.13, 0.05, -0.1], knee: [1, 0.45, 0],
    },
    // Hand on the heel edge, knees up, board starting to come up behind.
    methodGrab: {
        hip: [0.1, 0.84, 0], torso: [0, 0.25, 0.15], head: [0, 0.9, -0.55],
        board: [-0.22, 0.5, 0], boardRot: [0.08, 0, -0.75],
        lHand: [0, 0.7, -0.2], rHand: [-0.05, 1.6, 0.6],
        lGrab: 1, grabPt: [-0.13, 0.04, -0.08], knee: [1, -0.2, 0],
    },
    // Full Chris Roach, laid out: back arched with the pelvis thrust out,
    // front knee at 90°, back leg sprawled long, grab arm straight and locked
    // on the heel edge just in front of the front foot, free arm stretched
    // straight out past the head, torso twisted back toward the tail.
    // Knees track over the toes (board toe edge); the grab arm stays straight
    // and clears both knees by ~25 cm. Solved with the rig's own IK.
    methodTweak: {
        hip: [0.16, 0.86, 0], torso: [0, 0, 0.6], twist: 0, head: [0.15, -0.9, -0.3],
        board: [-0.56, 0.76, -0.18], boardRot: [1.84, 0.02, -1.14],
        lHand: [0, 0.7, -0.2], rHand: [-0.5, 1.65, 0.2],
        lGrab: 1, grabPt: [-0.13, 0.04, -0.38], knee: [1, 0.15, 0], kneeBoard: 1,
    },
    // Back hand on the toe edge between the feet, board pulled up under you.
    indyGrab: {
        hip: [0.02, 0.86, 0], torso: [0, 0.1, -0.38], head: [0, 0.6, -0.5],
        board: [0.02, 0.5, 0], boardRot: [0, 0, 0.18],
        lHand: [0.25, 1.35, -0.75], rHand: [0.3, 0.6, 0.1],
        rGrab: 1, rGrabPt: [0.13, 0.04, 0.14], knee: [1, 0.4, 0],
    },
    // Boned indy: front leg locked straight, nose poked up and out, back
    // knee to the chest, back hand on the toe edge just inside the back
    // boot, front arm flung back to counter, upper body twisted and laid back.
    // Solved so the leg is ~96% straight and the hand really reaches.
    indyTweak: {
        hip: [0.04, 0.86, 0.06], torso: [1, 1.13, -0.12], head: [0.2, -0.6, -0.45],
        board: [0.44, 1.02, -0.4], boardRot: [0.73, -0.22, -0.36],
        lHand: [0.62, 1.44, 0.58], rHand: [0.3, 0.6, 0.1],
        rGrab: 1, rGrabPt: [0.13, 0.04, 0.14], knee: [0.6, 0.8, 0.3],
    },
    // Back hand reaches behind the back leg to the heel edge.
    stalefishGrab: {
        hip: [0.06, 0.84, 0], torso: [0, -0.35, 0.1], head: [0, 1.0, -0.4],
        board: [-0.16, 0.5, 0], boardRot: [0, 0, -0.5],
        lHand: [0.3, 1.4, -0.7], rHand: [-0.2, 0.7, 0.3],
        rGrab: 1, rGrabPt: [-0.13, 0.04, 0.1], knee: [1, -0.1, 0],
    },
    stalefishTweak: {
        hip: [0.1, 0.86, -0.02], torso: [0.1, -0.5, 0.25], head: [0, 1.1, -0.35],
        board: [-0.32, 0.8, 0.06], boardRot: [-0.35, -0.1, -1.1],
        lHand: [0.45, 1.6, -0.8], rHand: [-0.2, 0.7, 0.3],
        rGrab: 1, rGrabPt: [-0.13, 0.04, 0.12], knee: [0.7, -0.8, 0],
    },
    // Front hand grabs the toe edge in front of the front foot, front knee
    // driven down, and the board yanked up behind your back, nose high.
    japanGrab: {
        hip: [0.06, 0.84, 0], torso: [0, 0.4, -0.3], head: [0, 0.8, -0.5],
        board: [-0.1, 0.5, 0], boardRot: [0.35, 0, -0.3],
        lHand: [0.3, 0.6, -0.4], rHand: [0.0, 1.5, 0.75],
        lGrab: 1, grabPt: [0.13, 0.04, -0.38], knee: [1, -0.4, 0],
    },
    japanTweak: {
        hip: [0.12, 0.84, 0], torso: [0, 0.5, -0.2], head: [0, 0.7, -0.6],
        board: [-0.32, 0.86, 0.05], boardRot: [1.05, 0.25, -0.75],
        lHand: [0.3, 0.6, -0.4], rHand: [-0.15, 1.85, 0.65],
        lGrab: 1, grabPt: [0.13, 0.04, -0.36], knee: [0.8, -1, -0.2],
    },
    // Balled up for flips.
    flipTuck: {
        hip: [0.04, 0.72, 0], torso: [0, 0.2, -0.5], head: [0, 0.8, -0.4],
        board: [0, 0.32, 0], boardRot: [0, 0, 0],
        lHand: [0.4, 0.8, -0.3], rHand: [0.4, 0.8, 0.3],
        knee: [1, 0.6, 0],
    },
    // Locked in on a rail: arms out for balance.
    slide: {
        hip: [0.02, 0.76, 0], torso: [0, 0.6, -0.15], head: [0, 1.1, -0.2],
        board: [0, 0, 0], boardRot: [0, 0, 0],
        lHand: [0.1, 1.15, -0.85], rHand: [0.1, 1.15, 0.85],
        knee: [1, 0.35, 0],
    },
    crash: {
        hip: [0, 0.45, 0], torso: [0, 0, 0.9], head: [0, 0, 0.6],
        board: [0, 0, 0], boardRot: [0, 0, 0],
        lHand: [-0.3, 0.9, -0.8], rHand: [-0.3, 0.9, 0.8],
        lGrab: 0, grabPt: [-0.13, 0.05, -0.1], knee: [1, 0.2, 0],
    },
};

// Every pose gets every key so poses can be blended into each other.
const POSE_DEFAULTS = { lGrab: 0, grabPt: [-0.13, 0.05, -0.1], rGrab: 0, rGrabPt: [0.13, 0.04, 0.05], twist: 0, kneeLocal: 0, kneeBoard: 0 };
for (const p of Object.values(POSES)) {
    for (const [k, v] of Object.entries(POSE_DEFAULTS)) if (!(k in p)) p[k] = Array.isArray(v) ? v.slice() : v;
}

// Grab name -> [pose when first grabbed, pose fully tweaked].
export const GRABS = {
    method: ['methodGrab', 'methodTweak'],
    indy: ['indyGrab', 'indyTweak'],
    stalefish: ['stalefishGrab', 'stalefishTweak'],
    japan: ['japanGrab', 'japanTweak'],
};

export function clonePose(p) {
    const o = {};
    for (const k in p) o[k] = Array.isArray(p[k]) ? p[k].slice() : p[k];
    return o;
}

export function blendPose(out, a, b, t) {
    for (const k in out) {
        if (Array.isArray(out[k])) for (let i = 0; i < out[k].length; i++) out[k][i] = a[k][i] + (b[k][i] - a[k][i]) * t;
        else out[k] = a[k] + (b[k] - a[k]) * t;
    }
    return out;
}

// --------------------------------------------------------------- rig

function limbMesh(r1, r2, color) {
    const g = new THREE.CylinderGeometry(r1, r2, 1, 6).translate(0, 0.5, 0);
    return new THREE.Mesh(g, mat(color));
}

function placeLimb(mesh, a, b) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    mesh.position.copy(a);
    mesh.quaternion.setFromUnitVectors(UP, d.divideScalar(len || 1));
    mesh.scale.set(1, len, 1);
}

// Two-bone IK: returns the joint (knee/elbow) position.
const _dir = new THREE.Vector3(), _pole = new THREE.Vector3();
function solveIK(a, target, l1, l2, poleDir, outJoint, outEnd) {
    _dir.subVectors(target, a);
    let d = _dir.length();
    _dir.divideScalar(d || 1);
    d = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
    const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    _pole.copy(poleDir).addScaledVector(_dir, -poleDir.dot(_dir)).normalize();
    outJoint.copy(a).addScaledVector(_dir, l1 * cosA).addScaledVector(_pole, l1 * sinA);
    outEnd.copy(a).addScaledVector(_dir, d);
}

export class Rider {
    constructor() {
        this.root = new THREE.Group();
        // Everything hangs off `rig` so the whole rider can be mirrored for
        // a goofy stance (right foot forward) without touching the poses.
        this.rig = new THREE.Group();
        this.root.add(this.rig);
        this.pose = clonePose(POSES.ride);

        // Board + bindings + boots: rigid group that the pose moves around.
        this.board = new THREE.Group();
        const deck = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.035, 1.12), mat(COLORS.board));
        const nose = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.035, 0.24), mat(COLORS.board));
        nose.position.set(0, 0.035, -0.66); nose.rotation.x = 0.32;
        const tail = nose.clone(); tail.position.z = 0.66; tail.rotation.x = -0.32;
        const graphic = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.01, 0.16), mat(COLORS.boardGraphic));
        graphic.position.set(0, 0.022, -0.45);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.01, 0.3), mat(0xd8261e));
        stripe.position.set(0.05, 0.022, 0.42);
        this.board.add(deck, nose, tail, graphic, stripe);
        for (const z of [-STANCE, STANCE]) {
            const binding = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.13), mat(COLORS.binding));
            binding.position.set(0, 0.04, z);
            const boot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.13, 0.12), mat(COLORS.boot));
            boot.position.set(0.02, 0.1, z);
            binding.rotation.y = boot.rotation.y = z < 0 ? -0.25 : 0.2;
            this.board.add(binding, boot);
        }
        this.rig.add(this.board);

        const pants = COLORS.pants, jacket = COLORS.jacket;
        this.parts = {
            lThigh: limbMesh(0.085, 0.075, pants), lShin: limbMesh(0.075, 0.065, pants),
            rThigh: limbMesh(0.085, 0.075, pants), rShin: limbMesh(0.075, 0.065, pants),
            lUpper: limbMesh(0.065, 0.058, jacket), lFore: limbMesh(0.058, 0.05, jacket),
            rUpper: limbMesh(0.065, 0.058, jacket), rFore: limbMesh(0.058, 0.05, jacket),
        };
        for (const k in this.parts) this.rig.add(this.parts[k]);

        this.lGlove = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.09), mat(COLORS.glove));
        this.rGlove = this.lGlove.clone();
        this.rig.add(this.lGlove, this.rGlove);

        // Torso group oriented by the torso frame.
        this.torso = new THREE.Group();
        const chest = new THREE.Mesh(new THREE.BoxGeometry(0.26, SPINE, 0.4), mat(jacket));
        chest.position.y = SPINE / 2;
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.18, 0.41), mat(COLORS.panel));
        panel.position.y = SPINE * 0.62;
        const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.34), mat(pants));
        pelvis.position.y = -0.02;
        this.torso.add(chest, panel, pelvis);
        this.rig.add(this.torso);

        this.head = new THREE.Group();
        const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.115, 0), mat(COLORS.skin));
        const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.125, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(COLORS.beanie));
        beanie.position.y = 0.02;
        const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.2), mat(COLORS.goggle));
        goggles.position.set(0.095, 0.01, 0);
        const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.122, 0.122, 0.035, 8), mat(0x111111));
        strap.position.y = 0.01;
        this.head.add(skull, beanie, strap, goggles);
        this.rig.add(this.head);

        for (const o of this.rig.children) o.traverse(m => { m.castShadow = false; });
        this.goofy = false;

        // Scratch vectors.
        this._v = Array.from({ length: 16 }, () => new THREE.Vector3());
        this._q = new THREE.Quaternion();
        this._e = new THREE.Euler();
        this._m = new THREE.Matrix4();
        this.flail = 0;
    }

    setGoofy(goofy) {
        this.goofy = goofy;
        this.rig.scale.x = goofy ? -1 : 1;
    }

    // Blend toward a target pose; rate is 1/seconds.
    blendTo(target, rate, dt) {
        blendPose(this.pose, this.pose, target, 1 - Math.exp(-rate * dt));
    }

    update(time = 0) {
        const p = this.pose;
        const [hip, foot, knee, jEnd, sh, elbow, hand, tgt, tmp, pole, neck, grabW, side] = this._v;

        // Board transform.
        this.board.position.set(p.board[0], p.board[1], p.board[2]);
        this.board.rotation.set(p.boardRot[0], p.boardRot[1], p.boardRot[2]);
        this.board.updateMatrix();

        // Torso frame.
        hip.set(p.hip[0], p.hip[1], p.hip[2]);
        this._e.set(p.torso[0], p.torso[1], p.torso[2], 'YZX');
        this.torso.position.copy(hip);
        this.torso.quaternion.setFromEuler(this._e);
        // Twist the shoulders around the spine itself (not the world vertical).
        if (p.twist) this.torso.quaternion.multiply(this._q.setFromAxisAngle(UP, p.twist));
        const tq = this.torso.quaternion;

        // Legs: hip joints -> ankles on the bindings.
        // Knee direction: in root space, or (kneeLocal = 1) relative to the
        // pelvis, so knees still point over the toes when the body twists.
        pole.set(p.knee[0], p.knee[1], p.knee[2]).normalize();
        if (p.kneeLocal > 0) pole.lerp(tmp.copy(pole).applyQuaternion(tq), p.kneeLocal).normalize();
        // Or (kneeBoard = 1) along the board's toe edge: the feet are strapped
        // in, so knees track over the toes however the board is cranked.
        if (p.kneeBoard > 0) pole.lerp(tmp.set(p.knee[0], p.knee[1], p.knee[2]).normalize().applyQuaternion(this.board.quaternion), p.kneeBoard).normalize();
        for (const [sideZ, thigh, shin] of [[-1, this.parts.lThigh, this.parts.lShin], [1, this.parts.rThigh, this.parts.rShin]]) {
            const j = tmp.set(0, -0.02, 0.11 * sideZ).applyQuaternion(tq).add(hip);
            foot.set(0, 0.12, STANCE * sideZ).applyMatrix4(this.board.matrix);
            solveIK(j, foot, THIGH, SHIN, pole, knee, jEnd);
            placeLimb(thigh, j, knee);
            placeLimb(shin, knee, jEnd);
        }

        // Head.
        neck.set(0, SPINE + 0.04, 0).applyQuaternion(tq).add(hip);
        this.head.position.copy(neck).add(tmp.set(0, 0.13, 0).applyQuaternion(tq));
        this._e.set(p.head[0], p.head[1], p.head[2], 'YZX');
        this.head.quaternion.copy(tq).multiply(this._q.setFromEuler(this._e));

        // Arms. Left (front) hand can be pulled onto the board's heel edge.
        const flail = this.flail;
        for (const [sideZ, upper, fore, glove, free, grabWeight, grabPt] of [
            [-1, this.parts.lUpper, this.parts.lFore, this.lGlove, p.lHand, p.lGrab, p.grabPt],
            [1, this.parts.rUpper, this.parts.rFore, this.rGlove, p.rHand, p.rGrab, p.rGrabPt],
        ]) {
            sh.set(0, SPINE - 0.06, 0.2 * sideZ).applyQuaternion(tq).add(hip);
            tgt.set(free[0], free[1], free[2]);
            if (flail > 0) tgt.add(tmp.set(Math.sin(time * 17 + sideZ) * 0.4, Math.cos(time * 13 * sideZ) * 0.4, Math.sin(time * 11) * 0.3).multiplyScalar(flail));
            if (grabWeight > 0) {
                grabW.set(grabPt[0], grabPt[1], grabPt[2]).applyMatrix4(this.board.matrix);
                tgt.lerp(grabW, grabWeight);
            }
            side.set(-0.2, -1, 0.5 * sideZ).applyQuaternion(tq);
            solveIK(sh, tgt, UPPER_ARM, FOREARM, side, elbow, hand);
            placeLimb(upper, sh, elbow);
            placeLimb(fore, elbow, hand);
            glove.position.copy(hand);
            glove.quaternion.copy(fore.quaternion);
        }
    }
}
