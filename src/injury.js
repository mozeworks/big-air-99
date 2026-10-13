// Injuries are the game's core rule: crashes hurt, injuries stick around
// between runs, and they change how the rider handles until you rest.

const TIERS = {
    head: [['Bell rung', 8], ['Concussion', 30], ['Severe concussion', 55]],
    wrist: [['Jammed wrist', 7], ['Sprained wrist', 15], ['Broken wrist', 40]],
    shoulder: [['Stinger', 7], ['Separated shoulder', 25], ['Dislocated shoulder', 40]],
    ribs: [['Bruised ribs', 8], ['Cracked ribs', 20], ['Broken ribs', 40]],
    back: [['Tweaked back', 10], ['Compressed vertebra', 40], ['Fractured vertebra', 70]],
    knee: [['Tweaked knee', 8], ['Sprained MCL', 20], ['Torn ACL', 45]],
    ankle: [['Rolled ankle', 8], ['Sprained ankle', 18], ['Broken ankle', 42]],
    leg: [['Charley horse', 5], ['Fractured tibia', 45], ['Broken femur', 65]],
};

// Which body parts take the hit for each way of going down.
const CRASH_TYPES = {
    flat: { label: 'Landed flat', parts: { ankle: 3, knee: 3, back: 2.5, leg: 2, head: 0.5 } },
    edge: { label: 'Caught an edge', parts: { knee: 3, wrist: 3, shoulder: 2, head: 2, ribs: 1 } },
    grab: { label: 'Landed still holding the grab', parts: { wrist: 2, shoulder: 2.5, head: 3, ribs: 2, back: 1.5 } },
    sideways: { label: 'Landed sideways', parts: { knee: 4, ankle: 3, leg: 1.5, wrist: 1.5, head: 1 } },
    tree: { label: 'Hit a tree', parts: { head: 4, ribs: 3, shoulder: 2, leg: 2, back: 1 } },
    casedeck: { label: 'Cased the deck', parts: { ankle: 3, knee: 2, back: 2, ribs: 1, wrist: 1 } },
    flip: { label: 'Under-rotated the flip — landed on your head', parts: { head: 4, back: 3.5, shoulder: 2, wrist: 1.5 } },
    rail: { label: 'Slipped off the rail', parts: { ribs: 3.5, back: 2, shoulder: 2, wrist: 1.5, head: 1, knee: 1 } },
};

export const HOSPITAL_DAMAGE = 40;
const STORE_KEY = 'snowboard.body.v1';

function pickWeighted(weights, rand) {
    const entries = Object.entries(weights);
    let total = entries.reduce((n, [, w]) => n + w, 0);
    let r = rand() * total;
    for (const [k, w] of entries) if ((r -= w) <= 0) return k;
    return entries[0][0];
}

export class Body {
    constructor(persist = true) {
        this.persist = persist;
        this.injuries = [];
        this.daysOff = 0;
        if (persist) this.load();
    }

    get health() {
        return Math.max(0, 100 - this.injuries.reduce((n, i) => n + i.dmg, 0));
    }

    get hospitalized() {
        return this.health <= 0 || this.injuries.some(i => i.dmg >= HOSPITAL_DAMAGE);
    }

    has(part, minDmg = 0) {
        return this.injuries.some(i => i.part === part && i.dmg >= minDmg);
    }

    // How injuries change the rider. Multipliers stack.
    get effects() {
        const e = { pop: 1, turn: 1, tweak: 1, grabSpeed: 1, landTolerance: 0, wobble: 0 };
        for (const i of this.injuries) {
            const sev = i.dmg / 20;
            switch (i.part) {
                case 'knee': e.pop *= 1 - 0.18 * sev; e.turn *= 1 - 0.1 * sev; e.landTolerance -= 0.6 * sev; break;
                case 'ankle': e.landTolerance -= 0.8 * sev; e.turn *= 1 - 0.08 * sev; break;
                case 'leg': e.pop *= 1 - 0.25 * sev; e.landTolerance -= 0.8 * sev; break;
                case 'wrist': e.grabSpeed *= 1 - 0.2 * sev; e.tweak *= 1 - 0.15 * sev; break;
                case 'shoulder': e.tweak *= 1 - 0.15 * sev; break;
                case 'back': e.tweak *= 1 - 0.25 * sev; e.landTolerance -= 0.5 * sev; break;
                case 'ribs': e.pop *= 1 - 0.1 * sev; break;
                case 'head': e.wobble += 0.5 * sev; break;
            }
        }
        e.pop = Math.max(0.35, e.pop);
        e.turn = Math.max(0.5, e.turn);
        e.tweak = Math.max(0.25, e.tweak);
        e.grabSpeed = Math.max(0.35, e.grabSpeed);
        return e;
    }

    // energy ~ m/s of impact. Returns the new injuries (may be empty).
    crash(type, energy, rand = Math.random) {
        const def = CRASH_TYPES[type];
        const fresh = [];
        // Below ~6 m/s you just dust yourself off most of the time.
        const count = energy < 6 ? (rand() < 0.25 ? 1 : 0)
            : energy < 11 ? 1
            : 1 + Math.floor((energy - 10) / 5 + rand() * 0.8);
        const hitThisCrash = new Set();
        for (let n = 0; n < count; n++) {
            const part = pickWeighted(def.parts, rand);
            const roll = energy + (rand() - 0.5) * 5;
            const tier = roll < 9.5 ? 0 : roll < 14.5 ? 1 : 2;
            const [name, dmg] = TIERS[part][tier];
            const existing = this.injuries.find(i => i.part === part);
            if (hitThisCrash.has(part)) {
                // Same spot twice in one slam: keep whichever is worse.
                if (existing.dmg < dmg) Object.assign(existing, { name, dmg });
                continue;
            }
            hitThisCrash.add(part);
            if (existing && existing.dmg >= dmg) {
                // Re-injuring the same spot makes it worse.
                existing.dmg = Math.round(existing.dmg * 1.25);
                existing.name = existing.name.startsWith('Re-injured') ? existing.name : 'Re-injured ' + existing.name.toLowerCase();
                fresh.push(existing);
            } else {
                if (existing) this.injuries.splice(this.injuries.indexOf(existing), 1);
                const inj = { part, name, dmg };
                this.injuries.push(inj);
                fresh.push(inj);
            }
        }
        this.save();
        return { label: def.label, injuries: fresh };
    }

    // A week off clears minor stuff and heals the rest a bit.
    rest() {
        this.daysOff += 7;
        this.injuries = this.injuries
            .map(i => ({ ...i, dmg: Math.round(i.dmg * 0.55) }))
            .filter(i => i.dmg >= 8 && !(i.dmg < HOSPITAL_DAMAGE && TIERS[i.part][0][1] >= i.dmg));
        this.save();
    }

    rehab() {
        const worst = this.injuries.reduce((n, i) => Math.max(n, i.dmg), 0);
        this.daysOff += Math.max(14, Math.round(worst * 2.5));
        this.injuries = [];
        this.save();
    }

    load() {
        try {
            const d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
            if (d) { this.injuries = d.injuries || []; this.daysOff = d.daysOff || 0; }
        } catch { /* storage unavailable: start healthy */ }
    }

    save() {
        if (!this.persist) return;
        try { localStorage.setItem(STORE_KEY, JSON.stringify({ injuries: this.injuries, daysOff: this.daysOff })); } catch { }
    }
}
