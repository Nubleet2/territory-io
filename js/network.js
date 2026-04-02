'use strict';

const Network = (() => {
    let _ws=null, _localId=null, _isHost=false;
    let _connected=false, _syncTimer=0, _pingTimer=0, _ping=0;
    const SYNC_HZ = 1/20; // 20hz

    // Client-side projectile display meshes
    const _projMeshes = [];

    // ── CONNECT ───────────────────────────────────────────────────────────
    function connect(wsUrl, onReady) {
        const proto = location.protocol==='https:'?'wss':'ws';
        const clean = wsUrl.replace(/^wss?:\/\//,'').replace(/^https?:\/\//,'').replace(/\/+$/,'');
        _ws = new WebSocket(`${proto}://${clean}`);
        _ws.onopen    = () => { _connected=true; };
        _ws.onclose   = () => { _connected=false; UI.showMsg('Disconnected','err'); };
        _ws.onerror   = () => { UI.showMsg('Connection error','err'); };
        _ws.onmessage = (e) => {
            let m; try{m=JSON.parse(e.data);}catch{return;}
            _handle(m, onReady);
        };
    }

    function _handle(m, onReady) {
        switch(m.type) {
            case 'welcome':
                _localId=m.id; _isHost=m.isHost;
                // Send our identity
                setTimeout(()=>_send({
                    type:'join',
                    faction:GAME.player.faction,
                    shipClass:GAME.player.shipClass
                }), 200);
                if(onReady) onReady(_isHost, _localId);
                break;

            case 'gameState':
                if(!_isHost) _applyState(m);
                break;

            case 'playerInput':
                if(_isHost) _applyInput(m);
                break;

            case 'playerJoined':
                // Create mesh for this player on everyone's screen
                if(m.id !== _localId) {
                    _ensureRemote(m.id, m.faction||'TERRAN', m.shipClass||'ASSAULT');
                }
                break;

            case 'playerLeft':
                _removeRemote(m.id);
                break;

            case 'promoted':
                _isHost=true;
                UI.showMsg('You are now the host','info');
                AI.init();
                break;

            case 'pong':
                _ping=Math.round(performance.now()-m.t);
                break;
        }
    }

    // ── REMOTE PLAYER MANAGEMENT ──────────────────────────────────────────
    function _ensureRemote(id, faction, shipClass) {
        if(!GAME.remotePlayers) GAME.remotePlayers={};
        // Already exists — just update faction/ship if different
        if(GAME.remotePlayers[id]) {
            return;
        }
        const fac = FACTIONS[faction]||FACTIONS.TERRAN;
        const sc  = SHIP_CLASSES[shipClass]||SHIP_CLASSES.ASSAULT;
        const mesh = Render.createShipMesh(faction, shipClass);
        mesh.position.set(fac.sx+(Math.random()-0.5)*300, 8, fac.sz+(Math.random()-0.5)*300);
        GAME.scene.add(mesh);
        GAME.remotePlayers[id] = {
            id, faction, shipClass, mesh,
            hp: CONFIG.SHIP_HP*sc.stats.hull,
            maxHp: CONFIG.SHIP_HP*sc.stats.hull,
            shield: CONFIG.SHIP_HP*0.5*sc.stats.shield,
            maxShield: CONFIG.SHIP_HP*0.5*sc.stats.shield,
            vx:0, vz:0, angle:0, keys:{}, shoot:false, fireCooldown:0,
        };
    }

    function _removeRemote(id) {
        const rp=GAME.remotePlayers?.[id]; if(!rp) return;
        GAME.scene.remove(rp.mesh);
        delete GAME.remotePlayers[id];
    }

    // ── HOST: physics for remote players ─────────────────────────────────
    function updateRemotePlayers(dt) {
        if(!_isHost||!GAME.remotePlayers) return;
        Object.values(GAME.remotePlayers).forEach(rp=>{
            if(!rp.mesh) return;
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
            if(rp.shoot&&rp.fireCooldown<=0) {
                const wep=sc.weapon;
                rp.fireCooldown=(wep?.fireRate)||CONFIG.FIRE_RATE;
                Combat.spawnProjectile(rp.mesh.position.x,rp.mesh.position.z,a,rp.faction,1,wep);
            }
            rp.hp=Math.min(rp.maxHp,(rp.hp||0)+dt*3);
            rp.shield=Math.min(rp.maxShield,(rp.shield||0)+dt*2);
        });
    }

    function _applyInput(m) {
        const rp=GAME.remotePlayers?.[m.fromId]; if(!rp) return;
        rp.keys=m.keys||{}; rp.angle=m.angle||0; rp.shoot=!!m.shoot;
    }

    // ── CLIENT: apply state snapshot ──────────────────────────────────────
    function _applyState(state) {
        if(!GAME.scene) return;

        // Territory
        if(state.territory && GAME.territory.length===state.territory.length) {
            state.territory.forEach((t,i)=>{
                const n=GAME.territory[i]; if(!n) return;
                if(n.owner!==t.owner){n.owner=t.owner;World.setNodeColor(n,t.owner);}
                n.progress=t.progress;
            });
        }

        // All players (everyone except self)
        if(state.players) {
            if(!GAME.remotePlayers) GAME.remotePlayers={};
            Object.entries(state.players).forEach(([sid,p])=>{
                const id=parseInt(sid);
                if(id===_localId) return;
                // Create mesh if needed
                if(!GAME.remotePlayers[id]) {
                    _ensureRemote(id, p.faction||'TERRAN', p.shipClass||'ASSAULT');
                }
                const rp=GAME.remotePlayers[id]; if(!rp||!rp.mesh) return;
                // Smooth interpolation toward authoritative position
                rp.mesh.position.x+=(p.x-rp.mesh.position.x)*0.5;
                rp.mesh.position.z+=(p.z-rp.mesh.position.z)*0.5;
                rp.mesh.rotation.y=p.angle;
                rp.hp=p.hp; rp.shield=p.shield||0;
            });
            // Remove players who left
            Object.keys(GAME.remotePlayers).forEach(id=>{
                if(!state.players[id]) _removeRemote(parseInt(id));
            });
        }

        // AI ships
        if(state.ai) {
            // Create missing AI meshes
            while(GAME.aiShips.length<state.ai.length) {
                const s=state.ai[GAME.aiShips.length];
                const sc=SHIP_CLASSES[s.cls||'ASSAULT']||SHIP_CLASSES.ASSAULT;
                const mesh=Render.createShipMesh(s.fac||'HELIX', s.cls||'ASSAULT');
                GAME.scene.add(mesh);
                GAME.aiShips.push({
                    faction:s.fac||'HELIX', shipClass:s.cls||'ASSAULT', mesh,
                    hp:s.hp, maxHp:CONFIG.SHIP_HP*(sc.stats.hull||1),
                    shield:s.sh||0, maxShield:CONFIG.SHIP_HP*0.5*(sc.stats.shield||1),
                    vx:0,vz:0, engGlows:[],
                });
            }
            // Remove dead AI ships
            while(GAME.aiShips.length>state.ai.length) {
                const dead=GAME.aiShips.pop();
                Effects.spawnExplosion(dead.mesh.position.x,dead.mesh.position.z,FACTIONS[dead.faction]?.color||0xff4444,false);
                GAME.scene.remove(dead.mesh);
            }
            // Update positions
            state.ai.forEach((s,i)=>{
                const ai=GAME.aiShips[i]; if(!ai||!ai.mesh) return;
                ai.mesh.position.x+=(s.x-ai.mesh.position.x)*0.4;
                ai.mesh.position.z+=(s.z-ai.mesh.position.z)*0.4;
                ai.mesh.rotation.y=s.a;
                ai.hp=s.hp; ai.shield=s.sh||0;
            });
        }

        // Buildings — full sync
        if(state.bldgs) {
            // Remove all and rebuild (buildings change infrequently so this is fine)
            if(state.bldgs.length!==GAME.buildings.length ||
               state.bldgs.some((sb,i)=>!GAME.buildings[i]||GAME.buildings[i].type!==sb.t||GAME.buildings[i].faction!==sb.f)) {
                // Rebuild building list from scratch
                GAME.buildings.forEach(b=>GAME.scene.remove(b.mesh));
                GAME.buildings=[];
                state.bldgs.forEach(sb=>{
                    const def=BLDG[sb.t]; if(!def) return;
                    const mesh=Buildings._createMeshPublic(sb.t,sb.x,sb.z,sb.f);
                    GAME.scene.add(mesh);
                    GAME.buildings.push({type:sb.t,faction:sb.f,x:sb.x,z:sb.z,hp:sb.hp,maxHp:def.hp,mesh,timer:0});
                });
            } else {
                // Just update HP
                state.bldgs.forEach((sb,i)=>{ if(GAME.buildings[i]) GAME.buildings[i].hp=sb.hp; });
            }
        }

        // Resources
        if(state.res && GAME.resources.length===state.res.length) {
            state.res.forEach((sr,i)=>{
                const r=GAME.resources[i]; if(!r) return;
                if(r.active!==sr.a){ r.active=sr.a; r.group.visible=sr.a; r.hp=sr.a?r.maxHp:0; }
            });
        }

        // Projectiles — visual display with motion extrapolation
        const projs=state.projs||[];
        while(_projMeshes.length<projs.length) {
            const mesh=new THREE.Mesh(new THREE.BoxGeometry(3.5,3.5,18),new THREE.MeshBasicMaterial({color:0xffffff}));
            GAME.scene.add(mesh);
            _projMeshes.push({mesh,vx:0,vz:0});
        }
        projs.forEach((p,i)=>{
            const pm=_projMeshes[i];
            pm.mesh.visible=true;
            pm.mesh.position.set(p.x,7,p.z);
            pm.mesh.rotation.y=p.a;
            pm.mesh.material.color.setHex(p.c||0xffffff);
            pm.vx=-Math.sin(p.a)*(p.s||CONFIG.PROJ_SPEED);
            pm.vz=-Math.cos(p.a)*(p.s||CONFIG.PROJ_SPEED);
        });
        for(let i=projs.length;i<_projMeshes.length;i++) _projMeshes[i].mesh.visible=false;
    }

    // Extrapolate projectiles between sync frames on client
    function extrapolateProjectiles(dt) {
        if(_isHost) return;
        _projMeshes.forEach(pm=>{ if(!pm.mesh.visible) return; pm.mesh.position.x+=pm.vx*dt; pm.mesh.position.z+=pm.vz*dt; });
    }

    // ── HOST: send full state ─────────────────────────────────────────────
    function _sendState() {
        if(!_ws||_ws.readyState!==WebSocket.OPEN) return;

        const total=GAME.territory.length||1;
        const pct={};
        Object.keys(FACTIONS).forEach(f=>pct[f]=Math.round(GAME.territory.filter(n=>n.owner===f).length/total*100));

        // All players keyed by id (including host self)
        const players={};
        if(GAME.player.mesh) {
            players[_localId]={
                x:GAME.player.mesh.position.x, z:GAME.player.mesh.position.z,
                angle:GAME.player.mesh.rotation.y,
                hp:Math.round(GAME.player.hp), shield:Math.round(GAME.player.shield||0),
                faction:GAME.player.faction, shipClass:GAME.player.shipClass,
            };
        }
        if(GAME.remotePlayers) {
            Object.entries(GAME.remotePlayers).forEach(([id,rp])=>{
                if(!rp.mesh) return;
                players[id]={
                    x:rp.mesh.position.x, z:rp.mesh.position.z,
                    angle:rp.mesh.rotation.y,
                    hp:Math.round(rp.hp||0), shield:Math.round(rp.shield||0),
                    faction:rp.faction, shipClass:rp.shipClass,
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
                a:+ai.mesh.rotation.y.toFixed(2),
                hp:Math.round(ai.hp), sh:Math.round(ai.shield||0),
                fac:ai.faction, cls:ai.shipClass,
            })),
            bldgs:GAME.buildings.map(b=>({t:b.type,f:b.faction,x:Math.round(b.x),z:Math.round(b.z),hp:Math.round(b.hp)})),
            res:GAME.resources.map(r=>({a:r.active?1:0})),
            projs:GAME.projectiles.map(p=>({
                x:Math.round(p.mesh.position.x), z:Math.round(p.mesh.position.z),
                a:+p.mesh.rotation.y.toFixed(2),
                c:p.wep?.color||FACTIONS[p.faction]?.color||0xffffff,
                s:Math.round(p.speed||CONFIG.PROJ_SPEED),
            })),
        });
    }

    // ── CLIENT: send input ────────────────────────────────────────────────
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
        if(_pingTimer<=0){ _pingTimer=5; _send({type:'ping',t:performance.now()}); }
        if(_isHost) {
            _syncTimer-=dt;
            if(_syncTimer<=0){ _syncTimer=SYNC_HZ; _sendState(); }
        } else {
            _sendInput();
            extrapolateProjectiles(dt);
        }
    }

    // ── SERVER BROWSER ────────────────────────────────────────────────────
    async function pingServer(host) {
        const t=performance.now();
        const proto=location.protocol==='https:'?'https':'http';
        const clean=host.replace(/^https?:\/\//,'').replace(/^wss?:\/\//,'').replace(/\/+$/,'');
        try {
            const res=await Promise.race([
                fetch(`${proto}://${clean}/info`),
                new Promise((_,r)=>setTimeout(()=>r(new Error),3000))
            ]);
            const info=await res.json();
            info.ping=Math.round(performance.now()-t); info.host=clean;
            return info;
        } catch{ return null; }
    }

    function _send(obj){ if(_ws&&_ws.readyState===WebSocket.OPEN) _ws.send(JSON.stringify(obj)); }

    return {
        connect, update, updateRemotePlayers, pingServer,
        isHost:()=>_isHost, isConnected:()=>_connected,
        getLocalId:()=>_localId, getPing:()=>_ping,
    };
})();
