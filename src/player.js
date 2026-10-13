import * as THREE from 'three';
import { heightAt, normalAt, LIP_S, KNUCKLE_S, S_MAX } from './course.js';
import { POSES, GRABS, clonePose, blendPose, Rider } from './rider.js';

const G = 9.81;
const MU = 0.05, MU_BRAKE = 0.5;
const DRAG = 0.0036, DRAG_TUCK = 0.0024, DRAG_BRAKE = 0.007;
const TURN_RATE = 1.8;
const GRIP = 8;
const SPIN_RATE = Math.PI * 2 * 0.95;
const FLIP_RATE = Math.PI * 2 * 0.8;
const START_S = 10;
const SUBSTEPS = 4;

// Landing thresholds, in m/s of velocity into the slope. A pro absorbs
// roughly an equivalent 4–5 m drop to flat (~9–10 m/s) with their legs.
const CLEAN_VN = 10.5;
const HEAVY_VN = 12;
const CRASH_VN = 15.5;

const UP = new THREE.Vector3(0, 1, 0);
const DEG = Math.PI / 180;

const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const X_AXIS = new THREE.Vector3(1, 0, 0);
const GRAB_KEYS = ['method', 'indy', 'stalefish', 'japan'];
const GRAB_NAMES = { method: 'Method', indy: 'Indy', stalefish: 'Stalefish', japan: 'Japan' };
const freshGrab = () => ({ held: false, type: null, time: 0, hold: 0, maxTweak: 0, used: false, done: [] });

export class Player {
    constructor(scene, course, body, events) {
        this.course = course;
        this.body = body;
        this.events = events;
        this.rider = new Rider();
        scene.add(this.rider.root);

        this.pos = new THREE.Vector3();
        this.vel = new THREE.Vector3();
        this.normal = new THREE.Vector3(0, 1, 0);
        this._target = clonePose(POSES.ride);
        this._a = new THREE.Vector3();
        this._b = new THREE.Vector3();
        this._q = new THREE.Quaternion();
        this._q2 = new THREE.Quaternion();
        this.reset();
    }

    reset() {
        const s = START_S;
        this.pos.set(0, heightAt(0, -s), -s);
        this.vel.set(0, 0, 0);
        this.yaw = 0;
        this.switchStance = false;
        this.state = 'ready';
        this.charge = 0;
        this.lean = 0;
        this.airTime = 0;
        this.spin = 0;
        this.spinVel = 0;
        this.grab = freshGrab();
        this.flip = 0;
        this.flipVel = 0;
        this.flipArmed = false;
        this.maxHeight = 0;
        this.takeoff = null;
        this.compress = 0;
        this.wobble = 0;
        this.crashT = 0;
        this.crashReported = false;
        this.tumble = new THREE.Vector3();
        this.finished = false;
        this.lastLanding = null;
        this.rider.flail = 0;
        this.rider.pose = clonePose(POSES.ride);
        this.rider.root.quaternion.identity();
        this.syncVisual(0, {});
    }

    get s() { return -this.pos.z; }
    get speed() { return this.vel.length(); }
    get heightAboveGround() { return this.pos.y - heightAt(this.pos.x, this.pos.z); }
    get grabbing() { return this.state === 'air' && this.grab.held; }
    get slowmo() { return this.grabbing && this.heightAboveGround > 3 && this.grab.time > 0.15; }

    forward(out) {
        return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    }

    update(dt, input, time) {
        const eff = this.body.effects;

        if (this.state === 'ready') {
            if (input.up || input.down || input.left || input.right) {
                this.state = 'ride';
                this.forward(this.vel).multiplyScalar(4);
            }
        } else if (this.state === 'crashed') {
            this.stepCrash(dt);
        } else {
            const h = dt / SUBSTEPS;
            for (let i = 0; i < SUBSTEPS; i++) {
                if (this.state === 'ride') this.stepGround(h, input, eff);
                else if (this.state === 'air') this.stepAir(h, input, eff);
                if (this.state === 'crashed') break;
            }
            if (this.state !== 'crashed') this.checkTrees();
            if (this.state === 'ride' && this.s > S_MAX - 40 && !this.finished) {
                this.finished = true;
                this.events.onFinish?.();
            }
        }

        this.wobble = Math.max(0, this.wobble - dt);
        this.compress = Math.max(0, this.compress - dt * 1.6);
        this.syncVisual(dt, input, time, eff);
    }

    // ------------------------------------------------------------ ground

    stepGround(h, input, eff) {
        const n = normalAt(this.pos.x, this.pos.z, this.normal);
        const v = this.vel;

        // Steering. Sketchy landings cost you control for a beat.
        const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
        const control = (this.wobble > 0 ? 0.4 : 1) * eff.turn;
        this.yaw += steer * TURN_RATE * control * h;

        // Ollie: hold to load, release to pop.
        if (input.jump) this.charge = Math.min(1, this.charge + h / 0.45);
        else if (this.charge > 0) {
            const pop = (1.6 + 1.6 * this.charge) * eff.pop;
            v.addScaledVector(n, pop);
            this.charge = 0;
            this.leaveGround(true);
            return;
        }

        // Gravity along the slope, friction, drag.
        v.addScaledVector(UP, -G * h);
        v.addScaledVector(n, -v.dot(n));
        const speed = v.length();
        const mu = input.down ? MU_BRAKE : MU;
        const drag = input.down ? DRAG_BRAKE : input.up ? DRAG_TUCK : DRAG;
        if (speed > 1e-3) {
            const decel = (mu * G * n.y + drag * speed * speed) * h;
            v.multiplyScalar(Math.max(0, speed - decel) / speed);
        }
        // Skating at the start deck.
        if (input.up && speed < 5) v.addScaledVector(this.forward(this._a), 2.5 * h);

        // Edge grip: swing velocity toward the board's direction.
        const f = this.forward(this._a);
        f.addScaledVector(n, -f.dot(n)).normalize();
        const sp = v.length();
        if (sp > 0.3) {
            const dir = this._b.copy(v).divideScalar(sp);
            const sgn = dir.dot(f) >= 0 ? 1 : -1;
            const slip = Math.sqrt(Math.max(0, 1 - dir.dot(f) ** 2));
            dir.lerp(f.multiplyScalar(sgn), Math.min(1, GRIP * h)).normalize();
            v.copy(dir).multiplyScalar(sp * (1 - 0.6 * slip * h));
            // Riding backwards means we're switch now.
            if (sgn < 0 && sp > 2) { this.yaw = wrapAngle(this.yaw + Math.PI); this.switchStance = !this.switchStance; }
        }

        // Move, then either stick to the snow or fly off it.
        const nx = this.pos.x + v.x * h, nz = this.pos.z + v.z * h;
        const ballisticY = this.pos.y + v.y * h - 0.5 * G * h * h;
        const groundY = heightAt(nx, nz);
        if (groundY < ballisticY - 0.003) {
            this.pos.set(nx, ballisticY, nz);
            this.leaveGround(false);
            return;
        }
        this.pos.set(nx, groundY, nz);
        const n2 = normalAt(nx, nz, this.normal);
        const keep = v.length();
        v.addScaledVector(n2, -v.dot(n2)).setLength(keep);

        // Keep the rider on the mountain.
        if (Math.abs(this.pos.x) > 60) { this.pos.x = Math.sign(this.pos.x) * 60; v.x *= -0.3; }
    }

    leaveGround(popped) {
        this.state = 'air';
        this.airTime = 0;
        this.spin = 0;
        this.spinVel = 0;
        this.maxHeight = 0;
        this.grab = freshGrab();
        this.flip = 0;
        this.flipVel = 0;
        this.flipArmed = false;
        const nearLip = this.s > LIP_S - 4 && this.s < LIP_S + 1.5;
        this.takeoff = { s: this.s, y: this.pos.y, popped, nearLip, speed: this.speed };
        if (popped) this.pos.y += 0.02;
        this.events.onTakeoff?.(this);
    }

    // ------------------------------------------------------------ air

    stepAir(h, input, eff) {
        const v = this.vel;
        this.airTime += h;
        v.y -= G * h;
        const sp = v.length();
        v.multiplyScalar(1 - DRAG * sp * h);
        this.pos.addScaledVector(v, h);
        this.maxHeight = Math.max(this.maxHeight, this.heightAboveGround);

        // Spins: hold left/right.
        const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
        const targetSpin = steer * SPIN_RATE;
        this.spinVel += (targetSpin - this.spinVel) * Math.min(1, (steer ? 9 : 5) * h);
        this.yaw += this.spinVel * h;
        this.spin += this.spinVel * h;

        // Flips: up = frontflip, down = backflip. Keys held from the
        // approach (tucking, braking) don't count until released once.
        if (!input.up && !input.down) this.flipArmed = true;
        const flipIn = this.flipArmed ? (input.down ? 1 : 0) - (input.up ? 1 : 0) : 0;
        this.flipVel += (flipIn * FLIP_RATE - this.flipVel) * Math.min(1, (flipIn ? 7 : 8) * h);
        this.flip += this.flipVel * h;

        // Grabs: hold to grab, keep holding to tweak it out. Switching keys
        // mid-air chains grabs into a combo.
        const g = this.grab;
        const want = this.airTime > 0.08 ? GRAB_KEYS.find(k => input[k]) : null;
        if (want && want !== g.type) {
            this.endGrab();
            g.type = want;
        }
        if (want) {
            g.held = true;
            g.used = true;
            g.time += h * eff.grabSpeed;
            g.hold += h;
            g.maxTweak = Math.max(g.maxTweak, this.tweakAmount(eff));
        } else if (g.held) {
            this.endGrab();
        }

        const groundY = heightAt(this.pos.x, this.pos.z);
        if (this.pos.y <= groundY) {
            this.pos.y = groundY;
            this.land();
        }
    }

    tweakAmount(eff) {
        return Math.min(1, Math.max(0, (this.grab.time - 0.18) / 0.7)) * eff.tweak;
    }

    endGrab() {
        const g = this.grab;
        if (g.type && g.hold > 0.2) g.done.push({ type: g.type, hold: g.hold, tweak: g.maxTweak });
        g.held = false;
        g.type = null;
        g.time = 0;
        g.hold = 0;
        g.maxTweak = 0;
    }

    land() {
        this.endGrab();
        const n = normalAt(this.pos.x, this.pos.z, this.normal);
        const v = this.vel;
        const vn = -v.dot(n);
        const vt = this._a.copy(v).addScaledVector(n, vn);
        const vtSpeed = vt.length();
        const eff = this.body.effects;
        const tol = eff.landTolerance;

        // How far the board is from pointing along the direction of travel.
        const f = this.forward(this._b);
        const hv = Math.hypot(vt.x, vt.z) || 1;
        const cos = (f.x * vt.x + f.z * vt.z) / hv;
        const misalign = Math.acos(Math.min(1, Math.abs(cos)));
        const switched = cos < 0;
        const stillGrabbing = Math.max(this.rider.pose.lGrab, this.rider.pose.rGrab) > 0.45;
        const flipOff = Math.abs(wrapAngle(this.flip));
        const s = this.s;

        let crash = null;
        if (flipOff > 65 * DEG) crash = 'flip';
        else if (stillGrabbing) crash = 'grab';
        else if (misalign > 58 * DEG) crash = 'sideways';
        else if (vn > CRASH_VN + tol) crash = 'flat';
        else if (s > LIP_S && s < KNUCKLE_S - 1 && vn > 7 + tol) crash = 'casedeck';

        const info = { vn, misalign: misalign / DEG, flipOff: flipOff / DEG, airTime: this.airTime, height: this.maxHeight, s };
        this.lastLanding = info;

        if (crash) {
            const energy = vn + vtSpeed * (crash === 'flat' || crash === 'grab' ? 0.1 : 0.18) + (crash === 'flip' ? 2 : 0);
            this.startCrash(crash, energy);
            return;
        }

        let quality = 'clean';
        let hurt = null;
        if (vn > HEAVY_VN + tol) {
            quality = 'heavy';
            // Legs took more than they could absorb.
            if (Math.random() < (vn - HEAVY_VN - tol) / 4) hurt = this.body.crash('flat', vn - 3);
        } else if (vn > CLEAN_VN + tol || misalign > 25 * DEG || flipOff > 35 * DEG) {
            quality = 'sketchy';
        }

        if (switched) { this.yaw = wrapAngle(this.yaw + Math.PI); this.switchStance = !this.switchStance; }
        v.copy(vt).multiplyScalar(1 - Math.min(0.35, vn * 0.02));
        this.state = 'ride';
        this.compress = Math.min(0.9, vn * 0.07);
        if (quality !== 'clean') this.wobble = 0.7;
        this.events.onLand?.(this, quality, info, this.scoreTrick(quality), hurt);
    }

    scoreTrick(quality) {
        const grabs = this.grab.done;
        const spinDeg = Math.round(Math.abs(this.spin) / Math.PI) * 180;
        const flips = Math.round(Math.abs(this.flip) / (Math.PI * 2));
        if (this.airTime < 0.45 && !grabs.length && spinDeg < 180 && !flips) return null;

        let pts = this.airTime * 140 + this.maxHeight * 35;
        const parts = [];
        if (flips) {
            const back = this.flip > 0;
            const times = flips === 1 ? '' : flips === 2 ? 'Double ' : 'Triple ';
            if (spinDeg >= 180) parts.push(`${times}${back ? 'Rodeo' : 'Misty'} ${spinDeg}`);
            else parts.push(`${times}${back ? 'Backflip' : 'Frontflip'}`);
            pts += flips * 1500;
        } else if (spinDeg >= 180) {
            parts.push(String(spinDeg));
        }
        if (spinDeg >= 180) pts += spinDeg * 3;

        if (grabs.length) {
            const best = Math.max(...grabs.map(g => g.tweak));
            const huge = best > 0.8 && this.maxHeight > 8;
            const names = grabs.map(g => (g.tweak > 0.75 ? 'Tweaked ' : '') + GRAB_NAMES[g.type]);
            if (huge) parts.unshift('Huge');
            parts.push(names.join(' to '));
            for (const g of grabs) pts += 400 + Math.min(g.hold, 2.5) * 450 + g.tweak * 900;
            if (new Set(grabs.map(g => g.type)).size > 1) pts *= 1.25;
        } else if (!parts.length) {
            parts.push(this.maxHeight > 6 ? 'Big Air' : 'Straight Air');
        }
        const mult = quality === 'clean' ? 1.5 : quality === 'sketchy' ? 0.6 : 0.8;
        return { name: parts.join(' '), points: Math.round(pts * mult / 10) * 10, mult };
    }

    checkTrees() {
        const t = this.course.treeNear(this.pos.x, this.pos.y, this.pos.z);
        if (t) this.startCrash('tree', this.speed * 0.9);
    }

    // ------------------------------------------------------------ crash

    startCrash(type, energy) {
        this.state = 'crashed';
        this.crashT = 0;
        this.crashReported = false;
        this.crashType = type;
        this.crashResult = this.body.crash(type, energy);
        this.crashEnergy = energy;
        const dir = this._a.copy(this.vel).setY(0).normalize();
        this.tumble.crossVectors(UP, dir).normalize();
        this.tumble.x += (Math.random() - 0.5) * 0.6;
        this.tumble.z += (Math.random() - 0.5) * 0.6;
        this.tumble.normalize();
        if (type === 'tree') this.vel.multiplyScalar(-0.15);
        this.rider.flail = 1;
        this.events.onCrash?.(this, type, energy);
    }

    stepCrash(dt) {
        this.crashT += dt;
        const v = this.vel;
        const groundY = heightAt(this.pos.x, this.pos.z);
        if (this.pos.y > groundY + 0.05) {
            v.y -= G * dt;
        } else {
            const n = normalAt(this.pos.x, this.pos.z, this.normal);
            v.addScaledVector(UP, -G * dt);
            v.addScaledVector(n, -v.dot(n));
            const sp = v.length();
            if (sp > 1e-3) v.multiplyScalar(Math.max(0, sp - 0.85 * G * n.y * dt) / sp);
            this.pos.y = groundY;
        }
        this.pos.addScaledVector(v, dt);
        const gy = heightAt(this.pos.x, this.pos.z);
        if (this.pos.y < gy) this.pos.y = gy;

        this.rider.flail = Math.max(0, this.rider.flail - dt * 0.5);
        const spin = Math.min(11, v.length() * 0.8);
        this._q.setFromAxisAngle(this.tumble, spin * dt);
        this.rider.root.quaternion.premultiply(this._q);

        if (!this.crashReported && this.crashT > 1.2 && v.length() < 1.5) {
            this.crashReported = true;
            this.events.onCrashSettled?.(this, this.crashResult);
        }
    }

    // ------------------------------------------------------------ visuals

    syncVisual(dt, input, time = 0, eff = this.body.effects) {
        const rider = this.rider;
        const root = rider.root;
        const target = this._target;

        if (this.state === 'crashed') {
            root.position.copy(this.pos).addScaledVector(UP, 0.25);
            rider.blendTo(POSES.crash, 6, dt);
            rider.update(time);
            return;
        }

        const flip = this.switchStance ? Math.PI : 0;
        const yawQ = this._q.setFromAxisAngle(UP, this.yaw);

        if (this.state === 'air') {
            // Pitch the board to the trajectory so landings read clearly.
            const hv = Math.hypot(this.vel.x, this.vel.z) || 1;
            const f = this.forward(this._a);
            const along = (f.x * this.vel.x + f.z * this.vel.z) / hv;
            const pitch = Math.atan2(this.vel.y, hv) * 0.7 * along;
            root.quaternion.copy(yawQ)
                .multiply(this._q2.setFromAxisAngle(X_AXIS, this.flip))
                .multiply(this._q2.setFromAxisAngle(X_AXIS, pitch))
                .multiply(this._q2.setFromAxisAngle(UP, flip));
            root.position.copy(this.pos);

            const g = this.grab;
            if (g.held) {
                const [from, to] = GRABS[g.type];
                blendPose(target, POSES[from], POSES[to], this.tweakAmount(eff));
                rider.blendTo(target, 16 * eff.grabSpeed, dt);
            } else if (Math.abs(this.flipVel) > 1.5) {
                rider.blendTo(POSES.flipTuck, 10, dt);
            } else {
                rider.blendTo(POSES.air, 10, dt);
            }
        } else {
            // Lean into carves; heelside/toeside depends on which way we face.
            const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
            const leanTarget = this.state === 'ride' ? steer * Math.min(1, this.speed / 10) * 0.42 : 0;
            this.lean += (leanTarget - this.lean) * Math.min(1, 6 * dt);
            const wob = this.wobble > 0 ? Math.sin(time * 22) * 0.12 * this.wobble : 0;
            const tilt = this._q2.setFromUnitVectors(UP, this.normal);
            root.quaternion.copy(tilt).multiply(yawQ)
                .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.lean + wob))
                .multiply(new THREE.Quaternion().setFromAxisAngle(UP, flip));
            root.position.copy(this.pos);

            let base = POSES.ride;
            if (input.down && this.state === 'ride') base = POSES.brake;
            else if (input.up && this.state === 'ride') base = POSES.tuck;
            const crouch = Math.max(this.charge, this.compress);
            blendPose(target, base, POSES.crouch, crouch);
            rider.blendTo(target, 12, dt);
        }
        rider.update(time);
    }
}
