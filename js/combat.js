'use strict';

const Combat = (() => {
    const _geoCache = {};
    const _matCache = {};
    // Per-geometry-type pools — NEVER reassign .geometry (read-only in Three.js r128)
    const _pools    = {};
    const MAX_PROJ  = 200;

    function _getGeo(wep) {
        const key = wep ? wep.geoType + JSON.stringify(wep.scale) : 'default';
        if (!_geoCache[key]) {
            if (!wep) { _geoCache[key] = new THREE.BoxGeometry(3.5,3.5,18); }
            else {
                const [w,h,d] = wep.scale;
                switch (wep.geoType) {
                    case 'orb':    _geoCache[key] = new THREE.SphereGeometry(w,8,8);   break;
                    case 'plasma': _geoCache[key] = new THREE.SphereGeometry(w,12,12); break;
                    case 'ring': {
                        const g = new THREE.TorusGeometry(w,h,6,16);
                        g.rotateX(Math.PI/2);
                        _geoCache[key] = g; break;
                    }
                    case 'bomb': {
                        // Spinning octahedron — looks like a mine
                        _geoCache[key] = new THREE.OctahedronGeometry(w*0.65, 0); break;
                    }
                    case 'hex': {
                        const g = new THREE.CylinderGeometry(w*0.55,w*0.55,d,6);
                        g.rotateX(Math.PI/2);
                        _geoCache[key] = g; break;
                    }
                    default: _geoCache[key] = new THREE.BoxGeometry(w,h,d);
                }
            }
        }
        return _geoCache[key];
    }

    function _getMat(color) {
        if (!_matCache[color]) _matCache[color] = new THREE.MeshBasicMaterial({ color });
        return _matCache[color];
    }

    function _poolKey(wep) { return wep ? wep.geoType+JSON.stringify(wep.scale) : 'default'; }

    function _getMesh(wep) {
        const key  = _poolKey(wep);
        const pool = (_pools[key] = _pools[key] || []);
        if (pool.length > 0) return pool.pop();
        const col = wep ? wep.color : 0xffffff;
        return new THREE.Mesh(_getGeo(wep), _getMat(col));
    }

    function _returnMesh(mesh, wep) {
        (_pools[_poolKey(wep)] = _pools[_poolKey(wep)] || []).push(mesh);
    }

    // ── SPAWN SINGLE PROJECTILE ───────────────────────────────────────────────
    function spawnProjectile(x, z, angle, factionId, damageMult, wep) {
        if (GAME.projectiles.length >= MAX_PROJ) {
            const old = GAME.projectiles.shift();
            GAME.scene.remove(old.mesh);
            if (old.groundRing) GAME.scene.remove(old.groundRing);
            _returnMesh(old.mesh, old.wep);
        }
        const mesh = _getMesh(wep);
        mesh.position.set(x, 7, z);
        mesh.rotation.y = angle;
        GAME.scene.add(mesh);

        // For AOE bombs — show a pulsing ground ring indicating impact radius
        let groundRing = null;

        GAME.projectiles.push({
            mesh, wep, groundRing,
            dx: -Math.sin(angle), dz: -Math.cos(angle),
            faction:   factionId,
            life:      CONFIG.PROJ_LIFE,
            speed:     wep ? (wep.projSpeed || CONFIG.PROJ_SPEED) : CONFIG.PROJ_SPEED,
            damage:    CONFIG.PROJ_DAMAGE * (damageMult||1) * (wep ? (wep.damageMult||1) : 1),
            hitRadius: wep ? (wep.hitRadius || 1800) : 1800,
        });
    }

    // ── FIRE WEAPON — handles burst/spread/multi-shot ─────────────────────────
    function fireWeapon(x, z, angle, factionId, damageMult, shipClass) {
        const cls = SHIP_CLASSES[shipClass];
        const wep = cls ? cls.weapon : null;
        if (!wep) { spawnProjectile(x, z, angle, factionId, damageMult, null); return; }

        const shots   = wep.shots || 1;
        const perpX   = Math.cos(angle), perpZ = -Math.sin(angle);
        const offsets = shots === 1 ? [0] : shots === 2 ? [-10,10] : [-12,0,12];

        if (wep.delay && wep.delay > 0 && shots > 1) {
            // Burst fire (Fighter)
            for (let i = 0; i < shots; i++) {
                const spread = (i-(shots-1)/2) * wep.spread;
                setTimeout(() => {
                    if (!GAME.running) return;
                    spawnProjectile(x, z, angle+spread, factionId, damageMult, wep);
                }, i * wep.delay * 1000);
            }
        } else {
            offsets.forEach((off, i) => {
                const spread = (i-(offsets.length-1)/2) * wep.spread;
                spawnProjectile(
                    x + perpX*off, z + perpZ*off,
                    angle+spread, factionId, damageMult, wep
                );
            });
        }
    }

    // ── UPDATE ────────────────────────────────────────────────────────────────
    function update(dt) {
        for (let i = GAME.projectiles.length-1; i >= 0; i--) {
            const p = GAME.projectiles[i];
            p.life -= dt;
            if (p.life <= 0) { _kill(i); continue; }
            p.mesh.position.x += p.dx * p.speed * dt;
            p.mesh.position.z += p.dz * p.speed * dt;
            // Spin ring projectiles as they travel
            if (p.wep && p.wep.geoType === 'ring') p.mesh.rotation.y += dt * 6;
            if (p.wep && p.wep.geoType === 'bomb') {
                p.mesh.rotation.y += dt * 3;
                p.mesh.rotation.x += dt * 2;
            }
            if (_checkAIHits(p, i))       continue;
            if (_checkBuildingHits(p, i))  continue;
            if (_checkResourceHits(p, i))  continue;
            if (_checkPlayerHit(p, i))     continue;
        }
    }

    // AOE bomb detonation — damages all enemies in radius at impact point
    function _detonateBomb(p, idx) {
        const bx = p.mesh.position.x, bz = p.mesh.position.z;
        const r2 = p.wep.aoeRadius * p.wep.aoeRadius;
        Effects.spawnAOEFlash(bx, bz, p.wep.aoeRadius, p.wep.color || 0xcc44ff);
        Audio.play('bomb_detonate', bx, bz);
        // Damage all enemy AI ships in radius
        for (let j = GAME.aiShips.length-1; j >= 0; j--) {
            const ai = GAME.aiShips[j];
            if (ai.faction === p.faction) continue;
            const dx=bx-ai.mesh.position.x, dz=bz-ai.mesh.position.z;
            if (dx*dx+dz*dz < r2) {
                const _dmg = p.damage;
                if (ai.shield > 0) {
                    const _abs = Math.min(ai.shield, _dmg);
                    ai.shield -= _abs;
                    const _rem = _dmg - _abs;
                    if (_rem > 0) ai.hp -= _rem;
                } else { ai.hp -= _dmg; }
                if (ai.hp <= 0) {
                    if (p.faction === GAME.player.faction) { XP.award('kill'); STATS.kills++; }
                    Effects.spawnExplosion(ai.mesh.position.x, ai.mesh.position.z, FACTIONS[ai.faction].color, false);
                    AI.killShip(j);
                }
            }
        }
        // Damage all enemy buildings in radius
        for (let j = GAME.buildings.length-1; j >= 0; j--) {
            const b = GAME.buildings[j];
            if (b.faction === p.faction) continue;
            const dx=bx-b.x, dz=bz-b.z;
            if (dx*dx+dz*dz < r2) {
                b.hp -= p.damage;
                if (b.hp <= 0) {
                    if (p.faction === GAME.player.faction) XP.award('buildingDestroy');
                    Effects.spawnExplosion(b.x, b.z, FACTIONS[b.faction].color, true);
                    Buildings.destroy(j);
                }
            }
        }
        // Damage player if in radius and different faction
        if (p.faction !== GAME.player.faction) {
            const dx=bx-GAME.player.mesh.position.x, dz=bz-GAME.player.mesh.position.z;
            if (dx*dx+dz*dz < r2) {
                const dmg = p.damage;
                if (GAME.player.shield > 0) {
                    const absorbed = Math.min(GAME.player.shield, dmg);
                    GAME.player.shield -= absorbed;
                    const remainder = dmg - absorbed;
                    if (remainder > 0) GAME.player.hp = Math.max(0, GAME.player.hp - remainder);
                } else {
                    GAME.player.hp = Math.max(0, GAME.player.hp - dmg);
                }
                UI.flashHit();
                Audio.play('hit');
            }
        }
        // Damage resource rocks in radius
        for (let j = GAME.resources.length-1; j >= 0; j--) {
            const r = GAME.resources[j];
            if (!r.active) continue;
            const dx=bx-r.x, dz=bz-r.z;
            if (dx*dx+dz*dz < r2) {
                Effects.spawnMiningHit(r.x, r.z);
                World.damageResource(j, p.damage, p.faction);
                if (p.faction === GAME.player.faction) STATS.resourcesMined += p.damage;
            }
        }
        _killRaw(idx);
    }

    // Kill without triggering AOE flash (used by detonateBomb which handles its own flash)
    function _killRaw(idx) {
        if (idx < 0 || idx >= GAME.projectiles.length) return;
        const p = GAME.projectiles[idx];
        GAME.scene.remove(p.mesh);
        if (p.groundRing) GAME.scene.remove(p.groundRing);
        _returnMesh(p.mesh, p.wep);
        GAME.projectiles.splice(idx, 1);
    }

    function _checkAIHits(p, idx) {
        for (let j = GAME.aiShips.length-1; j >= 0; j--) {
            const ai = GAME.aiShips[j];
            if (ai.faction === p.faction) continue;
            const dx=p.mesh.position.x-ai.mesh.position.x, dz=p.mesh.position.z-ai.mesh.position.z;
            if (dx*dx+dz*dz < p.hitRadius) {
                if (p.wep && p.wep.aoe) { _detonateBomb(p, idx); return true; }
                const _dmg = p.damage;
                if (ai.shield > 0) {
                    const _abs = Math.min(ai.shield, _dmg);
                    ai.shield -= _abs;
                    const _rem = _dmg - _abs;
                    if (_rem > 0) ai.hp -= _rem;
                } else { ai.hp -= _dmg; }
                _kill(idx);
                if (ai.hp <= 0) {
                    if (p.faction === GAME.player.faction) { XP.award('kill'); STATS.kills++; }
                    Effects.spawnExplosion(ai.mesh.position.x, ai.mesh.position.z, FACTIONS[ai.faction].color, false);
                    Audio.play('explode', ai.mesh.position.x, ai.mesh.position.z);
                    AI.killShip(j);
                }
                return true;
            }
        }
        return false;
    }

    function _checkBuildingHits(p, idx) {
        for (let j = GAME.buildings.length-1; j >= 0; j--) {
            const b = GAME.buildings[j];
            if (b.faction === p.faction) continue;
            const dx=p.mesh.position.x-b.x, dz=p.mesh.position.z-b.z;
            if (dx*dx+dz*dz < Math.max(p.hitRadius, 4000)) {
                if (p.wep && p.wep.aoe) { _detonateBomb(p, idx); return true; }
                b.hp -= p.damage;
                _kill(idx);
                if (b.hp <= 0) {
                    if (p.faction === GAME.player.faction) XP.award('buildingDestroy');
                    Effects.spawnExplosion(b.x, b.z, FACTIONS[b.faction].color, true);
                    Audio.play('building_destroy', b.x, b.z);
                    Buildings.destroy(j);
                }
                return true;
            }
        }
        return false;
    }

    function _checkResourceHits(p, idx) {
        for (let j = GAME.resources.length-1; j >= 0; j--) {
            const r = GAME.resources[j];
            if (!r.active) continue;
            const dx=p.mesh.position.x-r.x, dz=p.mesh.position.z-r.z;
            if (dx*dx+dz*dz < 3200) {
                _kill(idx);
                Effects.spawnMiningHit(r.x, r.z);
                Audio.play('mine', r.x, r.z);
                World.damageResource(j, p.damage, p.faction);
                if (p.faction === GAME.player.faction) STATS.resourcesMined += p.damage;
                return true;
            }
        }
        return false;
    }

    function _checkPlayerHit(p, idx) {
        if (p.faction === GAME.player.faction) return false;
        const m=GAME.player.mesh;
        const dx=p.mesh.position.x-m.position.x, dz=p.mesh.position.z-m.position.z;
        if (dx*dx+dz*dz < Math.max(p.hitRadius, 1800)) {
            const dmg = p.damage;
            if (GAME.player.shield > 0) {
                const absorbed = Math.min(GAME.player.shield, dmg);
                GAME.player.shield -= absorbed;
                const remainder = dmg - absorbed;
                if (remainder > 0) GAME.player.hp = Math.max(0, GAME.player.hp - remainder);
            } else {
                GAME.player.hp = Math.max(0, GAME.player.hp - dmg);
            }
            _kill(idx);
            UI.flashHit();
            Audio.play('hit');
            return true;
        }
        return false;
    }

    function _kill(idx) {
        if (idx < 0 || idx >= GAME.projectiles.length) return;
        const p = GAME.projectiles[idx];
        // Bomb always detonates — even on natural expiry
        if (p.wep && p.wep.aoe) {
            _detonateBomb(p, idx);
            return; // _detonateBomb calls _killRaw
        }
        GAME.scene.remove(p.mesh);
        if (p.groundRing) GAME.scene.remove(p.groundRing);
        _returnMesh(p.mesh, p.wep);
        GAME.projectiles.splice(idx, 1);
    }

    return { spawnProjectile, fireWeapon, update };
})();
