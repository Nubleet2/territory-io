'use strict';

const Audio = (() => {
    let _ctx    = null;
    let _master = null;
    let _thrusterNode = null;
    let _thrusterGain = null;

    // Throttle map — prevent same sound spam
    const _lastPlayed = {};
    function _throttle(key, minGap) {
        const now = performance.now();
        if (_lastPlayed[key] && now - _lastPlayed[key] < minGap) return true;
        _lastPlayed[key] = now;
        return false;
    }

    function init() {
        const start = () => {
            if (_ctx) return;
            try {
                _ctx    = new (window.AudioContext || window.webkitAudioContext)();
                _master = _ctx.createGain();
                _master.gain.value = 0.4;
                _master.connect(_ctx.destination);
                _initThruster();
                document.removeEventListener('click',   start);
                document.removeEventListener('keydown', start);
            } catch(e) {}
        };
        document.addEventListener('click',   start);
        document.addEventListener('keydown', start);
    }

    // ── Distance volume — full at 0, silent at 2200 ───────────────────────────
    function _vol(x, z) {
        if (!GAME.player.mesh) return 0;
        const dx = x - GAME.player.mesh.position.x;
        const dz = z - GAME.player.mesh.position.z;
        return Math.max(0, 1 - Math.sqrt(dx*dx+dz*dz)/2200);
    }

    function _gain(vol) {
        const g = _ctx.createGain();
        g.gain.value = Math.max(0, vol);
        g.connect(_master);
        return g;
    }

    // ── PLAY — world-positioned ───────────────────────────────────────────────
    function play(type, x, z) {
        if (!_ctx) return;
        const vol = (x === undefined) ? 1 : _vol(x, z);
        if (vol < 0.02) return;
        const t = _ctx.currentTime;
        switch (type) {
            // ── Weapon fire — per class
            case 'shoot_fighter':   _shootNeedle(vol, t);  break;
            case 'shoot_assault':   _shootLaser(vol, t);   break;
            case 'shoot_scout':     _shootPiercer(vol, t); break;
            case 'shoot_carrier':   _shootRing(vol, t);    break;
            case 'shoot_engineer':  _shootHex(vol, t);     break;
            case 'shoot_dread':     _shootBomb(vol, t);    break;
            // Legacy generic
            case 'shoot':           _shootLaser(vol, t);   break;
            // Events
            case 'explode':         _explode(vol, t, false); break;
            case 'explode_big':     _explode(vol, t, true);  break;
            case 'bomb_detonate':   _bombDetonate(vol, t); break;
            case 'mine':            _mine(vol, t);         break;
            case 'capture':         _capture(vol, t);      break;
            case 'build':           _build(vol, t);        break;
            case 'building_destroy':_buildingDestroy(vol, t); break;
            case 'hit':             _hit(vol, t);          break;
            case 'levelup':         _levelup(vol, t);      break;
            case 'heal':            _heal(vol, t);         break;
            case 'contest':         _contest(vol, t);      break;
            case 'alert':           _alert(vol, t);        break;
        }
    }

    // ── THRUSTER — ambient engine hum, follows player ─────────────────────────
    function _initThruster() {
        // Layered engine: low sine rumble + filtered noise for texture
        const rumble = _ctx.createOscillator();
        const noise  = _ctx.createOscillator();
        const filt   = _ctx.createBiquadFilter();
        _thrusterGain = _ctx.createGain();

        // Low sine rumble
        rumble.type = 'sine';
        rumble.frequency.value = 48;

        // Mid-frequency sine for engine body
        noise.type = 'sine';
        noise.frequency.value = 95;

        // Gentle lowpass — removes harshness
        filt.type = 'lowpass';
        filt.frequency.value = 220;
        filt.Q.value = 0.6;

        _thrusterGain.gain.value = 0;

        rumble.connect(_thrusterGain);
        noise.connect(filt);
        filt.connect(_thrusterGain);
        _thrusterGain.connect(_master);

        rumble.start();
        noise.start();
        _thrusterNode = rumble;
    }

    function setThrusterVolume(speed, maxSpeed) {
        if (!_thrusterGain) return;
        const t = _ctx.currentTime;
        const target = 0.008 + (speed / maxSpeed) * 0.025;
        _thrusterGain.gain.setTargetAtTime(target, t, 0.2);
    }

    // ── WEAPON FIRE SOUNDS ────────────────────────────────────────────────────

    function _shootNeedle(vol, t) {
        // Fighter: sharp rapid zap
        if (_throttle('shoot_fighter', 60)) return;
        const o = _ctx.createOscillator(), g = _gain(vol*0.15);
        o.connect(g); o.type = 'square';
        o.frequency.setValueAtTime(1800, t);
        o.frequency.exponentialRampToValueAtTime(400, t+0.04);
        g.gain.setValueAtTime(vol*0.15, t);
        g.gain.exponentialRampToValueAtTime(0.001, t+0.05);
        o.start(t); o.stop(t+0.05);
    }

    function _shootLaser(vol, t) {
        // Assault: standard laser bolt
        if (_throttle('shoot_assault', 80)) return;
        const o = _ctx.createOscillator(), g = _gain(vol*0.15);
        o.connect(g); o.type = 'sawtooth';
        o.frequency.setValueAtTime(900, t);
        o.frequency.exponentialRampToValueAtTime(180, t+0.07);
        g.gain.setValueAtTime(vol*0.15, t);
        g.gain.exponentialRampToValueAtTime(0.001, t+0.07);
        o.start(t); o.stop(t+0.07);
    }

    function _shootPiercer(vol, t) {
        // Scout: fast thin beam — high whistle
        if (_throttle('shoot_scout', 70)) return;
        const o = _ctx.createOscillator(), g = _gain(vol*0.12);
        o.connect(g); o.type = 'sine';
        o.frequency.setValueAtTime(2400, t);
        o.frequency.exponentialRampToValueAtTime(600, t+0.05);
        g.gain.setValueAtTime(vol*0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t+0.05);
        o.start(t); o.stop(t+0.05);
    }

    function _shootRing(vol, t) {
        // Carrier: energy ring — low hum whoosh
        if (_throttle('shoot_carrier', 200)) return;
        const o = _ctx.createOscillator(), g = _gain(vol*0.2);
        o.connect(g); o.type = 'sine';
        o.frequency.setValueAtTime(120, t);
        o.frequency.linearRampToValueAtTime(280, t+0.1);
        o.frequency.linearRampToValueAtTime(80, t+0.3);
        g.gain.setValueAtTime(vol*0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t+0.35);
        o.start(t); o.stop(t+0.35);
    }

    function _shootHex(vol, t) {
        // Engineer: chunky hex spread — percussive thwack
        if (_throttle('shoot_engineer', 100)) return;
        const buf  = _ctx.createBuffer(1, _ctx.sampleRate*0.06, _ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,1.5);
        const src = _ctx.createBufferSource();
        const filt = _ctx.createBiquadFilter();
        const g = _gain(vol*0.2);
        src.buffer = buf; filt.type='bandpass'; filt.frequency.value=800;
        src.connect(filt); filt.connect(g);
        g.gain.setValueAtTime(vol*0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t+0.06);
        src.start(t); src.stop(t+0.06);
    }

    function _shootBomb(vol, t) {
        // Dreadnought: deep bass thud on launch
        if (_throttle('shoot_dread', 1600)) return;
        const o = _ctx.createOscillator(), g = _gain(vol*0.35);
        o.connect(g); o.type = 'sine';
        o.frequency.setValueAtTime(80, t);
        o.frequency.exponentialRampToValueAtTime(25, t+0.3);
        g.gain.setValueAtTime(vol*0.35, t);
        g.gain.exponentialRampToValueAtTime(0.001, t+0.35);
        o.start(t); o.stop(t+0.35);
    }

    // ── EVENT SOUNDS ──────────────────────────────────────────────────────────

    function _explode(vol, t, big) {
        const dur = big ? 0.6 : 0.4;
        const buf  = _ctx.createBuffer(1, _ctx.sampleRate*dur, _ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,2);
        const src  = _ctx.createBufferSource();
        const filt = _ctx.createBiquadFilter();
        const g    = _gain(vol*(big?1.0:0.75));
        src.buffer=buf; filt.type='lowpass'; filt.frequency.value=big?400:600;
        src.connect(filt); filt.connect(g);
        g.gain.setValueAtTime(vol*(big?1:0.75),t);
        g.gain.exponentialRampToValueAtTime(0.001,t+dur);
        src.start(t); src.stop(t+dur);

        const o=_ctx.createOscillator(), g2=_gain(vol*(big?0.8:0.5));
        o.connect(g2); o.type='sine';
        o.frequency.setValueAtTime(big?80:120,t);
        o.frequency.exponentialRampToValueAtTime(20,t+(big?0.5:0.3));
        g2.gain.setValueAtTime(vol*(big?0.8:0.5),t);
        g2.gain.exponentialRampToValueAtTime(0.001,t+(big?0.5:0.3));
        o.start(t); o.stop(t+(big?0.5:0.3));
    }

    function _bombDetonate(vol, t) {
        // Massive AOE detonation — low rumble + crack
        const buf  = _ctx.createBuffer(1, _ctx.sampleRate*0.8, _ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,1.4);
        const src=_ctx.createBufferSource(), filt=_ctx.createBiquadFilter(), g=_gain(vol*1.1);
        src.buffer=buf; filt.type='lowpass'; filt.frequency.value=300;
        src.connect(filt); filt.connect(g);
        g.gain.setValueAtTime(vol*1.1,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.8);
        src.start(t); src.stop(t+0.8);
        // Sub bass punch
        const o=_ctx.createOscillator(), g2=_gain(vol*0.9);
        o.connect(g2); o.type='sine';
        o.frequency.setValueAtTime(55,t); o.frequency.exponentialRampToValueAtTime(12,t+0.6);
        g2.gain.setValueAtTime(vol*0.9,t); g2.gain.exponentialRampToValueAtTime(0.001,t+0.6);
        o.start(t); o.stop(t+0.6);
    }

    function _mine(vol, t) {
        if (_throttle('mine', 120)) return;
        const o=_ctx.createOscillator(), g=_gain(vol*0.2);
        o.connect(g); o.type='triangle';
        o.frequency.setValueAtTime(400,t);
        o.frequency.exponentialRampToValueAtTime(160,t+0.09);
        g.gain.setValueAtTime(vol*0.2,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.09);
        o.start(t); o.stop(t+0.09);
    }

    function _capture(vol, t) {
        [330,440,550,660].forEach((freq,i) => {
            const o=_ctx.createOscillator(), g=_gain(vol*0.22);
            o.connect(g); o.type='sine';
            const st=t+i*0.07;
            o.frequency.setValueAtTime(freq,st);
            g.gain.setValueAtTime(vol*0.22,st);
            g.gain.exponentialRampToValueAtTime(0.001,st+0.18);
            o.start(st); o.stop(st+0.18);
        });
    }

    function _build(vol, t) {
        const o=_ctx.createOscillator(), g=_gain(vol*0.28);
        o.connect(g); o.type='square';
        o.frequency.setValueAtTime(220,t); o.frequency.setValueAtTime(440,t+0.04);
        g.gain.setValueAtTime(vol*0.28,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.12);
        o.start(t); o.stop(t+0.12);
    }

    function _buildingDestroy(vol, t) {
        // Structural crunch — lower and more metallic than ship explode
        const buf  = _ctx.createBuffer(1, _ctx.sampleRate*0.35, _ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,1.2);
        const src=_ctx.createBufferSource(), filt=_ctx.createBiquadFilter(), g=_gain(vol*0.8);
        src.buffer=buf; filt.type='bandpass'; filt.frequency.value=250; filt.Q.value=0.5;
        src.connect(filt); filt.connect(g);
        g.gain.setValueAtTime(vol*0.8,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.35);
        src.start(t); src.stop(t+0.35);
        // Metal clang overtone
        const o=_ctx.createOscillator(), g2=_gain(vol*0.3);
        o.connect(g2); o.type='sawtooth';
        o.frequency.setValueAtTime(180,t); o.frequency.exponentialRampToValueAtTime(60,t+0.2);
        g2.gain.setValueAtTime(vol*0.3,t); g2.gain.exponentialRampToValueAtTime(0.001,t+0.2);
        o.start(t); o.stop(t+0.2);
    }

    function _hit(vol, t) {
        // Sharp impact — player takes damage
        const o=_ctx.createOscillator(), g=_gain(vol*0.4);
        o.connect(g); o.type='sawtooth';
        o.frequency.setValueAtTime(300,t); o.frequency.exponentialRampToValueAtTime(80,t+0.08);
        g.gain.setValueAtTime(vol*0.4,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.08);
        o.start(t); o.stop(t+0.08);
    }

    function _levelup(vol, t) {
        // Triumphant rising chord
        [[220,0],[330,0.08],[440,0.16],[660,0.24],[880,0.32]].forEach(([freq,delay]) => {
            const o=_ctx.createOscillator(), g=_gain(vol*0.25);
            o.connect(g); o.type='triangle';
            const st=t+delay;
            o.frequency.setValueAtTime(freq,st);
            o.frequency.linearRampToValueAtTime(freq*1.02,st+0.3);
            g.gain.setValueAtTime(vol*0.25,st);
            g.gain.exponentialRampToValueAtTime(0.001,st+0.5);
            o.start(st); o.stop(st+0.5);
        });
    }

    function _heal(vol, t) {
        if (_throttle('heal', 800)) return;
        const o=_ctx.createOscillator(), g=_gain(vol*0.12);
        o.connect(g); o.type='sine';
        o.frequency.setValueAtTime(440,t); o.frequency.linearRampToValueAtTime(660,t+0.15);
        g.gain.setValueAtTime(vol*0.12,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.18);
        o.start(t); o.stop(t+0.18);
    }

    function _contest(vol, t) {
        if (_throttle('contest', 2000)) return;
        [440,330].forEach((freq,i) => {
            const o=_ctx.createOscillator(), g=_gain(vol*0.15);
            o.connect(g); o.type='square';
            const st=t+i*0.1;
            o.frequency.value=freq;
            g.gain.setValueAtTime(vol*0.15,st);
            g.gain.exponentialRampToValueAtTime(0.001,st+0.09);
            o.start(st); o.stop(st+0.09);
        });
    }

    function _alert(vol, t) {
        [880,660].forEach((freq,i) => {
            const o=_ctx.createOscillator(), g=_gain(vol*0.2);
            o.connect(g); o.type='square';
            const st=t+i*0.12;
            o.frequency.value=freq;
            g.gain.setValueAtTime(vol*0.2,st);
            g.gain.exponentialRampToValueAtTime(0.001,st+0.1);
            o.start(st); o.stop(st+0.1);
        });
    }

    return { init, play, setThrusterVolume };
})();
