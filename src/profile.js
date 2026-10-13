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
    [300, -1.05],
    [330, -0.22],
    [370, -0.06],
    [520, -0.02],
];

export const LIP_S = 206.5;
export const KICKER_START_S = 184;
export const KNUCKLE_S = 224;
export const SWEET_SPOT = [240, 285];
export const COURSE_HALF_WIDTH = 16;
export const S_MIN = -40;
export const S_MAX = 520;

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
