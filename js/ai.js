'use strict';

const AI = (() => {
    const AI_FACS    = ['TERRAN', 'HELIX', 'IRON', 'VOID'];
    const ROLE_SPEED = { SCOUT:1.3, FIGHTER:1.1, BUILDER:0.85, DEFENDER:1.0 };
    const ROSTER     = ['SCOUT','SCOUT','SCOUT','FIGHTER','FIGHTER','BUILDER','BUILDER','DEFENDER','DEFENDER','DEFENDER'];

    // Role → preferred ship classes (weighted pick)
    const ROLE_CLASSES = {
        SCOUT:    ['SCOUT','SCOUT','SCOUT','FIGHTER'],
        FIGHTER:  ['FIGHTER','FIGHTER','ASSAULT','ASSAULT','DREADNOUGHT'],
        BUILDER:  ['ENGINEER','ENGINEER','ENGINEER','ASSAULT'],
        DEFENDER: ['CARRIER','CARRIER','ASSAULT','DREADNOUGHT'],
    };

    const _res = { TERRAN:400, HELIX:400, IRON:400, VOID:400 };
    let _resTimer   = 0;
    let _respawnQueue = [];

    // Stalemate detection — track territory % over time
    const _terrHistory = { TERRAN:[], HELIX:[], IRON:[], VOID:[] };
    let _stalemateTimer = 0;
    const _aggression   = { TERRAN:1.0, HELIX:1.0, IRON:1.0, VOID:1.0 };

    // Coordinated attack targets per faction
    const _attackTarget = { TERRAN:null, HELIX:null, IRON:null, VOID:null };
    let _coordTimer = 0;

    function addFactionResources(f, amt) {
        if (_res[f] !== undefined) _res[f] = Math.min(_res[f]+amt, 5000);
    }

    // ── INIT ──────────────────────────────────────────────────────────────────
    function init() {
        AI_FACS.forEach(f => ROSTER.forEach(role => _spawn(f, role)));
    }

    function _spawn(fac, role) {
        const fd      = FACTIONS[fac];
        // Pick class biased toward role
        const pool    = ROLE_CLASSES[role] || ['ASSAULT'];
        const cls     = pool[Math.floor(Math.random()*pool.length)];
        const sc      = SHIP_CLASSES[cls];
        const mesh    = Render.createShipMesh(fac, cls);
        // Spread ships in a wider arc around base so they don't all rush same node
        const _spawnAngle = Math.random()*Math.PI*2;
        const _spawnR     = 80 + Math.random()*280;
        mesh.position.set(fd.sx+Math.cos(_spawnAngle)*_spawnR, 8, fd.sz+Math.sin(_spawnAngle)*_spawnR);
        GAME.scene.add(mesh);
        GAME.aiShips.push({
            faction:      fac,
            role,
            shipClass:    cls,
            mesh,
            hp:           CONFIG.SHIP_HP * sc.stats.hull,
            maxHp:        CONFIG.SHIP_HP * sc.stats.hull,
            shield:       CONFIG.SHIP_HP * 0.5 * sc.stats.shield,
            maxShield:    CONFIG.SHIP_HP * 0.5 * sc.stats.shield,
            speed:        CONFIG.SHIP_MAX_SPEED * (ROLE_SPEED[role]||1) * sc.stats.speed,
            vx:0, vz:0,
            fireCooldown: Math.random()*2,
            taskTimer:    0,
            task:         'CAPTURE',
            targetNode:   null,
            retreatTarget:null,
            strafeSign:   Math.random()>0.5?1:-1,
            engGlows:     _engines(mesh),
        });
    }

    function _engines(m) {
        const g=[]; m.traverse(c=>{if(c.isMesh&&c.userData.isEngine)g.push(c);}); return g;
    }

    // ── UPDATE ────────────────────────────────────────────────────────────────
    function update(dt) {
        _tickResources(dt);
        _tickRespawn(dt);
        _tickStrategy(dt);
        GAME.aiShips.forEach(ai => {
            ai.fireCooldown -= dt;
            ai.taskTimer    -= dt;

            // Passive HP regen — faster near home base
            const fd     = FACTIONS[ai.faction];
            const homeDx = ai.mesh.position.x - fd.sx;
            const homeDz = ai.mesh.position.z - fd.sz;
            const atBase = homeDx*homeDx + homeDz*homeDz < 500*500;
            ai.hp = Math.min(ai.maxHp, ai.hp + dt * (atBase ? 22 : 4));
            ai.shield = Math.min(ai.maxShield, (ai.shield||0) + dt * (atBase ? 15 : 2));

            _tick(ai, dt);
            _selfDefense(ai, dt);
            _thrustAnim(ai);
        });
    }

    // ── STRATEGY — faction-level decisions updated periodically ───────────────
    function _tickStrategy(dt) {
        // Coordinated attack target update
        _coordTimer -= dt;
        if (_coordTimer <= 0) {
            _coordTimer = 8;
            AI_FACS.forEach(f => {
                // Find weakest enemy node (fewest buildings, least defended)
                let best = null, bestScore = Infinity;
                GAME.territory.forEach(n => {
                    if (n.owner === f || !n.owner) return;
                    const CR  = CONFIG.CAPTURE_RADIUS * CONFIG.CAPTURE_RADIUS;
                    const bldgs = GAME.buildings.filter(b => {
                        const dx=b.x-n.x, dz=b.z-n.z;
                        return dx*dx+dz*dz < CR && b.faction === n.owner;
                    }).length;
                    const defenders = GAME.aiShips.filter(s => {
                        if (s.faction !== n.owner) return false;
                        const dx=s.mesh.position.x-n.x, dz=s.mesh.position.z-n.z;
                        return dx*dx+dz*dz < CR * 4;
                    }).length;
                    // Score: low buildings + low defenders = easy target
                    const score = bldgs * 30 + defenders * 50;
                    if (score < bestScore) { bestScore = score; best = n; }
                });
                _attackTarget[f] = best;
            });
        }

        // Stalemate / aggression update
        _stalemateTimer -= dt;
        if (_stalemateTimer <= 0) {
            _stalemateTimer = 20;
            const total = GAME.territory.length || 1;
            AI_FACS.forEach(f => {
                const pct = GAME.territory.filter(n=>n.owner===f).length / total;
                const hist = _terrHistory[f];
                hist.push(pct);
                if (hist.length > 4) hist.shift();

                // If territory % hasn't changed in 80s → stalemate, get aggressive
                const stuck = hist.length >= 4 && Math.max(...hist) - Math.min(...hist) < 0.03;

                if (pct < 0.08)       _aggression[f] = 2.0; // desperate
                else if (pct < 0.2)   _aggression[f] = 1.5;
                else if (pct > 0.6)   _aggression[f] = 0.7; // comfortable
                else if (stuck)       _aggression[f] = Math.min(_aggression[f] + 0.3, 2.0);
                else                  _aggression[f] = Math.max(1.0, _aggression[f] - 0.1); // decay slowly, not instant reset
            });
        }
    }

    // ── MAIN TICK ─────────────────────────────────────────────────────────────
    function _tick(ai, dt) {
        // Use actual maxHp for retreat threshold, not base CONFIG value
        if (ai.hp < ai.maxHp * 0.18) {
            ai.task = 'RETREAT';
            ai.taskTimer = 0;
        }
        if (ai.task === 'RETREAT') {
            _retreat(ai, dt);
            if (ai.hp >= ai.maxHp * 0.6) {
                ai.task = 'CAPTURE';
                ai.taskTimer = 0;
                ai.targetNode = null;
            }
            return;
        }

        // Opportunistic heal
        if (ai.hp < ai.maxHp * 0.7) {
            const beacon = _nearestFriendlyBeacon(ai, 600*600);
            if (beacon) { _moveTo(ai, beacon.x, beacon.z, dt); return; }
        }

        // Don't interrupt active capture
        const capturingInProgress = ai.task === 'CAPTURE' && ai.targetNode && ai.targetNode.progress > 0;
        if ((ai.taskTimer <= 0 || !ai.targetNode) && !capturingInProgress) {
            ai.task      = _pickTask(ai);
            ai.taskTimer = 4 + Math.random()*3;
            ai.targetNode = _pickTarget(ai);
        }

        // Opportunistic mining — scouts and fighters shoot nearby rocks while travelling
        if (!capturingInProgress && (ai.role==='SCOUT'||ai.role==='FIGHTER')) {
            _tryMineNearby(ai);
        }

        switch (ai.task) {
            case 'CAPTURE': _doCapture(ai, dt); break;
            case 'BUILD':   _doBuild(ai, dt);   break;
            case 'ATTACK':  _doAttack(ai, dt);  break;
            case 'DEFEND':  _doDefend(ai, dt);  break;
            case 'PATROL':  _doPatrol(ai, dt);  break;
        }
    }

    // ── TASK SELECTION ────────────────────────────────────────────────────────
    function _pickTask(ai) {
        const f   = ai.faction;
        const agg = _aggression[f];

        const weights = {
            SCOUT:    { CAPTURE:10, BUILD:0,  ATTACK:2,       DEFEND:2,  PATROL:1 },
            FIGHTER:  { CAPTURE:2,  BUILD:0,  ATTACK:10*agg,  DEFEND:3,  PATROL:4 },
            BUILDER:  { CAPTURE:3,  BUILD:10, ATTACK:0,       DEFEND:1,  PATROL:0 },
            DEFENDER: { CAPTURE:2,  BUILD:1,  ATTACK:3*agg,   DEFEND:10, PATROL:2 },
        }[ai.role] || { CAPTURE:5, BUILD:2, ATTACK:5, DEFEND:3, PATROL:1 };

        const uncaptured = GAME.territory.filter(n=>n.owner!==f).length;
        const buildable  = _findBuildNode(ai);
        const threatened = _threatenedNode(f);
        const huntRange  = (1400 * agg) * (1400 * agg);
        const enemyNear  = _nearestEnemy(ai, huntRange);
        const hasEnemyNodes = GAME.territory.some(n=>n.owner&&n.owner!==f);

        const scores = {
            CAPTURE: weights.CAPTURE * (uncaptured > 0 ? 1 : 0),
            BUILD:   weights.BUILD   * (buildable ? 1 : 0) * (_res[f] >= 200 ? 1 : 0),
            ATTACK:  weights.ATTACK  * (enemyNear ? 1 : 0),
            DEFEND:  weights.DEFEND  * (threatened ? 1.5 : 0),
            PATROL:  weights.PATROL  * (hasEnemyNodes && !enemyNear ? 1 : 0),
        };

        const best = Object.entries(scores).sort((a,b)=>b[1]-a[1])[0];
        return (best && best[1] > 0) ? best[0] : 'CAPTURE';
    }

    function _pickTarget(ai) {
        switch (ai.task) {
            case 'CAPTURE': return _bestCaptureNode(ai);
            case 'BUILD':   return _findBuildNode(ai);
            case 'DEFEND':  return _threatenedNode(ai.faction);
            case 'PATROL':  return _frontlineNode(ai);
            default:        return null;
        }
    }

    // ── TASK EXECUTION ────────────────────────────────────────────────────────

    function _doCapture(ai, dt) {
        if (!ai.targetNode) { ai.targetNode = _bestCaptureNode(ai); }
        if (!ai.targetNode) { _retreat(ai, dt); return; }

        if (ai.targetNode.owner === ai.faction) {
            ai.targetNode = null; ai.taskTimer = 0; return;
        }

        _moveTo(ai, ai.targetNode.x, ai.targetNode.z, dt);

        const dx = ai.mesh.position.x - ai.targetNode.x;
        const dz = ai.mesh.position.z - ai.targetNode.z;
        if (Math.sqrt(dx*dx+dz*dz) < CONFIG.CAPTURE_RADIUS) {
            const n = ai.targetNode;
            if (World.hasFriendlyShip(n, ai.faction)) return;
            const bldg = _enemyBuildingAt(n, ai.faction);
            if (bldg) { _shootAt(ai, bldg.x, bldg.z, dt); return; }
            if (n.owner !== ai.faction && !World.hasEnemyStructures(n, ai.faction)) {
                const capFac = World.getCapturingFaction(n);
                if (capFac === 'CONTESTED') {
                    // Stalemate — don't decay
                } else if (capFac !== null && capFac !== ai.faction) {
                    // Different faction capping alone — contest it
                } else {
                    const capMult = (SHIP_CLASSES[ai.shipClass]||{captureSpeed:1}).captureSpeed || 1;
                    n.progress = Math.min(100, n.progress + dt * CONFIG.CAPTURE_SPEED * capMult);
                    if (n.progress >= 100) {
                        n.owner    = ai.faction;
                        n.progress = 0;
                        World.setNodeColor(n, ai.faction);
                        if (n.playerContributed) {
                            XP.award('capture');
                            STATS.nodesCaptured++;
                            Effects.spawnCapture(n.x, n.z, FACTIONS[ai.faction].color);
                            Audio.play('capture', n.x, n.z);
                            n.playerContributed = false;
                        }
                        ai.targetNode = null; ai.taskTimer = 0;
                    }
                }
            }
        } else {
            if (ai.targetNode.progress > 0 && ai.targetNode.owner !== ai.faction) {
                ai.targetNode.progress = Math.max(0, ai.targetNode.progress - dt * CONFIG.CAPTURE_SPEED * 0.1);
            }
        }
    }

    function _doBuild(ai, dt) {
        if (!ai.targetNode) { ai.targetNode = _findBuildNode(ai); }
        if (!ai.targetNode) { ai.task = 'CAPTURE'; ai.taskTimer = 0; return; }
        _moveTo(ai, ai.targetNode.x, ai.targetNode.z, dt);
        const dx = ai.mesh.position.x - ai.targetNode.x;
        const dz = ai.mesh.position.z - ai.targetNode.z;
        if (Math.sqrt(dx*dx+dz*dz) < 90) {
            _tryBuild(ai);
            ai.targetNode = null; ai.taskTimer = 0;
        }
    }

    function _doAttack(ai, dt) {
        const agg   = _aggression[ai.faction];
        const range = (1600 * agg) * (1600 * agg);

        // Use coordinated attack target if fighter and it's in range
        const coord = _attackTarget[ai.faction];
        if (coord && ai.role === 'FIGHTER') {
            const dx=coord.x-ai.mesh.position.x, dz=coord.z-ai.mesh.position.z;
            const d = dx*dx+dz*dz;
            if (d < range * 4) {
                // Move toward coord target node, then fight enemies there
                const enemy = _nearestEnemyAtNode(coord, ai.faction);
                if (enemy) { _shootAt(ai, enemy.x, enemy.z, dt); return; }
                // No enemy there yet — move to node and wait
                _moveTo(ai, coord.x, coord.z, dt);
                return;
            }
        }

        // Hunt nearest enemy
        const enemy = _nearestEnemy(ai, range);
        if (!enemy) {
            // No enemy in range — patrol toward frontline
            ai.task = 'PATROL'; ai.taskTimer = 0; return;
        }
        _shootAt(ai, enemy.x, enemy.z, dt);
    }

    function _doDefend(ai, dt) {
        const node = _threatenedNode(ai.faction) || ai.targetNode;
        if (!node) { ai.task = 'CAPTURE'; ai.taskTimer = 0; return; }
        const enemy = _nearestEnemyAtNode(node, ai.faction);
        if (enemy) { _shootAt(ai, enemy.x, enemy.z, dt); return; }
        const bldg = _enemyBuildingAt(node, ai.faction);
        if (bldg) { _shootAt(ai, bldg.x, bldg.z, dt); return; }
        _moveTo(ai, node.x, node.z, dt);
    }

    function _doPatrol(ai, dt) {
        // Escort lonely builders heading to frontline
        if (ai.role === 'FIGHTER') {
            const builder = GAME.aiShips.find(s => {
                if (s.faction !== ai.faction || s.role !== 'BUILDER' || !s.targetNode) return false;
                // Builder heading to a node close to enemy territory
                const frontlineDist = _closestEnemyNodeDist(s.targetNode);
                return frontlineDist < 2000*2000;
            });
            if (builder && builder.targetNode) {
                const dx=builder.mesh.position.x-ai.mesh.position.x;
                const dz=builder.mesh.position.z-ai.mesh.position.z;
                if (dx*dx+dz*dz < 2200*2200) {
                    // Stay near the builder, intercept any enemies
                    const enemy = _nearestEnemy(ai, 800*800);
                    if (enemy) { _shootAt(ai, enemy.x, enemy.z, dt); return; }
                    _moveTo(ai, builder.mesh.position.x+60, builder.mesh.position.z+60, dt);
                    return;
                }
            }
        }

        if (!ai.targetNode || ai.targetNode.owner !== ai.faction) {
            ai.targetNode = _frontlineNode(ai);
        }
        if (!ai.targetNode) { ai.task = 'CAPTURE'; ai.taskTimer = 0; return; }

        const enemy = _nearestEnemy(ai, 1200*1200);
        if (enemy) { ai.task = 'ATTACK'; ai.taskTimer = 0; return; }

        // Orbit the frontline node
        const nx=ai.targetNode.x, nz=ai.targetNode.z;
        const angle = performance.now()*0.0004 + ai.mesh.id;
        _moveTo(ai, nx+Math.cos(angle)*180, nz+Math.sin(angle)*180, dt);
    }

    // ── COMBAT ────────────────────────────────────────────────────────────────
    function _shootAt(ai, tx, tz, dt) {
        const dx=tx-ai.mesh.position.x, dz=tz-ai.mesh.position.z;
        const dist=Math.sqrt(dx*dx+dz*dz);

        // Ship-class specific ideal combat range
        const IDEAL = {
            DREADNOUGHT: 520,  // hang back, lob bombs
            CARRIER:     380,  // stay safe, pulse from distance
            SCOUT:       200,  // dart in close, fast passes
            FIGHTER:     260,
            ASSAULT:     280,
            ENGINEER:    300,
        }[ai.shipClass] || 280;

        // Evasion — if low HP, strafe harder and try to open distance
        const evading = ai.hp < ai.maxHp * 0.4;
        const strafeStr = evading ? 1.2 : 0.6;
        const backoffDist = evading ? IDEAL + 200 : IDEAL - 100;

        if (dist > IDEAL+100) {
            _moveTo(ai, tx, tz, dt);
        } else if (dist < backoffDist) {
            const drag=1-CONFIG.SHIP_DRAG*dt;
            ai.vx-=(dx/dist)*CONFIG.SHIP_THRUST*dt*0.85; ai.vz-=(dz/dist)*CONFIG.SHIP_THRUST*dt*0.85;
            ai.vx*=drag; ai.vz*=drag;
            ai.mesh.position.x+=ai.vx*dt; ai.mesh.position.z+=ai.vz*dt;
        } else {
            const s=ai.strafeSign*(Math.sin(performance.now()*0.0005+ai.mesh.id*2.1)>0?1:-1);
            const drag=1-CONFIG.SHIP_DRAG*dt;
            ai.vx+=(-dz/dist)*CONFIG.SHIP_THRUST*dt*s*strafeStr; ai.vz+=(dx/dist)*CONFIG.SHIP_THRUST*dt*s*strafeStr;
            ai.vx*=drag; ai.vz*=drag;
            ai.mesh.position.x+=ai.vx*dt; ai.mesh.position.z+=ai.vz*dt;
        }

        ai.mesh.rotation.y = Math.atan2(-dx,-dz);

        if (ai.fireCooldown <= 0 && dist < IDEAL+400) {
            const wep  = ai.shipClass ? SHIP_CLASSES[ai.shipClass].weapon : null;
            const rate = (wep && wep.fireRate) ? wep.fireRate : CONFIG.FIRE_RATE*(1.1+Math.random()*0.7);
            ai.fireCooldown = rate;
            Combat.spawnProjectile(ai.mesh.position.x, ai.mesh.position.z, ai.mesh.rotation.y, ai.faction, 1, wep);
        }
    }

    function _selfDefense(ai, dt) {
        if (ai.task === 'ATTACK') return;
        if (ai.fireCooldown > 0) return;

        // Wider range while capping so they respond sooner
        const DR = ai.task === 'CAPTURE' ? 550*550 : 420*420;
        let nx=null, nz=null, nd=DR;

        if (ai.faction!==GAME.player.faction) {
            const d=_dist2(ai,GAME.player.mesh.position.x,GAME.player.mesh.position.z);
            if(d<nd){nd=d;nx=GAME.player.mesh.position.x;nz=GAME.player.mesh.position.z;}
        }
        GAME.aiShips.forEach(o=>{
            if(o===ai||o.faction===ai.faction)return;
            const d=_dist2(ai,o.mesh.position.x,o.mesh.position.z);
            if(d<nd){nd=d;nx=o.mesh.position.x;nz=o.mesh.position.z;}
        });
        if(nx===null)return;

        // Fire back
        const angle=Math.atan2(-(nx-ai.mesh.position.x),-(nz-ai.mesh.position.z));
        const wep  =ai.shipClass?SHIP_CLASSES[ai.shipClass].weapon:null;
        const rate =(wep&&wep.fireRate)?wep.fireRate:CONFIG.FIRE_RATE*(1.5+Math.random());
        ai.fireCooldown=rate;
        Combat.spawnProjectile(ai.mesh.position.x,ai.mesh.position.z,angle,ai.faction,1,wep);

        // Strafe sideways while firing (don't just stand still)
        if (ai.task === 'CAPTURE') {
            const dx=nx-ai.mesh.position.x, dz=nz-ai.mesh.position.z;
            const dist=Math.sqrt(dx*dx+dz*dz);
            if (dist > 0) {
                const s = ai.strafeSign;
                const drag=1-CONFIG.SHIP_DRAG*dt;
                ai.vx+=(-dz/dist)*CONFIG.SHIP_THRUST*dt*s*0.5;
                ai.vz+=(dx/dist)*CONFIG.SHIP_THRUST*dt*s*0.5;
                ai.vx*=drag; ai.vz*=drag;
                ai.mesh.position.x+=ai.vx*dt;
                ai.mesh.position.z+=ai.vz*dt;
            }
        }
    }

    // ── BUILDING ──────────────────────────────────────────────────────────────
    function _tryBuild(ai) {
        const n=ai.targetNode;
        if(!n||n.owner!==ai.faction)return;
        const f=ai.faction, CR=CONFIG.CAPTURE_RADIUS;
        const hasCC     =GAME.buildings.some(b=>b.faction===f&&b.type==='COMMAND_CENTER'&&_near(b.x,b.z,n.x,n.z,CR));
        const hasMiner  =GAME.buildings.some(b=>b.faction===f&&b.type==='AUTO_MINER'    &&_near(b.x,b.z,n.x,n.z,CR));
        const hasTurret =GAME.buildings.some(b=>b.faction===f&&b.type==='TURRET'        &&_near(b.x,b.z,n.x,n.z,CR));
        const hasRepair =GAME.buildings.some(b=>b.faction===f&&b.type==='REPAIR_BCN'    &&_near(b.x,b.z,n.x,n.z,CR));
        let type=null;
        if      (!hasTurret && _res[f]>=BLDG.TURRET.cost)              type='TURRET';
        else if (!hasCC     && _res[f]>=BLDG.COMMAND_CENTER.cost)      type='COMMAND_CENTER';
        else if (hasCC&&!hasMiner  && _res[f]>=BLDG.AUTO_MINER.cost)   type='AUTO_MINER';
        else if (hasCC&&!hasRepair && _res[f]>=BLDG.REPAIR_BCN.cost)   type='REPAIR_BCN';
        if(!type)return;
        const angle=Math.random()*Math.PI*2;
        const r=30+Math.random()*(CR*0.6);
        const bx=n.x+Math.cos(angle)*r, bz=n.z+Math.sin(angle)*r;
        _res[f]-=BLDG[type].cost;
        _aiBuild(type,bx,bz,f);
    }

    function _aiBuild(type,x,z,fac) {
        if(!World.nearestOwnedNode(x,z,fac))return;
        const node=World.nearestOwnedNode(x,z,fac);
        const CR=CONFIG.CAPTURE_RADIUS;
        const count=GAME.buildings.filter(b=>{const dx=b.x-node.x,dz=b.z-node.z;return dx*dx+dz*dz<CR*CR;}).length;
        if(count>=CONFIG.MAX_BLDG_PER_NODE)return;
        if(type==='COMMAND_CENTER'&&GAME.buildings.some(b=>{if(b.type!=='COMMAND_CENTER')return false;const dx=b.x-node.x,dz=b.z-node.z;return dx*dx+dz*dz<CR*CR;}))return;
        const def=BLDG[type];
        const mesh=Buildings._createMeshPublic(type,x,z,fac);
        GAME.scene.add(mesh);
        GAME.buildings.push({type,faction:fac,x,z,hp:def.hp,maxHp:def.hp,mesh,timer:0});
    }

    // ── MOVEMENT ──────────────────────────────────────────────────────────────
    function _moveTo(ai, tx, tz, dt) {
        const dx=tx-ai.mesh.position.x, dz=tz-ai.mesh.position.z;
        const dist=Math.sqrt(dx*dx+dz*dz);
        if(dist<22){ai.vx*=0.78;ai.vz*=0.78;return;}
        ai.mesh.rotation.y=Math.atan2(-dx,-dz);
        const ndx=dx/dist, ndz=dz/dist;
        const spd=Math.sqrt(ai.vx*ai.vx+ai.vz*ai.vz);
        const stopDist=(spd*spd)/(2*CONFIG.SHIP_THRUST*0.6);
        if(dist<stopDist*1.3&&spd>20){
            ai.vx-=ndx*CONFIG.SHIP_THRUST*dt*0.85;
            ai.vz-=ndz*CONFIG.SHIP_THRUST*dt*0.85;
        } else {
            const t=Math.min(1,dist/350);
            ai.vx+=ndx*CONFIG.SHIP_THRUST*dt*t;
            ai.vz+=ndz*CONFIG.SHIP_THRUST*dt*t;
        }
        const drag=1-CONFIG.SHIP_DRAG*dt;
        ai.vx*=drag; ai.vz*=drag;
        if(spd>ai.speed){ai.vx=(ai.vx/spd)*ai.speed;ai.vz=(ai.vz/spd)*ai.speed;}
        ai.mesh.position.x+=ai.vx*dt;
        ai.mesh.position.z+=ai.vz*dt;
        const half=CONFIG.MAP_SIZE/2-100;
        ai.mesh.position.x=Math.max(-half,Math.min(half,ai.mesh.position.x));
        ai.mesh.position.z=Math.max(-half,Math.min(half,ai.mesh.position.z));
    }

    function _retreat(ai, dt) {
        let best=null, bd=Infinity;
        GAME.buildings.forEach(b=>{
            if(b.type!=='REPAIR_BCN'||b.faction!==ai.faction)return;
            const d=_dist2(ai,b.x,b.z); if(d<bd){bd=d;best=b;}
        });
        if(best){_moveTo(ai,best.x,best.z,dt);return;}
        const fd=FACTIONS[ai.faction];
        if(!ai.retreatTarget||_dist2(ai,ai.retreatTarget.x,ai.retreatTarget.z)<40*40)
            ai.retreatTarget={x:fd.sx+(Math.random()-0.5)*160,z:fd.sz+(Math.random()-0.5)*160};
        _moveTo(ai,ai.retreatTarget.x,ai.retreatTarget.z,dt);
    }

    // ── TARGET HELPERS ────────────────────────────────────────────────────────

    function _bestCaptureNode(ai) {
        const f=ai.faction, agg=_aggression[f];
        const candidates=GAME.territory.filter(n=>n.owner!==f);
        if(!candidates.length)return null;
        const taken=new Set(GAME.aiShips.filter(s=>s!==ai&&s.faction===f&&s.targetNode).map(s=>s.targetNode));
        return candidates.sort((a,b)=>{
            const da=_dist2(ai,a.x,a.z), db=_dist2(ai,b.x,b.z);
            const pa=taken.has(a)?600*600:0, pb=taken.has(b)?600*600:0;
            // Prefer unowned nodes early, enemy nodes when aggressive
            const ra = a.owner && a.owner!==f ? (1000000/agg) : 0;
            const rb = b.owner && b.owner!==f ? (1000000/agg) : 0;
            return (da+pa+ra)-(db+pb+rb);
        })[0];
    }

    // Frontline node — owned node closest to enemy territory
    function _frontlineNode(ai) {
        const f=ai.faction;
        const ownedNodes=GAME.territory.filter(n=>n.owner===f);
        if(!ownedNodes.length)return null;
        return ownedNodes.sort((a,b)=>{
            const scoreA=_closestEnemyNodeDist(a);
            const scoreB=_closestEnemyNodeDist(b);
            return scoreA-scoreB; // lower = closer to enemy = frontline
        })[0];
    }

    function _closestEnemyNodeDist(node) {
        let minD=Infinity;
        GAME.territory.forEach(n=>{
            if(n.owner===node.owner||!n.owner)return;
            const dx=n.x-node.x,dz=n.z-node.z;
            const d=dx*dx+dz*dz;
            if(d<minD)minD=d;
        });
        return minD;
    }

    function _findBuildNode(ai) {
        const f=ai.faction, CR=CONFIG.CAPTURE_RADIUS;
        const candidates=GAME.territory.filter(n=>{
            if(n.owner!==f)return false;
            const hasT =GAME.buildings.some(b=>b.faction===f&&b.type==='TURRET'        &&_near(b.x,b.z,n.x,n.z,CR));
            const hasCC=GAME.buildings.some(b=>b.faction===f&&b.type==='COMMAND_CENTER' &&_near(b.x,b.z,n.x,n.z,CR));
            const hasM =GAME.buildings.some(b=>b.faction===f&&b.type==='AUTO_MINER'     &&_near(b.x,b.z,n.x,n.z,CR));
            const hasR =GAME.buildings.some(b=>b.faction===f&&b.type==='REPAIR_BCN'     &&_near(b.x,b.z,n.x,n.z,CR));
            if(!hasT  &&_res[f]>=BLDG.TURRET.cost)return true;
            if(!hasCC &&_res[f]>=BLDG.COMMAND_CENTER.cost)return true;
            if(hasCC&&!hasM&&_res[f]>=BLDG.AUTO_MINER.cost)return true;
            if(hasCC&&!hasR&&_res[f]>=BLDG.REPAIR_BCN.cost)return true;
            return false;
        });
        if(!candidates.length)return null;
        // Prioritise frontline nodes — closest to enemy territory
        return candidates.sort((a,b)=>_closestEnemyNodeDist(a)-_closestEnemyNodeDist(b))[0];
    }

    function _threatenedNode(fac) {
        for(const n of GAME.territory){
            if(n.owner!==fac)continue;
            const CR=CONFIG.CAPTURE_RADIUS*CONFIG.CAPTURE_RADIUS;
            const hasEnemy=(fac!==GAME.player.faction&&_playerAtNode(n))||
                GAME.aiShips.some(o=>{
                    if(o.faction===fac)return false;
                    const dx=o.mesh.position.x-n.x,dz=o.mesh.position.z-n.z;
                    return dx*dx+dz*dz<CR;
                });
            if(hasEnemy)return n;
        }
        return null;
    }

    function _playerAtNode(n){
        const dx=GAME.player.mesh.position.x-n.x,dz=GAME.player.mesh.position.z-n.z;
        return dx*dx+dz*dz<CONFIG.CAPTURE_RADIUS*CONFIG.CAPTURE_RADIUS;
    }

    function _nearestEnemyAtNode(node,fac){
        let best=null,bd=Infinity;
        if(fac!==GAME.player.faction){
            const dx=GAME.player.mesh.position.x-node.x,dz=GAME.player.mesh.position.z-node.z,d=dx*dx+dz*dz;
            if(d<CONFIG.CAPTURE_RADIUS*CONFIG.CAPTURE_RADIUS){best={x:GAME.player.mesh.position.x,z:GAME.player.mesh.position.z};bd=d;}
        }
        GAME.aiShips.forEach(o=>{
            if(o.faction===fac)return;
            const dx=o.mesh.position.x-node.x,dz=o.mesh.position.z-node.z,d=dx*dx+dz*dz;
            if(d<CONFIG.CAPTURE_RADIUS*CONFIG.CAPTURE_RADIUS&&d<bd){bd=d;best={x:o.mesh.position.x,z:o.mesh.position.z};}
        });
        return best;
    }

    function _enemyBuildingAt(node,fac){
        return GAME.buildings.find(b=>{
            if(b.faction===fac)return false;
            const dx=b.x-node.x,dz=b.z-node.z;
            return dx*dx+dz*dz<CONFIG.CAPTURE_RADIUS*CONFIG.CAPTURE_RADIUS;
        })||null;
    }

    function _nearestEnemy(ai,rangeSquared){
        let best=null,bd=rangeSquared;
        if(ai.faction!==GAME.player.faction){
            const d=_dist2(ai,GAME.player.mesh.position.x,GAME.player.mesh.position.z);
            if(d<bd){bd=d;best={x:GAME.player.mesh.position.x,z:GAME.player.mesh.position.z};}
        }
        GAME.aiShips.forEach(o=>{
            if(o===ai||o.faction===ai.faction)return;
            const d=_dist2(ai,o.mesh.position.x,o.mesh.position.z);
            if(d<bd){bd=d;best={x:o.mesh.position.x,z:o.mesh.position.z};}
        });
        return best;
    }

    function _nearestFriendlyBeacon(ai,rangeSquared){
        let best=null,bd=rangeSquared;
        GAME.buildings.forEach(b=>{
            if(b.type!=='REPAIR_BCN'||b.faction!==ai.faction)return;
            const d=_dist2(ai,b.x,b.z);
            if(d<bd){bd=d;best=b;}
        });
        return best;
    }

    // ── RESOURCES ─────────────────────────────────────────────────────────────
    function _tickResources(dt) {
        _resTimer-=dt; if(_resTimer>0)return; _resTimer=2.5;
        AI_FACS.forEach(f=>{
            if(!_res[f])_res[f]=0;
            _res[f]+=18;
            GAME.buildings.forEach(b=>{
                if(b.faction!==f)return;
                if(b.type==='AUTO_MINER')    _res[f]+=CONFIG.MINE_AMOUNT;
                if(b.type==='COMMAND_CENTER')_res[f]+=6;
            });
            GAME.territory.forEach(n=>{if(n.owner===f)_res[f]+=2;});
            _res[f]=Math.min(_res[f],5000);
        });
    }

    function _tickRespawn(dt) {
        for(let i=_respawnQueue.length-1;i>=0;i--){
            _respawnQueue[i].timer-=dt;
            if(_respawnQueue[i].timer<=0){_spawn(_respawnQueue[i].faction,_respawnQueue[i].role);_respawnQueue.splice(i,1);}
        }
    }

    // ── UTILS ─────────────────────────────────────────────────────────────────
    function _tryMineNearby(ai) {
        if (ai.fireCooldown > 0) return;
        const MINE_R = 380*380;
        for (const r of GAME.resources) {
            if (!r.active) continue;
            const dx=r.x-ai.mesh.position.x, dz=r.z-ai.mesh.position.z;
            if (dx*dx+dz*dz < MINE_R) {
                const angle=Math.atan2(-dx,-dz);
                ai.fireCooldown = CONFIG.FIRE_RATE * 2;
                Combat.spawnProjectile(ai.mesh.position.x, ai.mesh.position.z, angle, ai.faction);
                return;
            }
        }
    }

    function _near(x1,z1,x2,z2,r){const dx=x1-x2,dz=z1-z2;return dx*dx+dz*dz<r*r;}
    function _dist2(ai,x,z){const dx=x-ai.mesh.position.x,dz=z-ai.mesh.position.z;return dx*dx+dz*dz;}
    function _thrustAnim(ai){const t=1.4+Math.random()*0.4;ai.engGlows.forEach(e=>{e.material.emissiveIntensity+=(t-e.material.emissiveIntensity)*0.2;});}

    // ── KILL ──────────────────────────────────────────────────────────────────
    function killShip(idx) {
        if(idx<0||idx>=GAME.aiShips.length)return;
        const ai=GAME.aiShips[idx];
        GAME.scene.remove(ai.mesh);
        _respawnQueue.push({faction:ai.faction,role:ai.role,timer:10+Math.random()*5});
        GAME.aiShips.splice(idx,1);
    }

    function scheduleRespawn(){}

    return { init, update, killShip, scheduleRespawn, _aiBuild, addFactionResources };
})();
