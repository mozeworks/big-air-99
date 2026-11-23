// All sound is synthesized with WebAudio — no sample files. Continuous
// layers (snow hiss, wind, rail grind) are driven every frame from the
// player's state; one-shots (pop, landing slap, crash, bear…) fire on events.
// The rider can't actually talk, so his swearing comes out as a 90s TV bleep.

export class Sound {
    constructor() {
        this.ctx = null;
        this.muted = false;
        try { this.muted = localStorage.getItem('snowboard.muted') === '1'; } catch { }
    }

    // Browsers only allow audio after a user gesture.
    unlock() {
        if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.init(new AC());
    }

    // Separated from unlock() so an OfflineAudioContext can be used in tests.
    init(ctx) {
        this.ctx = ctx;
        const c = ctx;
        // When the tab is hidden the game stops updating, so stop the sound too
        // (otherwise the last snow hiss would play on forever).
        if (typeof document !== 'undefined' && ctx.suspend) {
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) ctx.suspend(); else ctx.resume();
            });
        }
        this.master = c.createGain();
        this.master.gain.value = this.muted ? 0 : 0.8;
        // Gentle limiter so stacked hits don't clip.
        const comp = c.createDynamicsCompressor();
        comp.threshold.value = -10; comp.ratio.value = 6;
        this.master.connect(comp).connect(c.destination);

        const len = c.sampleRate * 2;
        this.noise = c.createBuffer(1, len, c.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

        // Snow under the board: bandpassed noise.
        this.snow = this.loop('bandpass', 900, 0.8);
        // Wind: lowpassed noise.
        this.wind = this.loop('lowpass', 500, 0.7);
        // Rail grind: steel on steel. Noise run through a bank of narrow
        // resonances (the rail and the board edge ringing), a gritty chatter
        // layer, a low rumble through the board, and a thin stick-slip screech.
        this.grindBank = [1250, 2150, 3300, 5100].map((f, i) => ({ ...this.loop('bandpass', f, 14 + i * 4), f }));
        this.grindGrit = this.loop('highpass', 3800, 0.7);
        this.grindRumble = this.loop('lowpass', 260, 0.9);
        this.screech = ['sawtooth', 'square'].map((type, i) => {
            const o = c.createOscillator();
            o.type = type; o.frequency.value = 1900 + i * 37;
            const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 4;
            const g = c.createGain(); g.gain.value = 0;
            o.connect(f).connect(g).connect(this.master); o.start();
            return { o, g };
        });
        this.grindPhase = 0;
    }

    loop(type, freq, q) {
        const c = this.ctx;
        const src = c.createBufferSource();
        src.buffer = this.noise; src.loop = true;
        const filter = c.createBiquadFilter();
        filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
        const gain = c.createGain(); gain.gain.value = 0;
        src.connect(filter).connect(gain).connect(this.master);
        src.start();
        return { filter, gain };
    }

    setMuted(m) {
        this.muted = m;
        try { localStorage.setItem('snowboard.muted', m ? '1' : '0'); } catch { }
        if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
    }

    // Smoothly steer a continuous layer.
    set(layer, gain, freq) {
        const t = this.ctx.currentTime;
        layer.gain.gain.setTargetAtTime(gain, t, 0.06);
        if (freq) layer.filter.frequency.setTargetAtTime(freq, t, 0.08);
    }

    // Called every frame.
    update(p, input, quiet = false) {
        if (!this.ctx) return;
        const speed = p.speed, kmh = speed * 3.6;
        const onSnow = p.state === 'ride' && !quiet;
        const carve = onSnow ? Math.abs((input.left ? 1 : 0) - (input.right ? 1 : 0)) : 0;
        const brake = onSnow && input.down ? 1 : 0;
        const sp = Math.min(1, kmh / 90);
        this.set(this.snow,
            onSnow ? 0.03 + sp * 0.15 + carve * 0.13 * sp + brake * 0.25 * Math.min(1, kmh / 30) : 0,
            700 + sp * 1600 + carve * 900 + brake * 1400);
        const air = p.state === 'air';
        this.set(this.wind, quiet ? 0 : Math.min(0.35, sp * sp * 0.25 + (air ? 0.1 : 0)), 300 + sp * 900);
        this.updateGrind(p, p.state === 'rail' && !quiet);
    }

    // Metal-on-metal grinding. Speed raises the pitch and brightness; the
    // random per-frame gain jitter is what makes it a scrape instead of a tone.
    updateGrind(p, on) {
        const t = this.ctx.currentTime;
        const sp = on ? Math.min(1, p.rail.speed / 18) : 0;
        const bal = on ? Math.abs(p.rail.balance) : 0;           // scraping harder when you're off-balance
        const level = on ? 0.5 + sp * 0.4 + bal * 0.3 : 0;
        this.grindPhase += 0.016 * (3 + sp * 5);
        this.grindBank.forEach((b, i) => {
            const chatter = 0.45 + Math.random() * 0.9;
            b.gain.gain.setTargetAtTime(level * (0.28 - i * 0.04) * chatter, t, 0.025);
            b.filter.frequency.setTargetAtTime(b.f * (0.85 + sp * 0.5) * (1 + Math.sin(this.grindPhase + i * 1.7) * 0.04), t, 0.05);
        });
        this.grindGrit.gain.gain.setTargetAtTime(level * 0.1 * (0.3 + Math.random()), t, 0.02);
        this.grindRumble.gain.gain.setTargetAtTime(level * 0.28 * (0.7 + Math.random() * 0.6), t, 0.04);
        // Stick-slip screech: wavers in and out, a touch sharper when balance is shaky.
        const slip = Math.max(0, Math.sin(this.grindPhase * 1.3) + Math.sin(this.grindPhase * 3.1 + 1) * 0.6);
        this.screech.forEach((o, i) => {
            o.g.gain.setTargetAtTime(on ? level * 0.012 * slip * (0.6 + Math.random() * 0.8) : 0, t, 0.03);
            o.o.frequency.setTargetAtTime((1700 + sp * 1300 + bal * 400 + i * 41) * (1 + Math.sin(this.grindPhase * 2 + i) * 0.015), t, 0.04);
        });
    }

    // ---------------------------------------------------------------- one-shots

    // Noise burst through a filter with a quick envelope.
    burst(when, dur, gain, type, freq, q = 1, freqEnd) {
        const c = this.ctx;
        const src = c.createBufferSource(); src.buffer = this.noise;
        const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, when); f.Q.value = q;
        if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, when + dur);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(gain, when + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        src.connect(f).connect(g).connect(this.master);
        src.start(when, Math.random()); src.stop(when + dur + 0.05);
    }

    tone(when, dur, gain, type, f0, f1 = f0, attack = 0.005) {
        const c = this.ctx;
        const o = c.createOscillator(); o.type = type;
        o.frequency.setValueAtTime(f0, when);
        if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, when + dur);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(gain, when + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        o.connect(g).connect(this.master);
        o.start(when); o.stop(when + dur + 0.05);
    }

    // A vocal-ish sound: sawtooth through two vowel formants with a pitch glide.
    voice(when, dur, gain, p0, p1, vowel = 'o') {
        const c = this.ctx;
        const F = { o: [500, 900], a: [800, 1200], e: [450, 1900] }[vowel];
        const o = c.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(p0, when);
        o.frequency.exponentialRampToValueAtTime(p1, when + dur);
        const env = c.createGain();
        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.03);
        env.gain.setValueAtTime(gain, when + dur * 0.6);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        for (const [fr, q] of [[F[0], 6], [F[1], 8]]) {
            const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = q;
            o.connect(bp).connect(env);
        }
        env.connect(this.master);
        o.start(when); o.stop(when + dur + 0.05);
    }

    // The censor bleep — what the rider "said".
    // Flat, like the real thing on TV.
    bleep(when, dur) {
        const c = this.ctx;
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 1000;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.linearRampToValueAtTime(0.25, when + 0.01);
        g.gain.setValueAtTime(0.25, when + dur - 0.01);
        g.gain.linearRampToValueAtTime(0.0001, when + dur);
        o.connect(g).connect(this.master);
        o.start(when); o.stop(when + dur + 0.02);
    }

    get now() { return this.ctx.currentTime; }

    pop() {
        if (!this.ctx) return;
        const t = this.now;
        this.burst(t, 0.1, 1.0, 'bandpass', 1600, 1.5);
        this.tone(t, 0.12, 0.7, 'sine', 170, 60);
    }

    // vn = m/s into the slope. Clean landings slap, heavy ones crunch.
    land(vn, quality) {
        if (!this.ctx) return;
        const t = this.now, k = Math.min(1, vn / 14);
        this.burst(t, 0.15 + k * 0.15, 0.6 + k * 0.5, 'lowpass', 2800 + k * 2000, 0.7, 300);
        this.tone(t, 0.22, 0.45 + k * 0.4, 'sine', 120, 45);
        if (quality === 'heavy') {
            this.burst(t + 0.02, 0.3, 0.5, 'bandpass', 700, 1.5);
            this.voice(t + 0.05, 0.25, 0.35, 160, 110, 'o');      // "oof"
        } else if (quality === 'sketchy') {
            this.voice(t + 0.06, 0.18, 0.2, 180, 140, 'o');
        }
    }

    // A little arcade chime when a trick scores; brighter for big ones.
    trick(points) {
        if (!this.ctx || !points) return;
        const t = this.now, notes = points > 4000 ? [523, 659, 784, 1047] : points > 1500 ? [523, 659, 784] : [523, 659];
        notes.forEach((f, i) => this.tone(t + 0.15 + i * 0.07, 0.16, 0.12, 'square', f));
    }

    // A ringing metal partial: sine with a slow decay.
    ring(when, f, dur, gain) {
        this.tone(when, dur, gain, 'sine', f, f * 0.995, 0.002);
    }

    // Landing on the rail: a sharp steel clank that rings, then the scrape takes over.
    railOn() {
        if (!this.ctx) return;
        const t = this.now;
        this.burst(t, 0.07, 0.7, 'highpass', 2500, 1);
        this.burst(t, 0.25, 0.35, 'bandpass', 1800, 6, 900);
        [[930, 0.5], [1470, 0.4], [2310, 0.3], [3720, 0.2]].forEach(([f, d], i) => this.ring(t, f, d, 0.1 - i * 0.015));
        this.tone(t, 0.12, 0.35, 'sine', 180, 70);                // the thud of the board dropping on it
    }

    // Coming off the rail: a swoosh of air, then a bright shwiiing as the steel rings out.
    railOff() {
        if (!this.ctx) return;
        const t = this.now;
        // Swoosh: air whipping past, rising and falling.
        const src = this.ctx.createBufferSource(); src.buffer = this.noise;
        const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.6;
        f.frequency.setValueAtTime(500, t);
        f.frequency.exponentialRampToValueAtTime(4200, t + 0.3);
        f.frequency.exponentialRampToValueAtTime(1500, t + 0.55);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.16);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        src.connect(f).connect(g).connect(this.master);
        src.start(t, Math.random()); src.stop(t + 0.65);
        // Shwiiing: the grind whistles upward and dies away with a shimmering ring.
        const o = this.ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(900, t);
        o.frequency.exponentialRampToValueAtTime(4800, t + 0.28);
        o.frequency.exponentialRampToValueAtTime(3600, t + 0.8);
        const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 5;
        bp.frequency.setValueAtTime(1500, t);
        bp.frequency.exponentialRampToValueAtTime(5200, t + 0.28);
        const lfo = this.ctx.createOscillator(); lfo.frequency.value = 34;
        const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 120;
        lfo.connect(lfoGain).connect(o.frequency);
        const og = this.ctx.createGain();
        og.gain.setValueAtTime(0.0001, t);
        og.gain.exponentialRampToValueAtTime(0.09, t + 0.05);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
        o.connect(bp).connect(og).connect(this.master);
        o.start(t); lfo.start(t); o.stop(t + 0.9); lfo.stop(t + 0.9);
        [2300, 3100, 4700].forEach((fr, i) => this.ring(t + 0.1 + i * 0.03, fr, 0.7, 0.045));
    }

    // severity 0..1; hospital = the big one.
    crash(type, severity, hospital) {
        if (!this.ctx) return;
        const t = this.now;
        // Body and board hitting the snow.
        this.burst(t, 0.5, 0.9, 'lowpass', 1800, 0.7, 150);
        this.tone(t, 0.3, 0.7, 'sine', 90, 35);
        this.burst(t + 0.12, 0.35, 0.5, 'bandpass', 900, 1.2);
        if (type === 'tree') this.burst(t, 0.15, 0.9, 'highpass', 3000, 1);  // branches cracking
        // The rider: a yell, then what he said about it.
        if (hospital) {
            this.voice(t + 0.05, 0.9, 0.5, 420, 180, 'a');                     // scream
            this.bleep(t + 1.1, 0.75);                                         // BEEEEEEP
            this.voice(t + 1.85, 0.3, 0.3, 200, 150, 'a');                     // "…-ah!"
        } else if (severity > 0.4) {
            this.voice(t + 0.05, 0.45, 0.45, 300, 160, 'a');                   // "aaagh"
            this.bleep(t + 0.7, 0.45);
        } else {
            this.voice(t + 0.05, 0.3, 0.4, 200, 120, 'o');                     // "oof"
            if (Math.random() < 0.5) this.bleep(t + 0.5, 0.28);
        }
    }

    // The board snapping: a sharp crack with a woody thunk.
    snap() {
        if (!this.ctx) return;
        const t = this.now;
        this.burst(t, 0.06, 1.0, 'highpass', 2500, 1);
        this.burst(t + 0.01, 0.2, 0.6, 'bandpass', 600, 3);
        this.tone(t, 0.12, 0.4, 'square', 220, 90);
    }

    bear() {
        if (!this.ctx) return;
        const t = this.now;
        // Roar: low growling voice with rough noise on top.
        this.voice(t, 1.0, 0.6, 110, 70, 'a');
        this.voice(t + 0.02, 1.0, 0.35, 165, 95, 'o');
        this.burst(t, 1.0, 0.35, 'bandpass', 400, 1.5, 200);
        // Rider: "oh no".
        this.voice(t + 0.15, 0.4, 0.3, 260, 360, 'o');
    }

    // Rescue vehicles: a two-stroke snowmobile buzz or a helicopter's rotor
    // chop. engine(kind) starts one (null stops it); engineLevel(k) sets how
    // loud it is (0..1, by distance) and how hard it's working.
    engine(kind) {
        if (!this.ctx) return;
        const c = this.ctx, t = this.now;
        if (this.eng) {
            const old = this.eng;
            old.out.gain.setTargetAtTime(0, t, 0.15);
            setTimeout(() => old.nodes.forEach(n => n.stop()), 800);
            this.eng = null;
        }
        if (!kind) return;
        const out = c.createGain(); out.gain.value = 0;
        out.connect(this.master);
        const nodes = [];
        if (kind === 'snowmobile') {
            // Buzzy sawtooth pair through a lowpass, wobbling like a two-stroke.
            const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 2;
            lp.connect(out);
            const oscs = [95, 97.5].map(f => {
                const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
                o.connect(lp); o.start(); nodes.push(o);
                return o;
            });
            const lfo = c.createOscillator(); lfo.frequency.value = 18;
            const lfoGain = c.createGain(); lfoGain.gain.value = 6;
            lfo.connect(lfoGain);
            for (const o of oscs) lfoGain.connect(o.frequency);
            lfo.start(); nodes.push(lfo);
            this.eng = { kind, out, nodes, oscs, lp, base: 0.22 };
        } else {
            // Rotor chop: low noise and a thump, amplitude-gated ~11 times a second.
            const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
            const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 1;
            const chop = c.createGain(); chop.gain.value = 0.5;
            const thump = c.createOscillator(); thump.type = 'sine'; thump.frequency.value = 55;
            src.connect(lp).connect(chop);
            thump.connect(chop);
            chop.connect(out);
            const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 11;
            const depth = c.createGain(); depth.gain.value = 0.5;
            lfo.connect(depth).connect(chop.gain);
            // Turbine whine on top.
            const whine = c.createOscillator(); whine.type = 'sine'; whine.frequency.value = 3100;
            const wg = c.createGain(); wg.gain.value = 0.02;
            whine.connect(wg).connect(out);
            for (const n of [src, thump, lfo, whine]) { n.start(); nodes.push(n); }
            this.eng = { kind, out, nodes, base: 0.9 };
        }
    }

    engineLevel(k, rev = 0) {
        const e = this.eng;
        if (!e) return;
        const t = this.now;
        e.out.gain.setTargetAtTime(e.base * k * k, t, 0.08);
        if (e.oscs) {
            for (const [i, o] of e.oscs.entries()) o.frequency.setTargetAtTime((95 + i * 2.5) * (1 + rev * 0.6), t, 0.2);
            e.lp.frequency.setTargetAtTime(900 + rev * 900, t, 0.2);
        }
    }

    // Finish line: two "woo!"s and a victory jingle.
    cheer() {
        if (!this.ctx) return;
        const t = this.now;
        this.voice(t + 0.4, 0.5, 0.3, 420, 700, 'e');
        this.voice(t + 0.75, 0.55, 0.28, 480, 820, 'e');
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(t + 0.1 + i * 0.11, 0.2, 0.1, 'square', f));
    }

    // Ski patrol whistle.
    patrol() {
        if (!this.ctx) return;
        const t = this.now;
        this.tone(t, 0.18, 0.18, 'sine', 2600, 2700, 0.01);
        this.tone(t + 0.24, 0.35, 0.18, 'sine', 2600, 2500, 0.01);
    }
}
