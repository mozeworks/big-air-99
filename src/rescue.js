import * as THREE from 'three';
import { POSES, clonePose, blendPose } from './rider.js';

// After an ambulance-level slam, ski patrol comes for you: a snowmobile
// towing a rescue sled, or — for the worst injuries — a helicopter that
// winches you up. Both are short scripted scenes played before the
// ambulance screen.
const mat = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const RED = 0xc4161c, WHITE = 0xf2f2f2, DARK = 0x1c1c1e, ORANGE = 0xff6a1f, GLASS = 0x6f8fb3;

function box(w, h, d, color, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y, z);
    return m;
}

// A patroller: red jacket with a white cross on the back.
function patroller() {
    const g = new THREE.Group();
    g.add(box(0.36, 0.5, 0.3, RED, 0, 0.75, 0));
    g.add(box(0.05, 0.22, 0.31, WHITE, 0, 0.8, 0), box(0.05, 0.06, 0.31, WHITE, 0, 0.8, 0).rotateX(0));
    g.add(box(0.3, 0.08, 0.31, WHITE, 0, 0.8, 0));
    g.add(box(0.36, 0.45, 0.3, DARK, 0, 0.3, 0));
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), mat(0xe0b48f));
    head.position.y = 1.12;
    g.add(head, box(0.28, 0.08, 0.28, RED, 0, 1.24, 0));
    return g;
}

function buildSnowmobile() {
    const g = new THREE.Group();
    // Body faces -Z (its nose), like the rider's board.
    g.add(box(0.9, 0.45, 2.0, RED, 0, 0.55, 0));
    g.add(box(0.8, 0.3, 0.7, RED, 0, 0.9, -0.55));
    const shield = box(0.75, 0.4, 0.05, GLASS, 0, 1.15, -0.8);
    shield.rotation.x = -0.4;
    g.add(shield);
    g.add(box(0.55, 0.12, 0.9, DARK, 0, 0.88, 0.45));                 // seat
    g.add(box(0.7, 0.3, 1.4, DARK, 0, 0.2, 0.35));                    // track
    for (const x of [-0.45, 0.45]) g.add(box(0.12, 0.05, 1.1, DARK, x, 0.04, -0.75));  // skis
    g.add(box(0.7, 0.05, 0.05, DARK, 0, 1.05, -0.35));                // handlebar
    const rider = patroller();
    rider.position.set(0, 0.45, 0.35);
    rider.scale.setScalar(0.9);
    g.add(rider);
    // Rescue sled (toboggan) on a tow bar behind.
    const sled = new THREE.Group();
    sled.add(box(0.75, 0.15, 2.1, ORANGE, 0, 0.12, 0));
    const lip = box(0.75, 0.25, 0.1, ORANGE, 0, 0.22, -1.05);
    lip.rotation.x = 0.4;
    sled.add(lip);
    sled.position.z = 2.7;
    g.add(sled);
    g.add(box(0.06, 0.06, 1.2, DARK, 0, 0.2, 1.4));                   // tow bar
    // Where the patient's feet go: lying head-first toward the snowmobile.
    g.userData.sledOffset = new THREE.Vector3(0, 0.32, 3.55);
    return g;
}

function buildHelicopter() {
    const g = new THREE.Group();
    g.add(box(1.6, 1.4, 3.0, RED, 0, 0, 0));
    g.add(box(1.62, 0.35, 3.02, WHITE, 0, -0.2, 0));                  // stripe
    const nose = box(1.4, 1.1, 0.9, GLASS, 0, 0.05, -1.8);
    g.add(nose);
    g.add(box(0.35, 0.4, 3.2, RED, 0, 0.3, 3.0));                     // tail boom
    g.add(box(0.1, 1.0, 0.6, RED, 0, 0.8, 4.5));                      // tail fin
    for (const x of [-0.85, 0.85]) {
        g.add(box(0.08, 0.08, 2.8, DARK, x, -1.05, 0));               // skids
        g.add(box(0.06, 0.4, 0.06, DARK, x, -0.85, -0.6), box(0.06, 0.4, 0.06, DARK, x, -0.85, 0.6));
    }
    g.add(box(0.3, 0.3, 0.3, DARK, 0, 0.85, 0));                      // rotor mast
    const rotor = new THREE.Group();
    rotor.add(box(9, 0.04, 0.3, DARK), box(0.3, 0.04, 9, DARK));
    rotor.position.y = 1.0;
    g.add(rotor);
    const tail = new THREE.Group();
    tail.add(box(0.04, 1.4, 0.15, DARK));
    tail.position.set(0.25, 0.8, 4.5);
    g.add(tail);
    // Winch cable down to the rider (scaled each frame).
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 4).translate(0, -0.5, 0), mat(DARK));
    cable.position.set(0.9, -0.3, 0);
    g.add(cable);
    g.userData = { rotor, tail, cable };
    return g;
}

const ease = t => t * t * (3 - 2 * t);
const easeOut = t => 1 - (1 - t) * (1 - t);
const easeIn = t => t * t;

export class Rescue {
    constructor(scene, hooks) {
        this.scene = scene;
        this.hooks = hooks;          // { groundAt, spray, sound }
        this.snowmobile = buildSnowmobile();
        this.helicopter = buildHelicopter();
        this.snowmobile.visible = this.helicopter.visible = false;
        scene.add(this.snowmobile, this.helicopter);
        this.active = false;
        // Lying on your back, head pointing down the sled (-Z): the rider's
        // up axis goes to -Z and his chest (+X) faces the sky.
        this._q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
            new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)));
        this._lie = new THREE.Quaternion();
        this.pose = clonePose(POSES.crash);
    }

    // Pick the vehicle from the injuries: the worst ones get the helicopter.
    static kindFor(body) {
        const worst = body.injuries.reduce((n, i) => Math.max(n, i.dmg), 0);
        const serious = body.injuries.filter(i => i.dmg >= 40).length;
        return worst >= 55 || serious >= 2 || body.health <= 20 ? 'helicopter' : 'snowmobile';
    }

    // rider: the Rider; at: where the rider is lying; done: called at the end.
    start(kind, rider, at, done) {
        this.kind = kind;
        this.rider = rider;
        this.at = at.clone();
        this.from = rider.root.position.clone();
        this.fromQ = rider.root.quaternion.clone();
        this.done = done;
        this.t = 0;
        this.active = true;
        const g = this.hooks.groundAt;
        // Camera: off to the side of the crash, low, looking at the action.
        // Further back for the helicopter so it fits in the shot.
        const side = at.x > 0 ? -1 : 1;                                     // toward the middle of the run
        this.camPos = kind === 'helicopter'
            ? new THREE.Vector3(at.x + side * 11, 0, at.z + 9)
            : new THREE.Vector3(at.x + side * 7, 0, at.z + 5);
        this.camPos.y = g(this.camPos.x, this.camPos.z) + (kind === 'helicopter' ? 1.8 : 2.6);
        this.focus = at.clone();
        if (kind === 'snowmobile') {
            this.snowmobile.visible = true;
            this.lane = at.x - side * 1.9;                                  // far side, so the rider stays in view
            this.duration = 6.2;
        } else {
            this.helicopter.visible = true;
            this.hover = new THREE.Vector3(at.x, at.y + 10, at.z);
            this.duration = 7.2;
        }
        this.hooks.sound?.engine(kind);
    }

    stop() {
        this.active = false;
        this.snowmobile.visible = this.helicopter.visible = false;
        if (this.rider) this.rider.root.visible = true;
        this.hooks.sound?.engine(null);
    }

    // Lay the rider out on the sled / under the cable.
    carry(pos, k, holder) {
        const r = this.rider.root;
        r.position.lerpVectors(this.from, pos, k);
        this._lie.copy(this._q);
        if (holder) this._lie.premultiply(holder.quaternion);
        r.quaternion.slerpQuaternions(this.fromQ, this._lie, k);
        // Straighten out from the slumped crash pose onto the stretcher.
        blendPose(this.pose, POSES.crash, POSES.ride, k);
        this.rider.pose = this.pose;
        this.rider.update(this.t);
    }

    update(dt) {
        if (!this.active) return;
        this.t += dt;
        const t = this.t, g = this.hooks.groundAt;
        if (this.kind === 'snowmobile') {
            // Drive down to the rider, load, tow away downhill.
            const sm = this.snowmobile;
            const stopZ = this.at.z - 2.7;                                   // sled beside the rider
            let z;
            if (t < 2.4) z = (this.at.z + 24) + (stopZ - (this.at.z + 24)) * easeOut(t / 2.4);
            else if (t < 3.6) z = stopZ;
            else z = stopZ - 32 * easeIn(Math.min(1, (t - 3.6) / 2.6));
            sm.position.set(this.lane, g(this.lane, z), z);
            // Pitch with the slope.
            const ahead = g(this.lane, z - 1), behind = g(this.lane, z + 1);
            sm.rotation.set(Math.atan2(ahead - behind, 2), 0, 0);
            sm.position.y += Math.sin(t * 25) * 0.02;
            sm.updateMatrixWorld();
            const sled = sm.localToWorld(sm.userData.sledOffset.clone());
            if (t >= 2.6) this.carry(sled, ease(Math.min(1, (t - 2.6) / 0.9)), sm);
            this.focus.lerp(t < 2.6 ? this.at : sled, Math.min(1, dt * 3));
            const moving = t < 2.4 || t >= 3.6;
            if (moving) this.hooks.spray?.(sm.position, 3);
            const d = sm.position.distanceTo(this.camPos);
            this.hooks.sound?.engineLevel(Math.max(0, 1 - d / 70), moving ? (t < 2.4 ? 0.5 : 1) : 0);
        } else {
            // Fly in, winch up, fly off.
            const h = this.helicopter, ud = h.userData;
            const start = this.hover.clone().add(new THREE.Vector3(-35, 25, -25));
            const away = this.hover.clone().add(new THREE.Vector3(45, 22, -35));
            if (t < 2.6) h.position.lerpVectors(start, this.hover, easeOut(t / 2.6));
            else if (t < 5.0) h.position.copy(this.hover).add(new THREE.Vector3(0, Math.sin(t * 2) * 0.15, 0));
            else h.position.lerpVectors(this.hover, away, easeIn(Math.min(1, (t - 5.0) / 2.2)));
            h.rotation.set(0, -0.6, t < 2.6 ? -0.15 * (1 - t / 2.6) : t > 5 ? 0.2 : 0);
            ud.rotor.rotation.y += dt * 30;
            ud.tail.rotation.x += dt * 40;
            h.updateMatrixWorld();
            // Winch: cable drops, rider is strapped in and rises to the door.
            const hook = h.localToWorld(new THREE.Vector3(0.9, -0.3, 0));
            const lift = t < 3.3 ? 0 : Math.min(1, (t - 3.3) / 1.7);
            const riderAt = this.at.clone().lerp(hook.clone().add(new THREE.Vector3(0.85, -1.2, 0)), ease(lift));
            if (t >= 2.9) this.carry(riderAt, ease(Math.min(1, (t - 2.9) / 0.4)));
            if (t >= 5.0) this.rider.root.visible = false;               // inside the cabin
            // The cable hangs straight down from the hook to the patient.
            const cableEnd = t < 3.3 ? this.at.clone().setY(this.at.y + 0.3) : riderAt.clone().setY(riderAt.y + 0.3);
            const drop = Math.min(1, Math.max(0, (t - 2.6) / 0.5));
            ud.cable.visible = t >= 2.6 && t < 5.0;
            ud.cable.scale.y = Math.max(0.01, (hook.y - cableEnd.y) * drop);
            ud.cable.rotation.set(0, 0, 0);
            ud.cable.quaternion.copy(h.quaternion).invert();             // keep it plumb
            this.focus.lerp(t < 5.0 ? riderAt.clone().lerp(h.position, 0.55) : h.position, Math.min(1, dt * 3));
            // Rotor wash kicks up snow while it's low.
            const low = h.position.y - g(h.position.x, h.position.z);
            if (low < 18) this.hooks.spray?.(new THREE.Vector3(h.position.x, g(h.position.x, h.position.z), h.position.z), Math.round(12 * (1 - low / 18)) + 2, 6);
            const d = h.position.distanceTo(this.camPos);
            this.hooks.sound?.engineLevel(Math.max(0, 1 - d / 120), 1);
        }
        if (t >= this.duration) {
            this.stop();
            this.done?.();
        }
    }
}
