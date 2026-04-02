'use strict';

const Network = (() => {
    let _ws        = null;
    let _localId   = null;
    let _isHost    = false;
    let _connected = false;
    let _syncTimer = 0;
    let _ping      = 0;
    let _pingTimer = 0;
    const SYNC_HZ  = 1/20; // 20Hz host→clients

    // ── CONNECT ───────────────────────────────────────────────────────────
    function connect(wsUrl, onReady) {
        // Auto-detect secure websocket if served over https
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const url   = wsUrl.startsWith('ws') ? wsUrl : `${proto}://${wsUrl}`;
        _ws = new WebSocket(url);
        _ws.onopen    = ()  => { _connected = true; };
        _ws.onclose   = ()  => { _connected = false; UI.showMsg('Disconnected from server', 'err'); };
        _ws.onerror   = ()  => { UI.showMsg('Connection failed', 'err'); };
        _ws.onmessage = (e) => {
            let msg; try { msg = JSON.parse(e.data); } catch { return; }
            _onMsg(msg, onReady);
        };
    }

    function disconnect() {
        if (_ws) _ws.close();
        _ws = null; _connected = false;
        // Remove all remote player meshes
        if (GAME.remotePlayers) {
            Object.values(GAME.remotePlayers).forEach(rp => GAME.scene.remove(rp.mesh));
            GAME.remotePlayers = {};
        }
    }

    // ── MESSAGE HANDLER ───────────────────────────────────────────────────
    function _onMsg(msg, onReady) {
        switch (msg.type) {
            case 'welcome':
                _localId = msg.id;
                _isHost  = msg.isHost;
                if (onReady) onReady(_isHost, _localId);
                break;

            case 'gameState':
                if (!_isHost) _applyState(msg);
                break;

            case 'playerInput':
                if (_isHost) _applyInput(msg);
                break;

            case 'playerJoined':
                if (_isHost) _spawnRemote(msg);
                break;

            case 'playerLeft':
                _removeRemote(msg.id);
                break;

            case 'promoted':
                _isHost = true;
                UI.showMsg('Host left — you are now the host', 'info');
                break;

            case 'playerCount':
                // update UI if open
                break;

            case 'pong':
                _ping = Math.round(performance.now() - msg.t);
                break;
        }
    }

    // ── HOST: spawn a mesh for a newly joined remote player ───────────────
    function _spawnRemote(msg) {
        if (!GAME.scene) return;
        const faction   = msg.faction   || 'HELIX';
        const shipClass = msg.shipClass || 'ASSAULT';
        const sc   = SHIP_CLASSES[shipClass] || SHIP_CLASSES.ASSAULT;
        const fac  = FACTIONS[faction];
        const mesh = Render.createShipMesh(faction, shipClass);
        mesh.position.set(fac.sx+(Math.random()-0.5)*300, 8, fac.sz+(Math.random()-0.5)*300);
        GAME.scene.add(mesh);

        if (!GAME.remotePlayers) GAME.remotePlayers = {};
        GAME.remotePlayers[msg.id] = {
            id: msg.id, faction, shipClass, mesh,
            hp:        CONFIG.SHIP_HP * sc.stats.hull,
            maxHp:     CONFIG.SHIP_HP * sc.stats.hull,
            shield:    CONFIG.SHIP_HP * 0.5 * sc.stats.shield,
            maxShield: CONFIG.SHIP_HP * 0.5 * sc.stats.shield,
            vx:0, vz:0, angle:0,
            keys:{}, shoot:false, fireCooldown:0,
        };
    }

    function _removeRemote(id) {
        if (!GAME.remotePlayers || !GAME.remotePlayers[id]) return;
        GAME.scene.remove(GAME.remotePlayers[id].mesh);
        delete GAME.remotePlayers[id];
    }

    // ── HOST: apply input received from a remote player ───────────────────
    function _applyInput(msg) {
        const rp = GAME.remotePlayers && GAME.remotePlayers[msg.fromId];
        if (!rp) return;
        rp.keys  = msg.keys  || {};
        rp.angle = msg.angle || 0;
        rp.shoot = !!msg.shoot;
    }

    // ── HOST: simulate remote players every frame ─────────────────────────
    function updateRemotePlayers(dt) {
        if (!_isHost || !GAME.remotePlayers) return;
        Object.values(GAME.remotePlayers).forEach(rp => _physicsStep(rp, dt));
    }

    function _physicsStep(rp, dt) {
        const k   = rp.keys || {};
        const a   = rp.angle;
        const sc  = SHIP_CLASSES[rp.shipClass] || SHIP_CLASSES.ASSAULT;
        const spd = CONFIG.SHIP_MAX_SPEED * sc.stats.speed;
        const thr = CONFIG.SHIP_THRUST * dt;

        if (k.KeyW||k.ArrowUp)    { rp.vx-=Math.sin(a)*thr; rp.vz-=Math.cos(a)*thr; }
        if (k.KeyS||k.ArrowDown)  { rp.vx+=Math.sin(a)*thr; rp.vz+=Math.cos(a)*thr; }
        if (k.KeyA||k.ArrowLeft)  { rp.vx-=Math.cos(a)*thr; rp.vz+=Math.sin(a)*thr; }
        if (k.KeyD||k.ArrowRight) { rp.vx+=Math.cos(a)*thr; rp.vz-=Math.sin(a)*thr; }

        const drag = 1 - CONFIG.SHIP_DRAG * dt;
        rp.vx *= drag; rp.vz *= drag;
        const sp = Math.sqrt(rp.vx*rp.vx+rp.vz*rp.vz);
        if (sp > spd) { rp.vx=(rp.vx/sp)*spd; rp.vz=(rp.vz/sp)*spd; }

        rp.mesh.position.x += rp.vx * dt;
        rp.mesh.position.z += rp.vz * dt;
        rp.mesh.rotation.y  = a;

        const half = CONFIG.MAP_SIZE/2-100;
        rp.mesh.position.x = Math.max(-half,Math.min(half,rp.mesh.position.x));
        rp.mesh.position.z = Math.max(-half,Math.min(half,rp.mesh.position.z));

        rp.fireCooldown -= dt;
        if (rp.shoot && rp.fireCooldown <= 0) {
            const wep  = sc.weapon;
            rp.fireCooldown = (wep?.fireRate) || CONFIG.FIRE_RATE;
            Combat.spawnProjectile(rp.mesh.position.x, rp.mesh.position.z, a, rp.faction, 1, wep);
        }

        // Regen
        rp.hp     = Math.min(rp.maxHp,    rp.hp    + dt*3);
        rp.shield = Math.min(rp.maxShield, rp.shield + dt*2);
    }

    // ── CLIENT: apply server state snapshot ───────────────────────────────
    function _applyState(state) {
        if (!GAME.territory?.length) return;

        // Territory
        if (state.territory) {
            state.territory.forEach((t, i) => {
                const n = GAME.territory[i]; if (!n) return;
                if (n.owner !== t.owner) { n.owner=t.owner; World.setNodeColor(n,t.owner); }
                n.progress = t.progress;
            });
        }

        // Remote players (other humans incl. host)
        if (state.remotePlayers) {
            Object.entries(state.remotePlayers).forEach(([sid, rp]) => {
                const id = parseInt(sid);
                if (id === _localId) return; // skip self
                if (!GAME.remotePlayers) GAME.remotePlayers = {};

                if (!GAME.remotePlayers[id]) {
                    // create mesh
                    const mesh = Render.createShipMesh(rp.faction, rp.shipClass);
                    GAME.scene.add(mesh);
                    GAME.remotePlayers[id] = { mesh, ...rp };
                } else {
                    const e = GAME.remotePlayers[id];
                    // smooth interpolation
                    e.mesh.position.x += (rp.x - e.mesh.position.x) * 0.35;
                    e.mesh.position.z += (rp.z - e.mesh.position.z) * 0.35;
                    e.mesh.rotation.y  = rp.angle;
                    e.hp     = rp.hp;
                    e.shield = rp.shield;
                }
            });
            // Remove stale remote players
            if (GAME.remotePlayers) {
                Object.keys(GAME.remotePlayers).forEach(id => {
                    if (!state.remotePlayers[id]) _removeRemote(parseInt(id));
                });
            }
        }

        // AI ships — update positions only
        if (state.aiShips && GAME.aiShips) {
            state.aiShips.forEach((s, i) => {
                const ai = GAME.aiShips[i]; if (!ai) return;
                ai.mesh.position.x += (s.x - ai.mesh.position.x) * 0.35;
                ai.mesh.position.z += (s.z - ai.mesh.position.z) * 0.35;
                ai.mesh.rotation.y  = s.angle;
                ai.hp = s.hp;
            });
        }
    }

    // ── UPDATE — called from game loop ────────────────────────────────────
    function update(dt) {
        if (!_connected) return;

        _pingTimer -= dt;
        if (_pingTimer <= 0) {
            _pingTimer = 5;
            if (_ws.readyState === WebSocket.OPEN)
                _ws.send(JSON.stringify({ type:'ping', t: performance.now() }));
        }

        if (_isHost) {
            _syncTimer -= dt;
            if (_syncTimer <= 0) { _syncTimer = SYNC_HZ; _sendState(); }
        } else {
            _sendInput();
        }
    }

    // ── HOST: send game state snapshot ────────────────────────────────────
    function _sendState() {
        if (!_ws || _ws.readyState !== WebSocket.OPEN) return;

        const total = GAME.territory.length || 1;
        const pct = {};
        Object.keys(FACTIONS).forEach(f => {
            pct[f] = Math.round(GAME.territory.filter(n=>n.owner===f).length/total*100);
        });

        const remotePlayers = {};
        // Include all remote players
        if (GAME.remotePlayers) {
            Object.entries(GAME.remotePlayers).forEach(([id, rp]) => {
                remotePlayers[id] = {
                    x: rp.mesh.position.x, z: rp.mesh.position.z,
                    angle: rp.mesh.rotation.y,
                    hp: rp.hp, shield: rp.shield,
                    faction: rp.faction, shipClass: rp.shipClass,
                };
            });
        }
        // Include local host player
        if (GAME.player.mesh) {
            remotePlayers[_localId] = {
                x: GAME.player.mesh.position.x, z: GAME.player.mesh.position.z,
                angle: GAME.player.mesh.rotation.y,
                hp: GAME.player.hp, shield: GAME.player.shield,
                faction: GAME.player.faction, shipClass: GAME.player.shipClass,
            };
        }

        _ws.send(JSON.stringify({
            type: 'gameState',
            territoryPct: pct,
            territory: GAME.territory.map(n => ({ owner:n.owner, progress:Math.round(n.progress) })),
            remotePlayers,
            aiShips: GAME.aiShips.map(ai => ({
                x: Math.round(ai.mesh.position.x),
                z: Math.round(ai.mesh.position.z),
                angle: +ai.mesh.rotation.y.toFixed(3),
                hp: Math.round(ai.hp),
                faction: ai.faction, shipClass: ai.shipClass,
            })),
        }));
    }

    // ── CLIENT: send player input ─────────────────────────────────────────
    function _sendInput() {
        if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
        _ws.send(JSON.stringify({
            type:  'input',
            keys:  GAME.keys,
            angle: GAME.player.mesh?.rotation.y || 0,
            shoot: !!(GAME.keys['MouseLeft'] && !GAME.buildMode),
        }));
    }

    // ── SERVER BROWSER ────────────────────────────────────────────────────
    async function pingServer(host) {
        const t    = performance.now();
        const proto = location.protocol === 'https:' ? 'https' : 'http';
        // Strip any existing protocol prefix
        const cleanHost = host.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
        try {
            const res = await Promise.race([
                fetch(`${proto}://${cleanHost}/info`),
                new Promise((_,r) => setTimeout(()=>r(new Error('timeout')),3000))
            ]);
            const info = await res.json();
            info.ping = Math.round(performance.now()-t);
            info.host = cleanHost;
            return info;
        } catch { return null; }
    }

    return {
        connect, disconnect, update, updateRemotePlayers, pingServer,
        isHost:      () => _isHost,
        isConnected: () => _connected,
        getLocalId:  () => _localId,
        getPing:     () => _ping,
    };
})();
