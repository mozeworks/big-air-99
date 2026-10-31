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
        // Rail grind: narrow band of noise plus two metallic partials.
        this.grind = this.loop('bandpass', 2400, 6);
        this.grindTones = [1840, 2770].map(f => {
            const o = c.createOscillator();
            o.type = 'square'; o.frequency.value = f;
            const g = c.createGain(); g.gain.value = 0;
            o.connect(g).connect(this.master); o.start();
            return { o, g };
        });
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
        const g = p.state === 'rail' && !quiet ? 0.35 : 0;
        this.set(this.grind, g, 2400);
        for (const t of this.grindTones) t.g.gain.setTargetAtTime(g * 0.04, this.ctx.currentTime, 0.04);
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

    railOn() {
        if (!this.ctx) return;
        this.burst(this.now, 0.1, 0.5, 'highpass', 2000, 1);
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

    // Ski patrol whistle.
    patrol() {
        if (!this.ctx) return;
        const t = this.now;
        this.tone(t, 0.18, 0.18, 'sine', 2600, 2700, 0.01);
        this.tone(t + 0.24, 0.35, 0.18, 'sine', 2600, 2500, 0.01);
    }
}
