'use strict';

const Network = (() => {
    let _ws=null, _localId=null, _isHost=false;
    let _connected=false, _syncTimer=0, _pingTimer=0, _ping=0;
    const SYNC_HZ = 1/20;

    // Client-side visual pools
    const _cProjs = []; // client projectile meshes
    let   _cProjSpeeds = []; // extrapolation speeds

    // ── CONNECT ───────────────────────────────────────────────────────────
    function connect(wsUrl, onReady) {
        const proto = location.protocol==='https:'?'wss':'ws';
        const clean = wsUrl.replace(/^wss?:\/\//,'').replace(/^https?:\/\//,'').replace(/\/+$/,'');
        _ws = new WebSocket(`${proto}://${clean}`);
        _ws.onopen    = () => { _connected=true; };
        _ws.onclose   = () => { _connected=false; UI.showMsg('Disconnected','err'); };
        _ws.onerror   = () => { UI.showMsg('Connection error','err'); };
        _ws.onmessage = (e) => { let m; try{m=JSON.parse(e.data);}catch{return;} _handle(m,onReady); };
    }

    function _handle(m, onReady) {
        switch(m.type) {
            case 'welcome':
                _localId=m.id; _isHost=m.isHost;
                setTimeout(()=>_send({type:'join',faction:GAME.player.faction,shipClass:GAME.player.shipClass}),150);
                if(onReady) onReady(_isHost,_localId);
                break;
            case 'gameState':
                if(!_isHost) _applyState(m);
                break;
            case 'playerInput':
                if(_isHost) _applyInput(m);
                break;
            case 'playerJoined':
                _ensureRemote(m.id, m.faction||'HELIX', m.shipClass||'ASSAULT');
                break;
            case 'playerLeft':
                _removeRemote(m.id);
                break;
            case 'promoted':
                _isHost=true;
                AI.init();
                UI.showMsg('You are now the host','info');
                break;
            case 'pong':
                _ping=Math.round(performance.now()-m.t);
                break;
        }
    }

    // ── REMOTE PLAYERS ────────────────────────────────────────────────────
    function _ensureRemote(id, faction, shipClass) {
        if(id===_localId) return;
        if(!GAME.remotePlayers) GAME.remotePlayers={};
        if(GAME.remotePlayers[id]) return;
        const sc=SHIP_CLASSES[shipClass]||SHIP_CLASSES.ASSAULT;
        const fac=FACTIONS[faction]||FACTIONS.HELIX;
        const mesh=Render.createShipMesh(faction,shipClass);
        mesh.position.set(fac.sx,8,fac.sz);
        GAME.scene.add(mesh);
        GAME.remotePlayers[id]={id,faction,shipClass,mesh,
            hp:CONFIG.SHIP_HP*sc.stats.hull, maxHp:CONFIG.SHIP_HP*sc.stats.hull,
            shield:CONFIG.SHIP_HP*0.5*sc.stats.shield, maxShield:CONFIG.SHIP_HP*0.5*sc.stats.shield,
            vx:0,vz:0,angle:0,keys:{},shoot:false,fireCooldown:0};
    }

    function _removeRemote(id) {
        const rp=GAME.remotePlayers?.[id]; if(!rp) return;
        GAME.scene?.remove(rp.mesh);
        delete GAME.remotePlayers[id];
    }

    // ── HOST: simulate remote players ────────────────────────────────────
    function updateRemotePlayers(dt) {
        if(!_isHost||!GAME.remotePlayers) return;
        Object.values(GAME.remotePlayers).forEach(rp=>{
            const k=rp.keys||{},a=rp.angle;
            const sc=SHIP_CLASSES[rp.shipClass]||SHIP_CLASSES.ASSAULT;
            const spd=CONFIG.SHIP_MAX_SPEED*sc.stats.speed,thr=CONFIG.SHIP_THRUST*dt;
            if(k.KeyW||k.ArrowUp)   {rp.vx-=Math.sin(a)*thr;rp.vz-=Math.cos(a)*thr;}
            if(k.KeyS||k.ArrowDown) {rp.vx+=Math.sin(a)*thr;rp.vz+=Math.cos(a)*thr;}
            if(k.KeyA||k.ArrowLeft) {rp.vx-=Math.cos(a)*thr;rp.vz+=Math.sin(a)*thr;}
            if(k.KeyD||k.ArrowRight){rp.vx+=Math.cos(a)*thr;rp.vz-=Math.sin(a)*thr;}
            const drag=1-CONFIG.SHIP_DRAG*dt;
            rp.vx*=drag;rp.vz*=drag;
            const sp=Math.sqrt(rp.vx*rp.vx+rp.vz*rp.vz);
            if(sp>spd){rp.vx=(rp.vx/sp)*spd;rp.vz=(rp.vz/sp)*spd;}
            rp.mesh.position.x+=rp.vx*dt;rp.mesh.position.z+=rp.vz*dt;
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
        rp.keys=m.keys||{};rp.angle=m.angle||0;rp.shoot=!!m.shoot;
    }

    // ── CLIENT: apply authoritative state ────────────────────────────────
    function _applyState(state) {

        // ── Territory
        if(state.territory&&GAME.territory.length===state.territory.length) {
            state.territory.forEach((t,i)=>{
                const n=GAME.territory[i];if(!n)return;
                if(n.owner!==t.owner){n.owner=t.owner;World.setNodeColor(n,t.owner);}
                n.progress=t.progress;
            });
        }

        // ── All players (including host)
        if(state.players) {
            if(!GAME.remotePlayers) GAME.remotePlayers={};
            Object.entries(state.players).forEach(([sid,p])=>{
                const id=parseInt(sid);
                if(id===_localId) return;
                if(!GAME.remotePlayers[id]) _ensureRemote(id,p.faction,p.shipClass);
                const rp=GAME.remotePlayers[id];if(!rp)return;
                rp.mesh.position.x+=(p.x-rp.mesh.position.x)*0.5;
                rp.mesh.position.z+=(p.z-rp.mesh.position.z)*0.5;
                rp.mesh.rotation.y=p.angle;
                rp.hp=p.hp;rp.shield=p.shield||0;
            });
            // Remove gone players
            Object.keys(GAME.remotePlayers).forEach(id=>{
                if(!state.players[id]) _removeRemote(parseInt(id));
            });
        }

        // ── AI ships — match host's array exactly
        if(state.ai) {
            // First sync: create AI ship meshes on client
            while(GAME.aiShips.length < state.ai.length) {
                const s = state.ai[GAME.aiShips.length];
                const sc = SHIP_CLASSES[s.shipClass||'ASSAULT']||SHIP_CLASSES.ASSAULT;
                const mesh = Render.createShipMesh(s.faction||'HELIX', s.shipClass||'ASSAULT');
                GAME.scene.add(mesh);
                GAME.aiShips.push({
                    faction:s.faction||'HELIX', shipClass:s.shipClass||'ASSAULT',
                    mesh, hp:s.hp, maxHp:CONFIG.SHIP_HP*(sc.stats.hull||1),
                    shield:s.shield||0, maxShield:CONFIG.SHIP_HP*0.5*(sc.stats.shield||1),
                    vx:0, vz:0, engGlows:[],
                });
            }
            // Remove ships that died on host
            while(GAME.aiShips.length>state.ai.length) {
                const dead=GAME.aiShips.pop();
                Effects.spawnExplosion(dead.mesh.position.x,dead.mesh.position.z,FACTIONS[dead.faction].color,false);
                GAME.scene.remove(dead.mesh);
            }
            // Update positions
            state.ai.forEach((s,i)=>{
                const ai=GAME.aiShips[i];if(!ai)return;
                ai.mesh.position.x+=(s.x-ai.mesh.position.x)*0.4;
                ai.mesh.position.z+=(s.z-ai.mesh.position.z)*0.4;
                ai.mesh.rotation.y=s.angle;
                ai.hp=s.hp;ai.shield=s.shield||0;
            });
        }

        // ── Buildings — sync full list
        if(state.buildings) {
            // Add missing buildings
            state.buildings.forEach((sb,i)=>{
                if(!GAME.buildings[i]) {
                    const def=BLDG[sb.type];
                    if(!def)return;
                    const mesh=Buildings._createMeshPublic(sb.type,sb.x,sb.z,sb.faction);
                    GAME.scene.add(mesh);
                    GAME.buildings.push({type:sb.type,faction:sb.faction,x:sb.x,z:sb.z,hp:sb.hp,maxHp:def.hp,mesh,timer:0});
                } else {
                    GAME.buildings[i].hp=sb.hp;
                }
            });
            // Remove destroyed buildings
            while(GAME.buildings.length>state.buildings.length) {
                const b=GAME.buildings.pop();
                GAME.scene.remove(b.mesh);
            }
        }

        // ── Resources — sync active state
        if(state.resources&&GAME.resources.length===state.resources.length) {
            state.resources.forEach((sr,i)=>{
                const r=GAME.resources[i];if(!r)return;
                if(r.active!==sr.active) {
                    r.active=sr.active;
                    r.group.visible=sr.active;
                    r.hp=sr.active?r.maxHp:0;
                }
            });
        }

        // ── Projectiles — visual rendering with extrapolation
        if(state.projectiles) {
            // Expand pool
            while(_cProjs.length<state.projectiles.length) {
                const geo=new THREE.BoxGeometry(3.5,3.5,18);
                const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:0xffffff}));
                GAME.scene.add(mesh);
                _cProjs.push({mesh,vx:0,vz:0});
            }
            state.projectiles.forEach((p,i)=>{
                const cp=_cProjs[i];
                cp.mesh.visible=true;
                cp.mesh.position.set(p.x,7,p.z);
                cp.mesh.rotation.y=p.a;
                cp.mesh.material.color.setHex(p.c||FACTIONS[p.f]?.color||0xffffff);
                // Store velocity for extrapolation between sync frames
                cp.vx=-Math.sin(p.a)*p.s;
                cp.vz=-Math.cos(p.a)*p.s;
            });
            for(let i=state.projectiles.length;i<_cProjs.length;i++)
                _cProjs[i].mesh.visible=false;
        }
    }

    // Extrapolate projectile positions between server frames
    function extrapolateProjectiles(dt) {
        if(_isHost) return;
        for(let i=0;i<_cProjs.length;i++) {
            const cp=_cProjs[i];
            if(!cp.mesh.visible) continue;
            cp.mesh.position.x+=cp.vx*dt;
            cp.mesh.position.z+=cp.vz*dt;
        }
    }

    // ── HOST: build and send state ────────────────────────────────────────
    function _sendState() {
        if(!_ws||_ws.readyState!==WebSocket.OPEN) return;

        const total=GAME.territory.length||1;
        const pct={};
        Object.keys(FACTIONS).forEach(f=>pct[f]=Math.round(GAME.territory.filter(n=>n.owner===f).length/total*100));

        const players={};
        if(GAME.player.mesh) players[_localId]={
            x:GAME.player.mesh.position.x,z:GAME.player.mesh.position.z,
            angle:GAME.player.mesh.rotation.y,hp:GAME.player.hp,
            shield:GAME.player.shield||0,faction:GAME.player.faction,shipClass:GAME.player.shipClass};
        if(GAME.remotePlayers) Object.entries(GAME.remotePlayers).forEach(([id,rp])=>{
            players[id]={x:rp.mesh.position.x,z:rp.mesh.position.z,
                angle:rp.mesh.rotation.y,hp:rp.hp,shield:rp.shield||0,
                faction:rp.faction,shipClass:rp.shipClass};
        });

        _send({
            type:'gameState',
            territoryPct:pct,
            territory:GAME.territory.map(n=>({owner:n.owner,progress:Math.round(n.progress)})),
            players,
            ai:GAME.aiShips.map(ai=>({
                x:Math.round(ai.mesh.position.x),z:Math.round(ai.mesh.position.z),
                angle:+ai.mesh.rotation.y.toFixed(2),hp:Math.round(ai.hp),shield:Math.round(ai.shield||0),
            })),
            buildings:GAME.buildings.map(b=>({
                type:b.type,faction:b.faction,
                x:Math.round(b.x),z:Math.round(b.z),hp:Math.round(b.hp),
            })),
            resources:GAME.resources.map(r=>({active:r.active})),
            projectiles:GAME.projectiles.map(p=>({
                x:Math.round(p.mesh.position.x),z:Math.round(p.mesh.position.z),
                a:+p.mesh.rotation.y.toFixed(2),f:p.faction,
                s:Math.round(p.speed||CONFIG.PROJ_SPEED),
                c:p.wep?.color||FACTIONS[p.faction]?.color||0xffffff,
            })),
        });
    }

    // ── CLIENT: send inputs ───────────────────────────────────────────────
    function _sendInput() {
        if(!_ws||_ws.readyState!==WebSocket.OPEN) return;
        _send({type:'input',keys:GAME.keys,
            angle:GAME.player.mesh?.rotation.y||0,
            shoot:!!(GAME.keys['MouseLeft']&&!GAME.buildMode)});
    }

    // ── UPDATE ────────────────────────────────────────────────────────────
    function update(dt) {
        if(!_connected) return;
        _pingTimer-=dt;
        if(_pingTimer<=0){_pingTimer=5;_send({type:'ping',t:performance.now()});}
        if(_isHost){_syncTimer-=dt;if(_syncTimer<=0){_syncTimer=SYNC_HZ;_sendState();}}
        else { _sendInput(); extrapolateProjectiles(dt); }
    }

    // ── SERVER BROWSER ────────────────────────────────────────────────────
    async function pingServer(host) {
        const t=performance.now();
        const proto=location.protocol==='https:'?'https':'http';
        const clean=host.replace(/^https?:\/\//,'').replace(/^wss?:\/\//,'').replace(/\/+$/,'');
        try {
            const res=await Promise.race([fetch(`${proto}://${clean}/info`),new Promise((_,r)=>setTimeout(()=>r(new Error),3000))]);
            const info=await res.json();
            info.ping=Math.round(performance.now()-t);info.host=clean;
            return info;
        } catch{return null;}
    }

    function _send(obj){if(_ws&&_ws.readyState===WebSocket.OPEN)_ws.send(JSON.stringify(obj));}

    return {
        connect, update, updateRemotePlayers, pingServer,
        isHost:()=>_isHost, isConnected:()=>_connected,
        getLocalId:()=>_localId, getPing:()=>_ping,
    };
})();
