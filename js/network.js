'use strict';

const Network = (() => {
    let _ws        = null;
    let _localId   = null;
    let _isHost    = false;
    let _connected = false;
    let _syncTimer = 0;
    let _ping      = 0;
    let _pingTimer = 0;
    let _worldReady = false;  // client: has world been built from host state?
    const SYNC_HZ  = 1/20;

    // Client-side mesh pools for AI ships and projectiles
    const _clientAIMeshes  = [];
    const _clientProjMeshes = [];

    // ── CONNECT ───────────────────────────────────────────────────────────
    function connect(wsUrl, onReady) {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const clean = wsUrl.replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const url   = `${proto}://${clean}`;
        _ws = new WebSocket(url);
        _ws.onopen    = () => { _connected = true; };
        _ws.onclose   = () => { _connected = false; UI.showMsg('Disconnected', 'err'); };
        _ws.onerror   = () => { UI.showMsg('Connection failed', 'err'); };
        _ws.onmessage = (e) => {
            let msg; try { msg = JSON.parse(e.data); } catch { return; }
            _onMsg(msg, onReady);
        };
    }

    function disconnect() {
        if (_ws) _ws.close();
        _ws = null; _connected = false;
        _clientAIMeshes.forEach(m => GAME.scene?.remove(m.mesh));
        _clientAIMeshes.length = 0;
        _clientProjMeshes.forEach(m => GAME.scene?.remove(m.mesh));
        _clientProjMeshes.length = 0;
        _worldReady = false;
        if (GAME.remotePlayers) {
            Object.values(GAME.remotePlayers).forEach(rp => GAME.scene?.remove(rp.mesh));
            GAME.remotePlayers = {};
        }
    }

    // ── MESSAGE HANDLER ───────────────────────────────────────────────────
    function _onMsg(msg, onReady) {
        switch (msg.type) {
            case 'welcome':
                _localId = msg.id;
                _isHost  = msg.isHost;
                // Send our identity immediately
                setTimeout(() => _sendJoin(), 150);
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
                UI.showMsg('You are now the host', 'info');
                // Take over AI
                if (!GAME.aiShips.length) AI.init();
                break;

            case 'pong':
                _ping = Math.round(performance.now() - msg.t);
                break;
        }
    }

    function _sendJoin() {
        if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
        _ws.send(JSON.stringify({
            type:      'join',
            faction:   GAME.player.faction,
            shipClass: GAME.player.shipClass,
        }));
    }

    // ── HOST: spawn mesh for newly joined remote player ───────────────────
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
            id:msg.id, faction, shipClass, mesh,
            hp:CONFIG.SHIP_HP*sc.stats.hull, maxHp:CONFIG.SHIP_HP*sc.stats.hull,
            shield:CONFIG.SHIP_HP*0.5*sc.stats.shield, maxShield:CONFIG.SHIP_HP*0.5*sc.stats.shield,
            vx:0, vz:0, angle:0, keys:{}, shoot:false, fireCooldown:0,
        };
    }

    function _removeRemote(id) {
        if (!GAME.remotePlayers?.[id]) return;
        GAME.scene?.remove(GAME.remotePlayers[id].mesh);
        delete GAME.remotePlayers[id];
    }

    // ── HOST: apply input from remote player ──────────────────────────────
    function _applyInput(msg) {
        const rp = GAME.remotePlayers?.[msg.fromId];
        if (!rp) return;
        rp.keys  = msg.keys  || {};
        rp.angle = msg.angle || 0;
        rp.shoot = !!msg.shoot;
    }

    // ── HOST: simulate remote players ────────────────────────────────────
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
        const drag=1-CONFIG.SHIP_DRAG*dt;
        rp.vx*=drag; rp.vz*=drag;
        const sp=Math.sqrt(rp.vx*rp.vx+rp.vz*rp.vz);
        if(sp>spd){rp.vx=(rp.vx/sp)*spd;rp.vz=(rp.vz/sp)*spd;}
        rp.mesh.position.x+=rp.vx*dt; rp.mesh.position.z+=rp.vz*dt;
        rp.mesh.rotation.y=a;
        const half=CONFIG.MAP_SIZE/2-100;
        rp.mesh.position.x=Math.max(-half,Math.min(half,rp.mesh.position.x));
        rp.mesh.position.z=Math.max(-half,Math.min(half,rp.mesh.position.z));
        rp.fireCooldown-=dt;
        if(rp.shoot&&rp.fireCooldown<=0){
            const wep=sc.weapon;
            rp.fireCooldown=(wep?.fireRate)||CONFIG.FIRE_RATE;
            Combat.spawnProjectile(rp.mesh.position.x,rp.mesh.position.z,a,rp.faction,1,wep);
        }
        rp.hp=Math.min(rp.maxHp,rp.hp+dt*3);
        rp.shield=Math.min(rp.maxShield,rp.shield+dt*2);
    }

    // ── CLIENT: apply host game state ─────────────────────────────────────
    function _applyState(state) {
        // Build world from host data on first state received
        if (!_worldReady && state.worldLayout) {
            _buildClientWorld(state.worldLayout);
            _worldReady = true;
        }
        if (!_worldReady) return;

        // Territory ownership
        if (state.territory && GAME.territory.length) {
            state.territory.forEach((t, i) => {
                const n = GAME.territory[i]; if (!n) return;
                if (n.owner !== t.owner) { n.owner=t.owner; World.setNodeColor(n,t.owner); }
                n.progress = t.progress;
            });
        }

        // AI ships — create/update meshes
        if (state.aiShips) {
            // Create missing meshes
            while (_clientAIMeshes.length < state.aiShips.length) {
                const s   = state.aiShips[_clientAIMeshes.length];
                const mesh = Render.createShipMesh(s.faction, s.shipClass);
                GAME.scene.add(mesh);
                _clientAIMeshes.push({ mesh, faction:s.faction, shipClass:s.shipClass });
            }
            // Remove excess
            while (_clientAIMeshes.length > state.aiShips.length) {
                const e = _clientAIMeshes.pop();
                GAME.scene.remove(e.mesh);
            }
            // Update positions
            state.aiShips.forEach((s, i) => {
                const e = _clientAIMeshes[i];
                e.mesh.position.x += (s.x - e.mesh.position.x) * 0.4;
                e.mesh.position.z += (s.z - e.mesh.position.z) * 0.4;
                e.mesh.rotation.y  = s.angle;
            });
        }

        // Projectiles — render host's projectiles on client
        if (state.projectiles) {
            // Expand pool
            while (_clientProjMeshes.length < state.projectiles.length) {
                const geo  = new THREE.BoxGeometry(3.5, 3.5, 18);
                const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color:0xffffff }));
                GAME.scene.add(mesh);
                _clientProjMeshes.push({ mesh });
            }
            state.projectiles.forEach((p, i) => {
                const e = _clientProjMeshes[i];
                e.mesh.visible    = true;
                e.mesh.position.set(p.x, 7, p.z);
                e.mesh.rotation.y = p.a;
                e.mesh.material.color.setHex(FACTIONS[p.f]?.color || 0xffffff);
            });
            for (let i = state.projectiles.length; i < _clientProjMeshes.length; i++)
                _clientProjMeshes[i].mesh.visible = false;
        }

        // Remote players (everyone else including host)
        if (state.remotePlayers) {
            if (!GAME.remotePlayers) GAME.remotePlayers = {};
            Object.entries(state.remotePlayers).forEach(([sid, rp]) => {
                const id = parseInt(sid);
                if (id === _localId) return; // skip self
                if (!GAME.remotePlayers[id]) {
                    const mesh = Render.createShipMesh(rp.faction, rp.shipClass);
                    mesh.position.set(rp.x, 8, rp.z);
                    GAME.scene.add(mesh);
                    GAME.remotePlayers[id] = { mesh, ...rp };
                } else {
                    const e = GAME.remotePlayers[id];
                    e.mesh.position.x += (rp.x - e.mesh.position.x) * 0.35;
                    e.mesh.position.z += (rp.z - e.mesh.position.z) * 0.35;
                    e.mesh.rotation.y  = rp.angle;
                    e.hp     = rp.hp;
                    e.shield = rp.shield;
                }
            });
            // Remove stale
            Object.keys(GAME.remotePlayers).forEach(id => {
                if (!state.remotePlayers[id]) _removeRemote(parseInt(id));
            });
        }
    }

    // Build client world from host layout data
    function _buildClientWorld(layout) {
        // Clear any existing territory meshes
        GAME.territory.forEach(n => GAME.scene.remove(n.group));
        GAME.territory = [];
        GAME.resources.forEach(r => GAME.scene.remove(r.group));
        GAME.resources = [];

        // Rebuild using host positions
        layout.nodes.forEach(([x, z]) => {
            World.addNodeAt(x, z);
        });
        layout.resources.forEach(([x, z]) => {
            World.addResourceAt(x, z);
        });
    }

    // ── UPDATE ────────────────────────────────────────────────────────────
    function update(dt) {
        if (!_connected) return;
        _pingTimer -= dt;
        if (_pingTimer <= 0) {
            _pingTimer = 5;
            if (_ws.readyState === WebSocket.OPEN)
                _ws.send(JSON.stringify({ type:'ping', t:performance.now() }));
        }
        if (_isHost) {
            _syncTimer -= dt;
            if (_syncTimer <= 0) { _syncTimer = SYNC_HZ; _sendState(); }
        } else {
            _sendInput();
        }
    }

    // ── HOST: send full game state ────────────────────────────────────────
    function _sendState() {
        if (!_ws || _ws.readyState !== WebSocket.OPEN) return;

        const total = GAME.territory.length || 1;
        const pct   = {};
        Object.keys(FACTIONS).forEach(f => {
            pct[f] = Math.round(GAME.territory.filter(n=>n.owner===f).length/total*100);
        });

        const remotePlayers = {};
        if (GAME.remotePlayers) {
            Object.entries(GAME.remotePlayers).forEach(([id, rp]) => {
                remotePlayers[id] = {
                    x:rp.mesh.position.x, z:rp.mesh.position.z,
                    angle:rp.mesh.rotation.y, hp:rp.hp, shield:rp.shield,
                    faction:rp.faction, shipClass:rp.shipClass,
                };
            });
        }
        if (GAME.player.mesh) {
            remotePlayers[_localId] = {
                x:GAME.player.mesh.position.x, z:GAME.player.mesh.position.z,
                angle:GAME.player.mesh.rotation.y,
                hp:GAME.player.hp, shield:GAME.player.shield,
                faction:GAME.player.faction, shipClass:GAME.player.shipClass,
            };
        }

        const msg = {
            type: 'gameState',
            territoryPct: pct,
            territory: GAME.territory.map(n=>({owner:n.owner,progress:Math.round(n.progress)})),
            remotePlayers,
            aiShips: GAME.aiShips.map(ai=>({
                x:Math.round(ai.mesh.position.x), z:Math.round(ai.mesh.position.z),
                angle:+ai.mesh.rotation.y.toFixed(3), hp:Math.round(ai.hp),
                faction:ai.faction, shipClass:ai.shipClass,
            })),
            projectiles: GAME.projectiles.map(p=>({
                x:Math.round(p.mesh.position.x), z:Math.round(p.mesh.position.z),
                a:+p.mesh.rotation.y.toFixed(3), f:p.faction,
            })),
        };

        // Include world layout so clients can build matching map
        if (!_sentLayout) {
            _sentLayout = true;
            msg.worldLayout = {
                nodes:     GAME.territory.map(n=>[Math.round(n.x),Math.round(n.z)]),
                resources: GAME.resources.map(r=>[Math.round(r.x),Math.round(r.z)]),
            };
        }

        _ws.send(JSON.stringify(msg));
    }
    let _sentLayout = false;

    // ── CLIENT: send input to host ────────────────────────────────────────
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
        const t     = performance.now();
        const proto = location.protocol === 'https:' ? 'https' : 'http';
        const clean = host.replace(/^https?:\/\//,'').replace(/^wss?:\/\//,'').replace(/\/+$/,'');
        try {
            const res = await Promise.race([
                fetch(`${proto}://${clean}/info`),
                new Promise((_,r) => setTimeout(()=>r(new Error('timeout')),3000))
            ]);
            const info = await res.json();
            info.ping = Math.round(performance.now()-t);
            info.host = clean;
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
