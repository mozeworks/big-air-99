// Solves rider poses against reference-photo targets using the same geometry
// and two-bone IK as src/rider.js, so legs really extend, knees bend over the
// toes and grab hands really reach the board.
//   node tools/solve-pose.mjs methodTweak
//   node tools/solve-pose.mjs indyGrab
// Prints a pose object to paste into POSES, plus the measured angles.
// Poses are designed regular (left foot forward); goofy mirrors them.

const THIGH = 0.46, SHIN = 0.46, UA = 0.30, FA = 0.29, ARM = UA + FA, SPINE = 0.52, STANCE = 0.27;

const rx = a => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const ry = a => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const rz = a => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const mul = (A, B) => A.map((r, i) => B[0].map((_, j) => r.reduce((s, _, k) => s + A[i][k] * B[k][j], 0)));
const app = (M, v) => M.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const scale = (a, s) => a.map(x => x * s);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const len = a => Math.hypot(...a);
const norm = a => scale(a, 1 / (len(a) || 1));
const deg = r => Math.round(r * 57.3);

function ik(a, target, l1, l2, pole) {
    let dir = sub(target, a);
    let d = len(dir); dir = scale(dir, 1 / (d || 1));
    d = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
    const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const p = norm(sub(pole, scale(dir, dot(pole, dir))));
    return add(add(a, scale(dir, l1 * cosA)), scale(p, l1 * sinA));
}
const segDist = (p, a, b) => {
    const ab = sub(b, a);
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
    return len(sub(p, add(a, scale(ab, t))));
};

// x = [torsoX, twist, torsoZ, boardX, boardY, boardZ, boardRotX, boardRotY, boardRotZ]
function measure(x, cfg) {
    const [tx, twist, tz, bx, by, bz, brx, bry, brz] = x;
    const B = mul(mul(rx(brx), ry(bry)), rz(brz));          // Euler XYZ, like the board
    const T = mul(mul(rz(tz), rx(tx)), ry(twist));           // Euler YZX (y = 0) + spine twist
    const hip = cfg.hip;
    const bp = v => add(app(B, v), [bx, by, bz]), tp = v => add(app(T, v), hip);
    const up = app(T, [0, 1, 0]), fwd = app(T, [1, 0, 0]);
    const fFoot = bp([0, 0.12, -STANCE]), bFoot = bp([0, 0.12, STANCE]);
    const fHip = tp([0, -0.02, -0.11]), bHip = tp([0, -0.02, 0.11]);
    const fSh = tp([0, SPINE - 0.06, -0.2]), bSh = tp([0, SPINE - 0.06, 0.2]);
    const pole = norm(app(B, cfg.knee));                     // kneeBoard: knees over the toes
    const fKnee = ik(fHip, fFoot, THIGH, SHIN, pole), bKnee = ik(bHip, bFoot, THIGH, SHIN, pole);
    const leg = (h, k, f) => {
        const thigh = norm(sub(k, h)), shin = norm(sub(f, k));
        return {
            ext: len(sub(f, h)) / (THIGH + SHIN),
            bend: Math.acos(Math.max(-1, Math.min(1, dot(thigh, shin)))),   // 0 = straight
            overToes: dot(sub(k, scale(add(h, f), 0.5)), pole),             // knee out over the toes
            hipSwing: dot(thigh, fwd),                                      // < 0 = thigh behind the body
        };
    };
    // The grabbing arm, with the rig's elbow pole.
    const grabSide = cfg.hand === 'front' ? -1 : 1;
    const sh = grabSide < 0 ? fSh : bSh;
    const grab = bp(cfg.grabPt);
    const elbow = ik(sh, grab, UA, FA, app(T, [-0.2, -1, 0.5 * grabSide]));
    const armClear = Math.min(...[fKnee, bKnee].map(k => Math.min(segDist(k, sh, elbow), segDist(k, elbow, grab))));
    const center = [bx, by, bz], chest = tp([0, SPINE * 0.6, 0]);
    return {
        f: leg(fHip, fKnee, fFoot), b: leg(bHip, bKnee, bFoot),
        reach: len(sub(grab, sh)) / ARM, armClear,
        arch: Math.atan2(-up[0], up[1]),                                       // + = leaning back
        boardTilt: Math.acos(Math.max(-1, Math.min(1, app(B, [0, 1, 0])[1]))), // 0 = flat
        noseUp: Math.asin(app(B, [0, 0, -1])[1]),
        boardFwd: dot(sub(center, hip), fwd),                                  // < 0 = behind the back
        boardHigh: center[1] - hip[1],
        clear: Math.min(len(sub(center, chest)), len(sub(center, hip))),
        T, up, fwd, fSh, bSh,
    };
}

const sq = v => v * v, over = (v, lim) => Math.max(0, v - lim), under = (v, lim) => Math.max(0, lim - v);
const D = Math.PI / 180;

const CONFIGS = {
    // Method in full extension (reference: regular rider, orange jacket):
    // one long line from fingertips to feet — torso fairly upright, both legs
    // opened out and swung way back behind, board trailing behind, grab arm
    // straight, free arm straight up to the sky.
    methodTweak: {
        hip: [0.16, 0.86, 0], knee: [1, 0.15, 0], hand: 'front', grabPt: [-0.13, 0.04, -0.38],
        start: [0, 0, 0.6, -0.56, 0.76, -0.18, 1.84, 0.02, -1.14],
        cost: m => 40 * sq(m.f.bend - 55 * D) + 40 * sq(m.b.ext - 0.94)
            + 4000 * sq(under(m.f.overToes, 0.05)) + 4000 * sq(under(m.b.overToes, 0.02))
            + 25 * sq(m.f.hipSwing + 0.55) + 25 * sq(m.b.hipSwing + 0.8)       // legs swung way back: the sprawl
            + 80 * sq(m.reach - 0.97) + 300 * sq(over(m.reach, 0.99))           // grab arm straight
            + 400 * sq(under(m.armClear, 0.15))
            + 10 * sq(m.arch - 22 * D)                                          // torso fairly upright; the legs make the arch
            + 20 * sq(over(m.boardFwd, -0.35))                                  // board behind
            + 6 * sq(under(m.boardTilt, 80 * D))                                // rolled up, base out
            + 30 * sq(under(m.clear, 0.32)),
        freeArm: m => norm(add(m.up, scale(m.fwd, 0.35))),                   // straight up to the sky
        freeShoulder: m => m.bSh,
    },
    // Classic indy (reference: last shot): board pulled up level in front,
    // both knees tucked over the toes, back hand on the toe edge between the
    // feet, upright torso, front arm pointing out toward the nose.
    indyGrab: {
        hip: [0.02, 0.86, 0], knee: [1, 0.35, 0], hand: 'back', grabPt: [0.13, 0.04, 0.05],
        start: [0, 0, -0.2, 0.1, 0.4, 0, 0, 0, 0.2],
        cost: m => 30 * sq(m.f.ext - 0.5) + 30 * sq(m.b.ext - 0.5)
            + 4000 * sq(under(m.f.overToes, 0.08)) + 4000 * sq(under(m.b.overToes, 0.08))
            + 60 * sq(m.reach - 0.9) + 300 * sq(over(m.reach, 0.99))
            + 400 * sq(under(m.armClear, 0.08))
            + 10 * sq(m.arch + 12 * D)                                          // slightly forward
            + 8 * sq(m.boardTilt - 15 * D) + 6 * sq(m.noseUp + 8 * D)          // near level, nose a touch down
            + 20 * sq(under(m.boardFwd, 0.1))                                   // board out in front
            + 30 * sq(under(m.clear, 0.3)),
        freeArm: () => norm([0.35, 0.25, -0.9]),                              // pointing out over the nose
        freeShoulder: m => m.fSh,
    },
};

const name = process.argv[2];
const cfg = CONFIGS[name];
if (!cfg) { console.log('poses:', Object.keys(CONFIGS).join(', ')); process.exit(1); }
const cost = x => cfg.cost(measure(x, cfg)) + 6 * sq(x[0]) + 0.5 * sq(x[1]) + 0.3 * sq(x[7]);

let seed = 11; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let best = cfg.start.slice(), bestC = cost(best);
for (let restart = 0; restart < 12; restart++) {
    let cur = restart ? best.map(v => v + (rand() - 0.5) * 0.8) : best.slice(), curC = cost(cur);
    for (let it = 0; it < 100000; it++) {
        const step = 0.2 * (1 - it / 100000) ** 2 + 0.002;
        const cand = cur.map(v => v + (rand() - 0.5) * step);
        const c = cost(cand);
        if (c < curC) { cur = cand; curC = c; }
    }
    if (curC < bestC) { best = cur; bestC = curC; }
}

const m = measure(best, cfg);
const r = v => v.map(x => +x.toFixed(2));
console.log('cost', bestC.toFixed(4));
console.log({
    frontLeg: `${deg(m.f.bend)}° bend, ${(m.f.ext * 100).toFixed(0)}% ext, overToes ${m.f.overToes.toFixed(2)}`,
    backLeg: `${deg(m.b.bend)}° bend, ${(m.b.ext * 100).toFixed(0)}% ext, overToes ${m.b.overToes.toFixed(2)}`,
    grabReach: m.reach.toFixed(2), armClear: m.armClear.toFixed(2),
    arch: deg(m.arch) + '°', boardTilt: deg(m.boardTilt) + '°', noseUp: deg(m.noseUp) + '°',
    boardFwd: m.boardFwd.toFixed(2), boardHigh: m.boardHigh.toFixed(2),
});
const hand = add(cfg.freeShoulder(m), scale(cfg.freeArm(m), ARM * 0.97));
const pose = {
    hip: cfg.hip, torso: r([best[0], 0, best[2]]), twist: +best[1].toFixed(2),
    board: r(best.slice(3, 6)), boardRot: r(best.slice(6, 9)),
    [cfg.hand === 'front' ? 'rHand' : 'lHand']: r(hand),
    [cfg.hand === 'front' ? 'grabPt' : 'rGrabPt']: cfg.grabPt, knee: cfg.knee, kneeBoard: 1,
};
console.log(JSON.stringify(pose));
