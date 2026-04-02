'use strict';

const Network = (() => {
    let _ws = null, _localId = null, _isHost = false;
    let _connected = false, _syncTimer = 0, _pingTimer = 0, _ping = 0;
    const SYNC_HZ = 1/20; // 20 state syncs per second

    // ── CONNECT ───────────────────────────────────────────────────────────
    function connect(wsUrl, onReady) {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const clean = wsUrl.replace(/^wss?:\/\//,'').replace(/^https?:\/\//,'').replace(/\/+$/,'');
        _ws = new WebSocket(`${proto}://${clean}`);
        _ws.onopen    = () => { _connected = true; };
        _ws.onclose   = () => { _connected = false; UI.showMsg('Disconnected','err'); };
        _ws.onerror   = () => { UI.showMsg('Connection error','err'); };
        _ws.onmessage = (e) => {
            let m; try { m = JSON.parse(e.data); } catch { return; }
            _handle(m, onReady);
        };
    }

    function _handle(m, onReady) {
        switch (m.type) {
            case 'welcome':
                _localId = m.id; _isHost = m.isHost;
                // Send identity after short delay
                setTimeout(() => _send({ type:'join', faction:GAME.player.faction, shipClass:GAME.player.shipClass, seed:GAME.worldSeed }), 100);
                if (onReady) onReady(_isHost, _localId);
                break;

            case 'gameState':
                if (!_isHost) _applyState(m);
                break;

            case 'playerInput':
                if (_isHost) _applyInput(m);
                break;

            case 'playerJoined':
                _ensureRemotePlayer(m.id, m.faction||'HELIX', m.shipClass||'ASSAULT');
                break;

            case 'playerLeft':
                _removeRemote(m.id);
                break;

            case 'promoted':
                _isHost = true;
                UI.showMsg('You are now the host','info');
                if (!GAME.aiShips.length) AI.init();
                break;

            case 'pong':
                _ping = Math.round(performance.now() - m.t);
                break;
        }
    }

    // ── REMOTE PLAYERS ────────────────────────────────────────────────────
    function _ensureRemotePlayer(id, faction, shipClass) {
        if (id === _localId) return;
        if (!GAME.remotePlayers) GAME.remotePlayers = {};
        if (GAME.remotePlayers[id]) return; // already exists
        const fac  = FACTIONS[faction] || FACTIONS.HELIX;
        const sc   = SHIP_CLASSES[shipClass] || SHIP_CLASSES.ASSAULT;
        const mesh = Render.createShipMesh(faction, shipClass);
        mesh.position.set(fac.sx+(Math.random()-0.5)*300, 8, fac.sz+(Math.random()-0.5)*300);
        GAME.scene.add(mesh);
        GAME.remotePlayers[id] = {
            id, faction, shipClass, mesh,
            hp: CONFIG.SHIP_HP*sc.stats.hull, maxHp: CONFIG.SHIP_HP*sc.stats.hull,
            shield: CONFIG.SHIP_HP*0.5*sc.stats.shield, maxShield: CONFIG.SHIP_HP*0.5*sc.stats.shield,
            vx:0, vz:0, angle:0, keys:{}, shoot:false, fireCooldown:0,
        };
    }

    function _removeRemote(id) {
        const rp = GAME.remotePlayers?.[id]; if (!rp) return;
        GAME.scene?.remove(rp.mesh);
        delete GAME.remotePlayers[id];
    }

    // ── HOST: simulate remote player physics ──────────────────────────────
    function updateRemotePlayers(dt) {
        if (!_isHost || !GAME.remotePlayers) return;
        Object.values(GAME.remotePlayers).forEach(rp => {
            const k=rp.keys||{}, a=rp.angle;
            const sc=SHIP_CLASSES[rp.shipClass]||SHIP_CLASSES.ASSAULT;
            const spd=CONFIG.SHIP_MAX_SPEED*sc.stats.speed, thr=CONFIG.SHIP_THRUST*dt;
            if(k.KeyW||k.ArrowUp)   {rp.vx-=Math.sin(a)*thr;rp.vz-=Math.cos(a)*thr;}
            if(k.KeyS||k.ArrowDown) {rp.vx+=Math.sin(a)*thr;rp.vz+=Math.cos(a)*thr;}
            if(k.KeyA||k.ArrowLeft) {rp.vx-=Math.cos(a)*thr;rp.vz+=Math.sin(a)*thr;}
            if(k.KeyD||k.ArrowRight){rp.vx+=Math.cos(a)*thr;rp.vz-=Math.sin(a)*thr;}
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
            rp.shield=Math.min(rp.maxShield,(rp.shield||0)+dt*2);
        });
    }

    function _applyInput(m) {
        const rp=GAME.remotePlayers?.[m.fromId]; if(!rp) return;
        rp.keys=m.keys||{}; rp.angle=m.angle||0; rp.shoot=!!m.shoot;
    }

    // ── CLIENT: apply authoritative state from host ───────────────────────
    function _applyState(state) {
        // Territory ownership (authoritative)
        if (state.territory && GAME.territory.length === state.territory.length) {
            state.territory.forEach((t,i) => {
                const n=GAME.territory[i]; if(!n) return;
                if(n.owner!==t.owner){n.owner=t.owner;World.setNodeColor(n,t.owner);}
                n.progress=t.progress;
            });
        }

        // Remote players — create if missing, smoothly update positions
        if (state.players) {
            if (!GAME.remotePlayers) GAME.remotePlayers = {};
            Object.entries(state.players).forEach(([sid,p]) => {
                const id=parseInt(sid);
                if(id===_localId) return;
                if(!GAME.remotePlayers[id]) {
                    _ensureRemotePlayer(id, p.faction, p.shipClass);
                }
                const rp=GAME.remotePlayers[id]; if(!rp) return;
                // Smooth interpolation
                rp.mesh.position.x+=(p.x-rp.mesh.position.x)*0.4;
                rp.mesh.position.z+=(p.z-rp.mesh.position.z)*0.4;
                rp.mesh.rotation.y=p.angle;
                rp.hp=p.hp; rp.shield=p.shield;
            });
            // Remove disconnected
            Object.keys(GAME.remotePlayers).forEach(id => {
                if(!state.players[id]) _removeRemote(parseInt(id));
            });
        }

        // AI ships — smooth update (clients already have meshes from init)
        if (state.ai && GAME.aiShips.length === state.ai.length) {
            state.ai.forEach((s,i) => {
                const ai=GAME.aiShips[i]; if(!ai) return;
                ai.mesh.position.x+=(s.x-ai.mesh.position.x)*0.4;
                ai.mesh.position.z+=(s.z-ai.mesh.position.z)*0.4;
                ai.mesh.rotation.y=s.angle;
                ai.hp=s.hp; ai.shield=s.shield||0;
            });
        }

        // HP correction for local player
        if (state.myHp !== undefined) {
            GAME.player.hp     = state.myHp;
            GAME.player.shield = state.myShield||0;
        }
    }

    // ── HOST: broadcast authoritative state ───────────────────────────────
    function _sendState() {
        if(!_ws||_ws.readyState!==WebSocket.OPEN) return;

        const total=GAME.territory.length||1;
        const pct={};
        Object.keys(FACTIONS).forEach(f=>pct[f]=Math.round(GAME.territory.filter(n=>n.owner===f).length/total*100));

        // All players (remote + host self) keyed by id
        const players={};
        if(GAME.player.mesh) {
            players[_localId]={
                x:GAME.player.mesh.position.x, z:GAME.player.mesh.position.z,
                angle:GAME.player.mesh.rotation.y, hp:GAME.player.hp,
                shield:GAME.player.shield||0, faction:GAME.player.faction, shipClass:GAME.player.shipClass,
            };
        }
        if(GAME.remotePlayers) {
            Object.entries(GAME.remotePlayers).forEach(([id,rp])=>{
                players[id]={
                    x:rp.mesh.position.x, z:rp.mesh.position.z,
                    angle:rp.mesh.rotation.y, hp:rp.hp,
                    shield:rp.shield||0, faction:rp.faction, shipClass:rp.shipClass,
                };
            });
        }

        _send({
            type:'gameState',
            territoryPct:pct,
            territory:GAME.territory.map(n=>({owner:n.owner,progress:Math.round(n.progress)})),
            players,
            ai:GAME.aiShips.map(ai=>({
                x:Math.round(ai.mesh.position.x), z:Math.round(ai.mesh.position.z),
                angle:+ai.mesh.rotation.y.toFixed(2),
                hp:Math.round(ai.hp), shield:Math.round(ai.shield||0),
            })),
            // Send HP correction for each remote player
            hpCorrections: (() => {
                const c={};
                if(GAME.remotePlayers) Object.entries(GAME.remotePlayers).forEach(([id,rp])=>{c[id]={hp:Math.round(rp.hp),shield:Math.round(rp.shield||0)};});
                return c;
            })(),
        });
    }

    // ── CLIENT: send input every frame ────────────────────────────────────
    function _sendInput() {
        if(!_ws||_ws.readyState!==WebSocket.OPEN) return;
        _send({
            type:'input',
            keys:GAME.keys,
            angle:GAME.player.mesh?.rotation.y||0,
            shoot:!!(GAME.keys['MouseLeft']&&!GAME.buildMode),
        });
    }

    // ── UPDATE ────────────────────────────────────────────────────────────
    function update(dt) {
        if(!_connected) return;
        _pingTimer-=dt;
        if(_pingTimer<=0){_pingTimer=5;_send({type:'ping',t:performance.now()});}
        if(_isHost){_syncTimer-=dt;if(_syncTimer<=0){_syncTimer=SYNC_HZ;_sendState();}}
        else _sendInput();
    }

    // ── SERVER BROWSER ────────────────────────────────────────────────────
    async function pingServer(host) {
        const t=performance.now();
        const proto=location.protocol==='https:'?'https':'http';
        const clean=host.replace(/^https?:\/\//,'').replace(/^wss?:\/\//,'').replace(/\/+$/,'');
        try {
            const res=await Promise.race([fetch(`${proto}://${clean}/info`),new Promise((_,r)=>setTimeout(()=>r(new Error),3000))]);
            const info=await res.json();
            info.ping=Math.round(performance.now()-t); info.host=clean;
            return info;
        } catch{return null;}
    }

    function _send(obj) {
        if(_ws&&_ws.readyState===WebSocket.OPEN) _ws.send(JSON.stringify(obj));
    }

    return {
        connect, update, updateRemotePlayers, pingServer,
        isHost:()=>_isHost, isConnected:()=>_connected,
        getLocalId:()=>_localId, getPing:()=>_ping,
    };
})();
