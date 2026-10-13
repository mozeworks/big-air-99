// Course centerline profile. Elevation is a function of downhill distance `s`
// (meters, s = -z in world space). It's built by integrating a grade curve, so
// every transition — the kicker ramp, the knuckle, the landing — is a smooth arc.

// [s, grade] control points. Grade is dy/ds: negative is downhill.
export const GRADE_POINTS = [
    [-40, -0.04],
    [18, -0.04],    // start deck
    [42, -0.44],    // drop-in
    [128, -0.44],
    [140, -0.12],   // flatten for the approach
    [184, -0.12],
    [205, 0.24],    // kicker transition, lip ~14°
    [206.5, 0.24],  // LIP
    [207.0, -0.90], // back face of the kicker
    [208.5, -0.90],
    [209.5, -0.05], // table top
    [219, -0.05],
    [229, -1.05],   // knuckle -> landing, ~46°
    [292, -1.05],
    [314, -0.10],   // runout flattens, then climbs to bleed off speed
    [326, 0.13],
    [374, 0.13],
    [384, 0.0],
    [390, 0.06],    // kicker 2: a big step-down. Nearly flat lip, so even
    [393, 0.06],    // fast riders fly low over a steep landing.
    [395, -0.8],    // landing starts right under the lip
    [450, -0.8],
    [466, -0.04],
    [535, -0.04],   // long flat runway: check your speed before the cliff
    [545, -0.06],   // ledge (left) or chute (right)?
    [552, -1.2],    // chute rolls over, ~50° under the cliff
    [592, -1.2],
    [625, -0.25],
    [660, -0.06],
    [800, -0.02],
];

export const LIP_S = 206.5;
export const KICKER_START_S = 184;
export const KNUCKLE_S = 224;
export const SWEET_SPOT = [240, 285];
export const LIP2_S = 393;
export const CLIFF_S = 556;
// Left side of the run (x < CLIFF_X): instead of rolling into the chute,
// a flat ledge carries on until it ends in a rock face.
export const LEDGE_START_S = 545;
export const CLIFF_X = -3;
// Things worth announcing on the HUD and pointing the photo cam at.
// maxKmh is the fastest you can hit it and still land it (from the sim).
export const FEATURES = [
    { id: 'kicker', name: 'KICKER', lip: LIP_S, maxKmh: 70 },
    { id: 'stepdown', name: 'STEP-DOWN', lip: LIP2_S, maxKmh: 60 },
    { id: 'cliff', name: 'CLIFF', lip: CLIFF_S, maxKmh: 30, side: 'left' },
];

// A straight rail on the run-in, right of center. Ollie onto it.
export const RAIL = { x: 7, s0: 80, s1: 108, height: 0.45 };
export const COURSE_HALF_WIDTH = 16;
export const S_MIN = -40;
export const S_MAX = 800;

const STEP = 0.1;
const table = [];

function gradeAt(s) {
    const pts = GRADE_POINTS;
    if (s <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
        if (s <= pts[i][0]) {
            const [s0, g0] = pts[i - 1];
            const [s1, g1] = pts[i];
            const t = (s - s0) / (s1 - s0);
            return g0 + (g1 - g0) * t;
        }
    }
    return pts[pts.length - 1][1];
}

(function build() {
    let y = 0;
    for (let s = S_MIN; s <= S_MAX + STEP; s += STEP) {
        table.push(y);
        y += gradeAt(s + STEP / 2) * STEP;
    }
    // Put the lip at a round elevation so numbers are readable.
    const lipY = table[Math.round((LIP_S - S_MIN) / STEP)];
    for (let i = 0; i < table.length; i++) table[i] -= lipY;
})();

export function profileHeight(s) {
    const f = (Math.min(Math.max(s, S_MIN), S_MAX) - S_MIN) / STEP;
    const i = Math.floor(f);
    const t = f - i;
    const a = table[i];
    const b = table[Math.min(i + 1, table.length - 1)];
    return a + (b - a) * t;
}

export function profileGrade(s) {
    return gradeAt(s);
}

// Extra height of the ledge above the chute at s (0 outside the ledge).
export function ledgeDelta(s) {
    if (s <= LEDGE_START_S || s >= CLIFF_S) return 0;
    const ledgeY = profileHeight(LEDGE_START_S) - 0.06 * (s - LEDGE_START_S);
    return Math.max(0, ledgeY - profileHeight(s));
}
