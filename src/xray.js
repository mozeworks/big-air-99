// X-ray film of the rider's skeleton with injuries lit up.
// Front view, so the rider's left is on the right of the picture.

const BONES = {
    head: [
        '<ellipse cx="80" cy="28" rx="17" ry="21"/>',
        '<path d="M68 42 Q80 56 92 42"/>',
    ],
    back: Array.from({ length: 9 }, (_, i) => `<rect x="76" y="${56 + i * 12}" width="8" height="9" rx="2"/>`),
    ribs: [0, 1, 2, 3, 4].map(i => `<path d="M80 ${72 + i * 9} Q${52 + i} ${76 + i * 9} ${56 + i * 2} ${92 + i * 9} M80 ${72 + i * 9} Q${108 - i} ${76 + i * 9} ${104 - i * 2} ${92 + i * 9}"/>`),
    pelvis: ['<path d="M62 168 Q80 158 98 168 L104 188 Q80 200 56 188 Z"/>'],
};

// [side, svg] — R is the rider's right, drawn on the left of the film.
const LIMB_BONES = {
    shoulder: [['R', '<line x1="78" y1="62" x2="48" y2="66"/><circle cx="46" cy="68" r="5"/>'], ['L', '<line x1="82" y1="62" x2="112" y2="66"/><circle cx="114" cy="68" r="5"/>']],
    arm: [['R', '<line x1="45" y1="72" x2="38" y2="130"/><line x1="38" y1="134" x2="32" y2="188"/>'], ['L', '<line x1="115" y1="72" x2="122" y2="130"/><line x1="122" y1="134" x2="128" y2="188"/>']],
    wrist: [['R', '<rect x="25" y="190" width="13" height="18" rx="3"/>'], ['L', '<rect x="122" y="190" width="13" height="18" rx="3"/>']],
    leg: [['R', '<line x1="68" y1="192" x2="64" y2="258"/><line x1="64" y1="272" x2="66" y2="330"/>'], ['L', '<line x1="92" y1="192" x2="96" y2="258"/><line x1="96" y1="272" x2="94" y2="330"/>']],
    knee: [['R', '<circle cx="64" cy="265" r="6"/>'], ['L', '<circle cx="96" cy="265" r="6"/>']],
    ankle: [['R', '<ellipse cx="62" cy="338" rx="9" ry="6"/>'], ['L', '<ellipse cx="98" cy="338" rx="9" ry="6"/>']],
};

const BREAKS = /broken|fractured|cracked|torn|dislocated|separated|compressed/i;

export function xraySVG(injuries, fresh = []) {
    const freshSet = new Set(fresh);
    const classFor = (part, side) => {
        const inj = injuries.find(i => i.part === part && (!side || !i.side || i.side === side));
        if (!inj) return 'bone';
        return (freshSet.has(inj) ? 'bone hurt' : 'bone old') + (BREAKS.test(inj.name) ? ' broken' : '');
    };
    let out = '';
    for (const [part, shapes] of Object.entries(BONES)) out += `<g class="${classFor(part)}">${shapes.join('')}</g>`;
    for (const [part, sides] of Object.entries(LIMB_BONES)) {
        for (const [side, svg] of sides) {
            // Upper arms belong to the shoulder injury.
            const key = part === 'arm' ? 'shoulder' : part;
            out += `<g class="${part === 'arm' ? 'bone' : classFor(key, side)}">${svg}</g>`;
        }
    }
    return `<svg class="xray" viewBox="0 0 160 360" aria-label="X-ray">
        <text x="6" y="14">R</text><text x="146" y="14">L</text>${out}</svg>`;
}
