'use strict';

const World = (() => {
    const _ray       = new THREE.Raycaster();
    const _gndPlane  = new THREE.Plane(new THREE.Vector3(0,1,0), 0);

    // ── GENERATE ──────────────────────────────────────────────────────────────
    function generate() {
        _buildNebulae();
        _spawnTerritoryNodes();
        _spawnResourceNodes();
        _spawnAsteroids();
        _placeFactionBases();
    }

    function _buildNebulae() {
        const cols = [0x0a0030, 0x001020, 0x1a0010, 0x000a22];
        for (let i = 0; i < 10; i++) {
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(500+Math.random()*700, 7, 7),
                new THREE.MeshBasicMaterial({ color:cols[i%cols.length], transparent:true, opacity:0.12, side:THREE.BackSide })
            );
            mesh.position.set(
                (Math.random()-0.5)*CONFIG.MAP_SIZE*1.3,
                -350-Math.random()*200,
                (Math.random()-0.5)*CONFIG.MAP_SIZE*1.3
            );
            GAME.scene.add(mesh);
        }
    }

    const MIN_NODE_DIST = 480;

    function _spawnTerritoryNodes() {
        // Six concentric rings scaled for 14000 map
        const rings = [
            { count:  6, rMin:  200, rMax:  600 },   // centre
            { count: 12, rMin:  750, rMax: 1200 },   // inner
            { count: 16, rMin: 1400, rMax: 2000 },   // mid-inner
            { count: 20, rMin: 2200, rMax: 3000 },   // mid
            { count: 22, rMin: 3200, rMax: 4100 },   // mid-outer
            { count: 20, rMin: 4400, rMax: 5400 },   // outer
            { count: 16, rMin: 5700, rMax: 6400 },   // far outer
        ];

        rings.forEach(({ count, rMin, rMax }) => {
            for (let i = 0; i < count; i++) {
                const a = (i/count)*Math.PI*2 + (Math.random()-0.5)*(Math.PI*2/count)*0.35;
                const r = rMin + Math.random()*(rMax-rMin);
                _tryAddNode(Math.cos(a)*r, Math.sin(a)*r);
            }
        });

        // Corner clusters — one near each faction base (not too close)
        Object.values(FACTIONS).forEach(f => {
            // Place a small cluster of 3-4 nodes between the base and the centre
            for (let i = 0; i < 5; i++) {
                const angle = Math.atan2(-f.sz, -f.sx) + (Math.random()-0.5)*0.8;
                const dist  = 1800 + Math.random()*1400;
                _tryAddNode(
                    f.sx + Math.cos(angle)*dist * 0.55,
                    f.sz + Math.sin(angle)*dist * 0.55
                );
            }
        });
    }

    function _tryAddNode(x, z) {
        for (const node of GAME.territory) {
            const dx = x-node.x, dz = z-node.z;
            if (dx*dx+dz*dz < MIN_NODE_DIST*MIN_NODE_DIST) return;
        }
        for (const f of Object.values(FACTIONS)) {
            const dx = x-f.sx, dz = z-f.sz;
            if (dx*dx+dz*dz < 500*500) return;
        }
        _addNode(x, z);
    }

    function _addNode(x, z) {
        const group = Render.createNodeMesh(x, z);
        GAME.scene.add(group);
        const ud = group.userData;
        GAME.territory.push({
            x, z,
            owner:    null,
            progress: 0,
            group,
            platform: ud.platform,
            trim:     ud.trim,
            ring:     ud.ring,
            beacon:   ud.beacon,
            orb:      ud.orb,
            progressArc: ud.progressArc,
            _lastArcProgress: -1,
        });
    }

    function _spawnResourceNodes() {
        const half = CONFIG.MAP_SIZE / 2;
        let attempts = 0;
        let placed   = 0;
        while (placed < CONFIG.RESOURCE_NODES && attempts < CONFIG.RESOURCE_NODES * 8) {
            attempts++;
            const a = Math.random()*Math.PI*2;
            const r = 400 + Math.random()*(half - 500);
            const x = Math.cos(a)*r;
            const z = Math.sin(a)*r;

            // Don't spawn inside any territory node's capture radius
            const tooClose = GAME.territory.some(n => {
                const dx = x-n.x, dz = z-n.z;
                return dx*dx+dz*dz < (CONFIG.CAPTURE_RADIUS+80)*(CONFIG.CAPTURE_RADIUS+80);
            });
            if (tooClose) continue;

            // Don't spawn too close to faction bases
            const nearBase = Object.values(FACTIONS).some(f => {
                const dx = x-f.sx, dz = z-f.sz;
                return dx*dx+dz*dz < 500*500;
            });
            if (nearBase) continue;

            const group = Render.createResourceMesh(x, z);
            GAME.scene.add(group);
            GAME.resources.push({ x, z, active:true, respawnTimer:0, hp:CONFIG.ROCK_HP, maxHp:CONFIG.ROCK_HP, group });
            placed++;
        }
    }

    function _spawnAsteroids() {
        // Intentionally empty — all rocks are now mineable resource nodes
    }

    function _placeFactionBases() {
        Object.values(FACTIONS).forEach(f => {
            // Large glowing ring
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(140,158,32),
                new THREE.MeshBasicMaterial({ color:f.color, side:THREE.DoubleSide, transparent:true, opacity:0.45 })
            );
            ring.rotation.x = -Math.PI/2;
            ring.position.set(f.sx, 1, f.sz);
            GAME.scene.add(ring);

            // Platform base
            const pad = new THREE.Mesh(
                new THREE.CylinderGeometry(130,130,12,8),
                new THREE.MeshStandardMaterial({ color:f.color, emissive:f.color, emissiveIntensity:0.12, roughness:0.7 })
            );
            pad.position.set(f.sx, -6, f.sz);
            GAME.scene.add(pad);

            // Faction label geometry (4 corner pillars)
            for (const [ox,oz] of [[-110,-110],[110,-110],[110,110],[-110,110]]) {
                const pillar = new THREE.Mesh(
                    new THREE.CylinderGeometry(5,5,60,6),
                    new THREE.MeshStandardMaterial({ color:f.color, emissive:f.color, emissiveIntensity:0.5 })
                );
                pillar.position.set(f.sx+ox, 30, f.sz+oz);
                GAME.scene.add(pillar);
            }
        });
    }

    // ── MOUSE WORLD POSITION ─────────────────────────────────────────────────
    function getMouseWorldPos() {
        const mx = ( GAME.mouse.x / window.innerWidth )*2 - 1;
        const my = -(GAME.mouse.y / window.innerHeight)*2 + 1;
        _ray.setFromCamera({ x:mx, y:my }, GAME.camera);
        const out = new THREE.Vector3();
        _ray.ray.intersectPlane(_gndPlane, out);
        return out;
    }

    // ── UPDATE ────────────────────────────────────────────────────────────────
    function update(dt) {
        _updateTerritoryNodes(dt);
        _updateResourceNodes(dt);
    }

    function _updateTerritoryNodes(dt) {
        const px   = GAME.player.mesh.position.x;
        const pz   = GAME.player.mesh.position.z;
        const pfac = GAME.player.faction;
        const t    = performance.now() * 0.001;

        GAME.territory.forEach((node, idx) => {
            // Beacon pulse
            const pulse = 0.35 + Math.sin(t*1.8 + idx*0.9)*0.18;
            node.orb.material.emissiveIntensity = pulse;

            // Player capture check
            const dx   = px - node.x;
            const dz   = pz - node.z;
            const dist = Math.sqrt(dx*dx + dz*dz);

            const playerInside = dist < CONFIG.CAPTURE_RADIUS;

            if (playerInside) {
                node.ring.material.opacity = 0.38 + Math.sin(t*4)*0.08;

                if (node.owner === pfac) {
                    node.progress = 0;
                    node.ring.material.color.setHex(FACTIONS[pfac].color);
                    node.playerContributed = false;
                } else if (_hasEnemyStructures(node, pfac)) {
                    node.ring.material.color.setHex(0xff2200);
                    node.progress = 0;
                    node.playerContributed = false;
                } else if (_hasFriendlyShip(node, pfac)) {
                    node.ring.material.color.setHex(0xff2200);
                    node.progress = 0;
                } else {
                    const capFac = getCapturingFaction(node);
                    if (capFac === 'CONTESTED') {
                        // Stalemate — freeze progress, don't decay
                        node.ring.material.color.setHex(0xff8800);
                        Audio.play('contest', node.x, node.z);
                    } else {
                        // Sole attacker (capFac === pfac) or nobody else (capFac === null) — capture
                        node.playerContributed = true;
                        node.ring.material.color.setHex(FACTIONS[pfac].color);
                        const capMult = (SHIP_CLASSES[GAME.player.shipClass]||{captureSpeed:1}).captureSpeed || 1;
                        node.progress = Math.min(100, node.progress + dt * CONFIG.CAPTURE_SPEED * capMult);
                        if (node.progress >= 100) {
                            node.owner    = pfac;
                            node.progress = 0;
                            node.playerContributed = false;
                            _colorNode(node, pfac);
                            Effects.spawnCapture(node.x, node.z, FACTIONS[pfac].color);
                            Audio.play('capture', node.x, node.z);
                            STATS.nodesCaptured++;
                            XP.award('capture');
                        }
                    }
                }
            } else {
                node.ring.material.opacity = 0.16 + Math.sin(t*1.2+idx)*0.04;
                node.ring.material.color.setHex(node.owner ? FACTIONS[node.owner].color : 0x224466);
                // Decay when player leaves — much slower than slowest cap speed (0.4×)
                if (node.progress > 0) node.progress = Math.max(0, node.progress - dt * CONFIG.CAPTURE_SPEED * 0.1);
                // Player left — clear contribution flag
                node.playerContributed = false;
            }

            // Passive income for player's owned nodes
            if (node.owner === pfac) {
                GAME.player.resources += CONFIG.NODE_INCOME * dt;
            }

            // Progress arc — update only when progress changes, hide when idle
            _updateProgressArc(node);
        });
    }

    function _updateProgressArc(node) {
        const arc = node.progressArc;
        if (!arc) return;

        if (node.progress <= 0) {
            arc.visible = false;
            node._lastArcProgress = -1;
            return;
        }

        // Only rebuild geometry when progress changes by at least 1%
        if (Math.abs((node._lastArcProgress || 0) - node.progress) < 1) return;
        node._lastArcProgress = node.progress;

        // Colour: faction colour if being capped by a known faction, else white
        const capFac = node.owner
            ? null   // owned node being stolen — find who's capping below
            : null;
        // Find which faction is inside this node (who's capping it)
        let capColor = 0xffffff;
        GAME.aiShips.forEach(ai => {
            const dx = ai.mesh.position.x - node.x, dz = ai.mesh.position.z - node.z;
            if (dx*dx + dz*dz < CONFIG.CAPTURE_RADIUS * CONFIG.CAPTURE_RADIUS) {
                if (!node.owner || ai.faction !== node.owner) {
                    capColor = FACTIONS[ai.faction].color;
                }
            }
        });
        // Check player too
        const pdx = GAME.player.mesh.position.x - node.x, pdz = GAME.player.mesh.position.z - node.z;
        if (pdx*pdx + pdz*pdz < CONFIG.CAPTURE_RADIUS * CONFIG.CAPTURE_RADIUS) {
            if (!node.owner || GAME.player.faction !== node.owner) {
                capColor = FACTIONS[GAME.player.faction].color;
            }
        }

        arc.material.color.setHex(capColor);
        arc.geometry.dispose();
        arc.geometry = Render.buildProgressArcGeo(node.progress, CONFIG.CAPTURE_RADIUS);
        arc.visible = true;
    }

    function _colorNode(node, factionId) {
        const col  = factionId ? FACTIONS[factionId].color : 0x2255aa;

        node.trim.material.color.setHex(col);
        node.trim.material.emissive.setHex(col);
        node.trim.material.emissiveIntensity = factionId ? 0.9 : 0.8;

        node.beacon.material.color.setHex(col);
        node.beacon.material.emissive.setHex(col);
        node.beacon.material.emissiveIntensity = factionId ? 1.0 : 0.8;

        node.orb.material.color.setHex(factionId ? col : 0x4488cc);
        node.orb.material.emissive.setHex(col);
        node.orb.material.emissiveIntensity = factionId ? 2.2 : 1.8;

        node.ring.material.color.setHex(col);
        node.ring.material.opacity = factionId ? 0.5 : 0.35;
    }

    function addNodeAt(x, z) {
        _addNode(x, z);
    }

    function addResourceAt(x, z) {
        const group = Render.createResourceMesh(x, z);
        GAME.scene.add(group);
        GAME.resources.push({
            x, z, active:true,
            hp:CONFIG.ROCK_HP, maxHp:CONFIG.ROCK_HP,
            respawnTimer:0, group,
        });
    }

    function setNodeColor(node, factionId) {
        _colorNode(node, factionId);
    }

    function _updateResourceNodes(dt) {
        const t = performance.now() * 0.001;
        GAME.resources.forEach(node => {
            if (!node.active) {
                node.respawnTimer -= dt;
                if (node.respawnTimer <= 0) {
                    node.active = true;
                    node.hp     = node.maxHp;
                    node.group.visible = true;
                    // Reset scale
                    node.group.scale.setScalar(1);
                }
                return;
            }
            // Slow spin to make them feel alive
            node.group.children.forEach(c => { c.rotation.y += dt * 0.25; });
            // Visual damage — shrink slightly as HP drops
            const pct = node.hp / node.maxHp;
            node.group.scale.setScalar(0.7 + pct * 0.3);
        });
    }

    // Called by combat.js when a rock takes a killing hit
    function destroyResource(idx, killerFaction) {
        if (idx < 0 || idx >= GAME.resources.length) return;
        const r = GAME.resources[idx];
        r.active = false;
        r.hp     = r.maxHp;
        r.respawnTimer = CONFIG.RES_RESPAWN;
        r.group.visible = false;

        if (killerFaction === GAME.player.faction) {
            GAME.player.resources += CONFIG.RES_VALUE;
            UI.showMsg('+' + CONFIG.RES_VALUE + ' resources mined', 'ok');
        } else {
            // Award AI faction via exposed function
            AI.addFactionResources(killerFaction, CONFIG.RES_VALUE);
        }
    }

    // Damage a resource node — called by combat.js
    function damageResource(idx, amount, killerFaction) {
        if (idx < 0 || idx >= GAME.resources.length) return;
        const r = GAME.resources[idx];
        if (!r.active) return;
        r.hp -= amount;
        if (r.hp <= 0) destroyResource(idx, killerFaction);
    }

    function _hasEnemyStructures(node, forFaction) {
        return GAME.buildings.some(b => {
            if (b.faction === forFaction) return false;
            const dx = b.x - node.x, dz = b.z - node.z;
            return dx*dx + dz*dz < CONFIG.CAPTURE_RADIUS * CONFIG.CAPTURE_RADIUS;
        });
    }

    // Returns true if a ship belonging to node.owner is inside the capture radius
    function _hasFriendlyShip(node, attackerFaction) {
        if (!node.owner) return false;
        // Check AI ships of owning faction
        return GAME.aiShips.some(ai => {
            if (ai.faction !== node.owner) return false;
            const dx = ai.mesh.position.x - node.x, dz = ai.mesh.position.z - node.z;
            return dx*dx + dz*dz < CONFIG.CAPTURE_RADIUS * CONFIG.CAPTURE_RADIUS;
        }) || (
            // Check if player is the owner and is inside
            GAME.player.faction === node.owner && (() => {
                const dx = GAME.player.mesh.position.x - node.x;
                const dz = GAME.player.mesh.position.z - node.z;
                return dx*dx + dz*dz < CONFIG.CAPTURE_RADIUS * CONFIG.CAPTURE_RADIUS;
            })()
        );
    }

    // Public version used by ai.js
    function hasEnemyStructures(node, forFaction) {
        return _hasEnemyStructures(node, forFaction);
    }

    function hasFriendlyShip(node, attackerFaction) {
        return _hasFriendlyShip(node, attackerFaction);
    }

    // Returns the sole attacking faction if only one enemy faction is inside the node.
    // Returns null if nobody is inside, or 'CONTESTED' if multiple factions are present.
    function getCapturingFaction(node) {
        const CR2 = CONFIG.CAPTURE_RADIUS * CONFIG.CAPTURE_RADIUS;
        const factions = new Set();

        // Check player — always counts if inside
        const pdx = GAME.player.mesh.position.x - node.x;
        const pdz = GAME.player.mesh.position.z - node.z;
        if (pdx*pdx + pdz*pdz < CR2 && GAME.player.faction !== node.owner) {
            factions.add(GAME.player.faction);
        }

        // Only count AI ships that are actively targeting THIS node
        // Ships just passing through don't contest
        GAME.aiShips.forEach(ai => {
            if (ai.faction === node.owner) return;
            if (ai.task !== 'CAPTURE' || ai.targetNode !== node) return;
            const dx = ai.mesh.position.x - node.x, dz = ai.mesh.position.z - node.z;
            if (dx*dx + dz*dz < CR2) factions.add(ai.faction);
        });

        if (factions.size === 0)  return null;
        if (factions.size === 1)  return [...factions][0];
        return 'CONTESTED';
    }

    // Returns the nearest owned node to a position, or null
    function nearestOwnedNode(x, z, factionId) {
        let best = null, bestDist = Infinity;
        GAME.territory.forEach(n => {
            if (n.owner !== factionId) return;
            const dx = x-n.x, dz = z-n.z;
            const d = dx*dx + dz*dz;
            if (d < bestDist) { bestDist = d; best = n; }
        });
        return best && bestDist < CONFIG.CAPTURE_RADIUS*CONFIG.CAPTURE_RADIUS ? best : null;
    }

    return { generate, update, getMouseWorldPos, setNodeColor, damageResource,
             hasEnemyStructures, hasFriendlyShip, getCapturingFaction, nearestOwnedNode,
             addNodeAt, addResourceAt };
})();
