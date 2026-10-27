import * as THREE from 'three';
import { buildCourse, heightAt, normalAt, LIP_S, LIP2_S, CLIFF_S, CLIFF_X, FEATURES, RAIL } from './course.js';
import { Player } from './player.js';
import { Body, effectsOf, describeEffects } from './injury.js';
import { buildSky, BlobShadow, Spray } from './fx.js';
import { xraySVG } from './xray.js';
import { POSES, GRABS, Rider, clonePose, blendPose } from './rider.js';

const params = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);

// ------------------------------------------------------------ renderer

const renderer = new THREE.WebGLRenderer({ antialias: false });
document.body.prepend(renderer.domElement);
let retro = true;
function applyResolution() {
    renderer.setPixelRatio(retro ? 0.5 : Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.domElement.classList.toggle('retro', retro);
}
applyResolution();

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd4e4f6, 90, 460);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3000);
addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    applyResolution();
});

scene.add(new THREE.HemisphereLight(0xd6e8ff, 0xf2f4f8, 1.15));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.35);
sun.position.set(70, 130, -110);
scene.add(sun);
const sky = buildSky(scene);

if (params.has('pose')) poseViewer(params.get('pose'));
else game();

// ------------------------------------------------------------ pose viewer
// ?pose=methodTweak  — turntable for tuning the rig. ?pose=method animates.
function poseViewer(name) {
    const rider = new Rider();
    rider.setGoofy(params.has('goofy'));
    scene.add(rider.root);
    const grid = new THREE.GridHelper(4, 8, 0x5577aa, 0x99aacc);
    scene.add(grid);
    const tgt = clonePose(POSES.ride);
    $('hud').style.display = 'none';
    $('panel').style.display = 'none';
    $('title').style.display = 'none';
    retro = false;
    applyResolution();
    let angle = Number(params.get('angle') ?? 0.6);
    const spin = !params.has('angle');
    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
        const t = clock.getElapsedTime();
        if (GRABS[name]) {
            const k = (Math.sin(t * 1.2) + 1) / 2;
            blendPose(tgt, POSES[GRABS[name][0]], POSES[GRABS[name][1]], k);
            rider.pose = clonePose(tgt);
        } else rider.pose = clonePose(POSES[name] || POSES.ride);
        rider.root.position.y = 0.2;
        rider.update(t);
        if (spin) angle += 0.006;
        const dist = Number(params.get('dist') ?? 3.6), camY = Number(params.get('y') ?? 1.6);
        camera.position.set(Math.sin(angle) * dist, camY, Math.cos(angle) * dist);
        camera.lookAt(0, 1.0, 0);
        sky.position.copy(camera.position);
        renderer.render(scene, camera);
    });
}

// ------------------------------------------------------------ game
function game() {
    const course = buildCourse(scene);
    const body = new Body(!params.has('demo'));
    const spray = new Spray(scene);
    const shadow = new BlobShadow(scene);

    let runScore = 0;
    let best = 0;
    try { best = Number(localStorage.getItem('snowboard.best') || 0); } catch { }

    const cam = {
        mode: 'chase', cinematic: true,
        photoPos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1),
        look: new THREE.Vector3(), snap: true, shake: 0,
    };

    const events = {
        onTakeoff(p) {
            const v = p.vel;
            if (p.takeoff.nearLip) {
                spray.emit(p.pos, { x: v.x * 0.5, y: 2, z: v.z * 0.5 }, 70, 3, 3);
                if (cam.cinematic) {
                    // A photographer standing off the side of the landing,
                    // shooting up at the apex against the sky.
                    const tApex = Math.max(0.4, v.y / 9.81);
                    const apex = p.pos.clone().addScaledVector(v, tApex);
                    const hv = Math.hypot(v.x, v.z) || 1;
                    const right = new THREE.Vector3(-v.z / hv, 0, v.x / hv);
                    // Stand on the side the rider faces, to shoot their front.
                    const side = (p.switchStance !== p.rider.goofy) ? -1 : 1;
                    const cp = apex.clone().addScaledVector(right, 11 * side).addScaledVector(v, 0.25 / hv * 6);
                    cp.y = Math.max(heightAt(cp.x, cp.z) + 1.6, p.takeoff.y - 3.5);
                    cam.photoPos.copy(cp);
                    cam.mode = 'photo';
                }
            }
        },
        onLand(p, quality, info, trick, hurt) {
            const v = p.vel;
            spray.emit(p.pos, { x: v.x * 0.3, y: 1, z: v.z * 0.3 }, Math.min(70, 15 + info.vn * 5), 4, 2.5);
            cam.shake = Math.min(1, info.vn / 14);
            if (trick) {
                runScore += trick.points;
                showTrick(trick, quality);
            } else if (quality !== 'clean') {
                showTrick({ name: '', points: 0 }, quality);
            }
            if (hurt) flashInjury(hurt.injuries);
            updateBodyHud();
        },
        onRail(p, rail) {
            runScore += rail.points;
            showTrick({ name: rail.name, points: rail.points }, 'rail');
        },
        onCrash(p, type, energy) {
            replay.crashIndex = replay.frames.length;
            spray.emit(p.pos, { x: p.vel.x * 0.4, y: 2, z: p.vel.z * 0.4 }, 160, 5, 3);
            cam.shake = 1;
            showTrick({ name: '', points: 0 }, 'crash');
            updateBodyHud();
        },
        onCrashSettled(p, result) {
            runScore = 0;
            startReplay(() => showCrashReport(result));
        },
        onFinish() {
            if (runScore > best) { best = runScore; try { localStorage.setItem('snowboard.best', String(best)); } catch { } }
            showPanel(`
                <h1>RUN COMPLETE</h1>
                <div class="big">${runScore.toLocaleString()} pts</div>
                <p>Best: ${best.toLocaleString()}</p>
                <p class="keys"><b>ENTER</b> hike back up</p>`);
        },
    };

    const player = new Player(scene, course, body, events);
    window.__game = { player, body, cam, course };

    // Stance: goofy (right foot forward) unless the rider has switched.
    let goofy = params.get('stance') !== 'regular';
    try { if (!params.has('stance') && localStorage.getItem('snowboard.stance') === 'regular') goofy = false; } catch { }
    player.rider.setGoofy(goofy);
    function setStance(g) {
        goofy = g;
        player.rider.setGoofy(g);
        try { localStorage.setItem('snowboard.stance', g ? 'goofy' : 'regular'); } catch { }
        showTitle();
        toast(g ? 'Goofy — right foot forward' : 'Regular — left foot forward');
    }

    // -------------------------------------------------------- input
    const input = { left: false, right: false, up: false, down: false, jump: false, method: false, indy: false, stalefish: false, japan: false };
    const KEYS = {
        ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
        ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
        // Left hand steers (WASD, arrows also work), right hand grabs.
        Space: 'jump', KeyH: 'method', KeyJ: 'indy', KeyK: 'stalefish', KeyL: 'japan',
    };
    addEventListener('keydown', e => {
        if (KEYS[e.code]) { input[KEYS[e.code]] = true; e.preventDefault(); }
        if (e.repeat) return;
        // Restart lives on Backspace, out of reach of the WASD hand.
        if (e.code === 'Backspace') { e.preventDefault(); restart(); }
        if (e.code === 'KeyG' && player.state === 'ready' && !panelOpen()) setStance(!goofy);
        if (e.code === 'KeyC') { cam.cinematic = !cam.cinematic; toast(`Photo cam ${cam.cinematic ? 'ON' : 'OFF'}`); }
        if (e.code === 'KeyV') { retro = !retro; applyResolution(); toast(retro ? 'Retro pixels ON' : 'Retro pixels OFF'); }
        if (e.code === 'Enter' && panelOpen()) {
            if (body.hospitalized) { body.rehab(); }
            restart();
        }
        if (e.code === 'KeyE' && panelOpen() && !body.hospitalized && body.injuries.length) {
            body.rest();
            restart();
            toast('Took a week off');
        }
    });
    addEventListener('keyup', e => { if (KEYS[e.code]) input[KEYS[e.code]] = false; });
    addEventListener('blur', () => { for (const k in input) input[k] = false; });

    function restart() {
        hidePanel();
        if (body.hospitalized) { showHospital(); return; }
        player.reset();
        replay.frames.length = 0;
        replay.crashIndex = -1;
        runScore = 0;
        cam.mode = 'chase';
        cam.snap = true;
        showTitle();
    }

    // -------------------------------------------------------- HUD
    function panelOpen() { return $('panel').classList.contains('show'); }
    function showPanel(html, wide = false) {
        $('panel').innerHTML = html;
        $('panel').classList.toggle('wide', wide);
        $('panel').classList.add('show');
    }
    function hidePanel() { $('panel').classList.remove('show'); }

    function injuryList(list, withEffects = false) {
        if (!list.length) return '<p class="ok">No injuries. Feeling good.</p>';
        return '<ul class="inj">' + list.map(i => {
            const fx = withEffects ? describeEffects(effectsOf([i])).map(d => d.short).join(' · ') : '';
            return `<li><span>${i.name}${fx ? `<small>${fx}</small>` : ''}</span><b>-${i.dmg}</b></li>`;
        }).join('') + '</ul>';
    }

    // What your injuries do to the controls, so you can ride around them.
    function effectsList(e) {
        const lines = describeEffects(e);
        if (!lines.length) return '';
        return '<ul class="fx">' + lines.map(d => `<li>${d.text}</li>`).join('') + '</ul>';
    }

    function showTitle() {
        $('title').classList.add('show');
        $('title-body').innerHTML = `<p class="stance">Stance: <b>${goofy ? 'GOOFY' : 'REGULAR'}</b> (${goofy ? 'right' : 'left'} foot forward) — <b>G</b> to switch</p>`
            + (body.injuries.length
                ? `<h2 class="hurt">RIDING HURT — THIS RUN</h2>${effectsList(body.effects)}<h2>Because of</h2>${injuryList(body.injuries, true)}`
                : '');
    }

    function showCrashReport(result) {
        const fresh = result.injuries;
        if (body.hospitalized) return showHospital(result);
        showPanel(`
            <h1 class="red">WIPEOUT</h1>
            <p class="sub">${result.label} — impact ${player.crashEnergy.toFixed(1)} m/s</p>
            <div class="xray-wrap">
                ${xraySVG(body.injuries, fresh)}
                <div>
                    ${fresh.length ? '<h2>New</h2>' + injuryList(fresh, true) : '<p class="ok">Walked it off. Nothing broken.</p>'}
                    <h2>Health ${body.health}/100</h2>
                    <div class="bar"><i style="width:${body.health}%"></i></div>
                    ${body.injuries.length ? `<h2 class="hurt">Next run</h2>${effectsList(body.effects)}` : ''}
                </div>
            </div>
            <p class="keys"><b>ENTER</b> hike back up${body.injuries.length ? ' &nbsp; <b>E</b> rest a week' : ''}</p>`, true);
    }

    function showHospital(result) {
        const worst = body.injuries.reduce((a, i) => (i.dmg > (a?.dmg ?? 0) ? i : a), null);
        const weeks = Math.max(2, Math.round((worst?.dmg ?? 40) * 2.5 / 7));
        showPanel(`
            <h1 class="red">AMBULANCE</h1>
            <p class="sub">${result ? result.label + '. ' : ''}You're not riding out of this one.</p>
            <div class="xray-wrap">
                ${xraySVG(body.injuries, result ? result.injuries : [])}
                <div>
                    ${injuryList(body.injuries)}
                    <p>Estimated recovery: <b>${weeks} weeks</b></p>
                </div>
            </div>
            <p class="keys"><b>ENTER</b> do the rehab</p>`, true);
    }

    let trickTimer = 0;
    function showTrick(trick, quality) {
        const el = $('trick');
        const labels = { clean: 'CLEAN LANDING', sketchy: 'SKETCHY', heavy: 'HEAVY LANDING', crash: '', rail: '' };
        el.innerHTML = `${trick.name ? `<div class="name">${trick.name}</div>` : ''}`
            + (quality === 'crash' ? '<div class="name red">WIPEOUT</div>' : '')
            + (trick.points ? `<div class="pts">+${trick.points.toLocaleString()}</div>` : '')
            + (labels[quality] ? `<div class="q q-${quality}">${labels[quality]}${trick.mult ? ` ×${trick.mult}` : ''}</div>` : '');
        el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
        trickTimer = 2.6;
    }

    function flashInjury(list) {
        toast(list.map(i => `${i.name} (-${i.dmg})`).join(', '), true);
    }

    let toastTimer = 0;
    function toast(msg, bad = false) {
        const el = $('toast');
        el.textContent = msg;
        el.className = 'show' + (bad ? ' bad' : '');
        toastTimer = 2.4;
    }

    function updateBodyHud() {
        const h = body.health;
        $('health-bar').style.width = h + '%';
        $('health-bar').className = h > 60 ? '' : h > 30 ? 'mid' : 'low';
        $('health-num').textContent = h;
        $('injuries').innerHTML = body.injuries.map(i => `<span>${i.name}</span>`).join('');
        $('fx').textContent = describeEffects(body.effects).map(d => d.short).join(' · ');
    }
    updateBodyHud();
    if (body.hospitalized) showHospital(); else showTitle();

    // -------------------------------------------------------- camera
    const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
    function updateCamera(dt, time) {
        const p = player;
        // Film mode: a scripted camera that tracks the rider. `cam.fixed` is
        // a position, or a function of the player for a moving camera.
        if (cam.fixed) {
            camera.position.copy(typeof cam.fixed === 'function' ? cam.fixed(p) : cam.fixed);
            tmp.copy(p.pos); tmp.y += 0.6;
            cam.look.lerp(tmp, cam.snap ? 1 : 1 - Math.exp(-12 * dt));
            cam.snap = false;
            camera.fov = cam.fov || 48;
            camera.lookAt(cam.look);
            camera.updateProjectionMatrix();
            sky.position.copy(camera.position);
            return;
        }
        // Stay on the photographer until the rider is coming down to land.
        const timeToGround = p.vel.y < 0 ? p.heightAboveGround / -p.vel.y : Infinity;
        if (cam.mode === 'photo' && (p.state !== 'air' || timeToGround < 0.7)) {
            cam.mode = 'chase';
            cam.snap = true;
        }

        if (cam.mode === 'photo') {
            camera.position.copy(cam.photoPos);
            tmp.copy(p.pos); tmp.y += 0.6;
            cam.look.lerp(tmp, 1 - Math.exp(-14 * dt));
            camera.fov += (48 - camera.fov) * Math.min(1, dt * 4);
        } else {
            const hv = Math.hypot(p.vel.x, p.vel.z);
            if (hv > 1.5) tmp.set(p.vel.x / hv, 0, p.vel.z / hv);
            else p.forward(tmp);
            cam.dir.lerp(tmp, cam.snap ? 1 : 1 - Math.exp(-3 * dt)).normalize();

            const back = p.state === 'crashed' ? 9 : 7.2;
            tmp2.copy(p.pos).addScaledVector(cam.dir, -back);
            tmp2.y = Math.max(p.pos.y + 2.7, heightAt(tmp2.x, tmp2.z) + 1.4);
            if (cam.snap) camera.position.copy(tmp2);
            else camera.position.lerp(tmp2, 1 - Math.exp(-7 * dt));

            tmp.copy(p.pos).addScaledVector(cam.dir, 5); tmp.y = p.pos.y + 0.7;
            if (cam.snap) cam.look.copy(tmp); else cam.look.lerp(tmp, 1 - Math.exp(-10 * dt));
            const fovTarget = 60 + Math.min(14, p.speed * 0.45);
            camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 3);
            cam.snap = false;
        }

        camera.lookAt(cam.look);
        const wob = body.effects.wobble;
        if (cam.shake > 0 || wob > 0) {
            const k = cam.shake * 0.12;
            camera.rotation.z += Math.sin(time * 41) * k + Math.sin(time * 0.9) * wob * 0.05;
            camera.rotation.x += Math.cos(time * 37) * k * 0.6;
            cam.shake = Math.max(0, cam.shake - dt * 2.5);
        }
        renderer.domElement.style.filter = wob > 0.6 ? `blur(${Math.min(2, (wob - 0.6) * 1.5)}px)` : '';
        camera.updateProjectionMatrix();
        sky.position.copy(camera.position);
    }

    // -------------------------------------------------------- demo
    // ?demo — rides the line by itself: pops the lip, holds a method and
    // lets go before touchdown. ?demo=late holds it too long, on purpose.
    // ?demo=indy|stalefish|japan picks the grab, ?demo=flip throws a
    // backflip method, ?demo=badflip under-rotates one.
    const demo = params.has('demo');
    const demoMode = params.get('demo') || '';
    const demoLate = demoMode === 'late';
    const demoGrab = GRABS[demoMode] ? demoMode : 'method';
    let demoWait = 0;
    function autopilot() {
        const p = player;
        for (const k in input) input[k] = false;
        if (p.state === 'ready') { input.up = true; return; }
        if (p.state === 'rail') {
            const lean = p.rail.balance + p.rail.balVel * 0.35;
            if (lean > 0.04) input.left = true; else if (lean < -0.04) input.right = true;
            return;
        }
        if (p.state === 'ride') {
            const s = p.s, kmh = p.speed * 3.6;
            let targetX = 0;
            if (demoMode === 'rail' && s > 20 && s < RAIL.s1 + 4) targetX = RAIL.x;
            if (s > 440) targetX = demoMode === 'chute' ? 6 : -9;
            const aim = wrapYaw(p.yaw) - Math.max(-0.25, Math.min(0.25, (p.pos.x - targetX) * 0.08));
            if (aim > 0.03) input.right = true; else if (aim < -0.03) input.left = true;
            if (s < 60) input.up = true;
            // Speed checks before the step-down and the cliff.
            if (s > 330 && s < LIP2_S - 1 && kmh > 57) input.down = true;
            if (demoMode !== 'chute' && s > 470 && s < CLIFF_S - 2 && kmh > 24) input.down = true;
            const toLip = LIP_S - s;
            input.jump = (toLip < 5 && toLip > 0.6)
                || (demoMode === 'rail' && s > RAIL.s0 - 9 && s < RAIL.s0 - 1.5 && Math.abs(p.pos.x - RAIL.x) < 0.8);
        } else if (p.state === 'air') {
            const h = p.heightAboveGround;
            const timeToGround = p.vel.y < 0 ? h / -p.vel.y : 9;
            input[demoGrab] = p.airTime > 0.15 && (demoLate || timeToGround > 0.55);
            if (demoMode === 'flip' || demoMode === 'badflip') {
                const target = demoMode === 'flip' ? Math.PI * 2 : Math.PI * 1.4;
                input.down = p.airTime > 0.1 && p.flip < target - 0.65;
            }
        }
    }
    const wrapYaw = a => Math.atan2(Math.sin(a), Math.cos(a));

    // -------------------------------------------------------- replay
    // The last few seconds are always being recorded. After a slam, play
    // them back in slow-mo from a camera circling the crash site.
    const replay = { frames: [], crashIndex: -1, active: false, cursor: 0, done: null, start: 0, spin: 0 };
    const REPLAY_SECONDS = 7, REPLAY_SPEED = 0.35;
    const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3();
    const replayPose = clonePose(POSES.ride);

    function record(time) {
        const r = player.rider;
        replay.frames.push({
            t: time,
            pos: player.pos.clone(),
            root: r.root.position.clone(),
            quat: r.root.quaternion.clone(),
            pose: clonePose(r.pose),
            flail: r.flail,
        });
        while (replay.frames.length && replay.frames[0].t < time - REPLAY_SECONDS) {
            replay.frames.shift();
            replay.crashIndex--;
        }
    }

    function startReplay(done) {
        const f = replay.frames;
        if (!f.length || replay.crashIndex < 0) return done();
        const crashT = f[Math.min(replay.crashIndex, f.length - 1)].t;
        replay.cursor = Math.max(f[0].t, crashT - 2.2);
        replay.end = f[f.length - 1].t;
        replay.center = f.find(fr => fr.t >= replay.cursor).pos.clone();
        replay.spin = Math.atan2(player.vel.x, player.vel.z) + Math.PI / 2;
        replay.active = true;
        replay.done = done;
        document.body.classList.add('replaying');
    }

    function endReplay() {
        replay.active = false;
        replay.frames.length = 0;
        replay.crashIndex = -1;
        document.body.classList.remove('replaying');
        const done = replay.done;
        replay.done = null;
        done?.();
    }

    function stepReplay(real) {
        replay.cursor += real * REPLAY_SPEED;
        if (replay.cursor >= replay.end) return endReplay();
        const f = replay.frames;
        let i = 0;
        while (i < f.length - 2 && f[i + 1].t < replay.cursor) i++;
        const a = f[i], b = f[i + 1] || a;
        const k = b.t > a.t ? Math.min(1, Math.max(0, (replay.cursor - a.t) / (b.t - a.t))) : 0;
        const r = player.rider;
        r.root.position.lerpVectors(a.root, b.root, k);
        r.root.quaternion.slerpQuaternions(a.quat, b.quat, k);
        blendPose(replayPose, a.pose, b.pose, k);
        r.pose = replayPose;
        r.flail = a.flail;
        r.update(replay.cursor);
        _p.lerpVectors(a.pos, b.pos, k);

        // Orbit the rider, drifting with them toward the crash site.
        replay.spin += real * 0.22;
        const c = replay.center.lerp(_p, 1 - Math.exp(-3 * real));
        camera.position.set(c.x + Math.sin(replay.spin) * 9, 0, c.z + Math.cos(replay.spin) * 9);
        camera.position.y = Math.max(c.y + 3, heightAt(camera.position.x, camera.position.z) + 1.6);
        cam.look.lerp(_p.clone().setY(_p.y + 0.6), 1 - Math.exp(-8 * real));
        camera.lookAt(cam.look);
        camera.fov += (50 - camera.fov) * Math.min(1, real * 3);
        camera.updateProjectionMatrix();
        sky.position.copy(camera.position);
        return _p;
    }

    addEventListener('keydown', e => {
        if (replay.active && (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape')) {
            e.stopImmediatePropagation();
            endReplay();
        }
    }, true);

    // -------------------------------------------------------- loop
    const clock = new THREE.Clock();
    let timeScale = 1;
    let time = 0;
    // One frame of the game. `real` is the frame's wall-clock length.
    // ?film stops the live loop so tools can step frames at a fixed rate
    // (window.__game.frame) and record them, e.g. for video clips.
    const film = params.has('film');
    window.__game.frame = real => frame(real);
    window.__game.camera = camera;
    renderer.setAnimationLoop(() => {
        const real = Math.min(clock.getDelta(), 1 / 20);
        if (!film) frame(real);
    });
    function frame(real) {
        timeScale += ((player.slowmo ? 0.45 : 1) - timeScale) * Math.min(1, real * 6);
        const dt = real * timeScale;
        time += dt;

        if (replay.active) {
            const p = stepReplay(real);
            spray.update(dt);
            if (p) {
                const gy = heightAt(p.x, p.z);
                shadow.update(p.x, gy, p.z, normalAt(p.x, p.z, tmp2), Math.max(0, p.y - gy), player.yaw);
            }
            $('trick').classList.remove('pop');
            renderer.render(scene, camera);
            return;
        }

        if (demo) autopilot();
        if (!panelOpen()) {
            if (player.state === 'ready' && (input.up || input.down || input.left || input.right)) $('title').classList.remove('show');
            player.update(dt, input, time);
            if (player.state !== 'ready') record(time);
        } else if (demo && (demoWait += real) > 3) {
            demoWait = 0;
            if (body.hospitalized) body.rehab();
            restart();
        }

        // Spray off the board edge while carving or braking.
        if (player.state === 'ride' && player.speed > 6) {
            const carve = Math.abs((input.left ? 1 : 0) - (input.right ? 1 : 0)) + (input.down ? 1.5 : 0);
            if (carve > 0 && Math.random() < 0.9) {
                const v = player.vel;
                tmp.copy(player.pos);
                spray.emit(tmp, { x: v.x * 0.25, y: 1.2, z: v.z * 0.25 }, Math.round(carve * 3), 2.4, 1.6);
            }
        }
        spray.update(dt);

        const gy = heightAt(player.pos.x, player.pos.z);
        const n = normalAt(player.pos.x, player.pos.z, tmp2);
        shadow.update(player.pos.x, gy, player.pos.z, n, Math.max(0, player.pos.y - gy), player.yaw);

        updateCamera(real, time);

        // HUD
        $('speed').textContent = Math.round(player.speed * 3.6);
        const air = player.state === 'air' ? player.heightAboveGround : 0;
        $('air').textContent = air > 1 ? `${air.toFixed(1)} m` : '';
        $('score').textContent = runScore.toLocaleString();
        $('best').textContent = best.toLocaleString();
        // Next feature ahead, how far, and how fast you can hit it.
        const next = FEATURES.find(f => f.lip > player.s && (f.side !== 'left' || player.s < CLIFF_S - 60 || player.pos.x < CLIFF_X));
        const toNext = next ? next.lip - player.s : Infinity;
        const kmh = player.speed * 3.6;
        const warn = next && toNext < 160 && player.state === 'ride';
        $('lip').textContent = warn ? `${next.name} ${Math.round(toNext)} m · MAX ${next.maxKmh}` : '';
        $('speed').parentElement.classList.toggle('hot', !!warn && kmh > next.maxKmh);
        $('balance').classList.toggle('show', player.state === 'rail');
        if (player.state === 'rail') $('balance-dot').style.left = `${50 + player.rail.balance * 50}%`;
        $('slowmo').classList.toggle('show', timeScale < 0.8);

        if (trickTimer > 0 && (trickTimer -= real) <= 0) $('trick').classList.remove('pop');
        if (toastTimer > 0 && (toastTimer -= real) <= 0) $('toast').className = '';

        renderer.render(scene, camera);
    }
}
