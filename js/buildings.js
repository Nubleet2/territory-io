'use strict';

const Buildings = (() => {

    function build(type, x, z, factionId) {
        const def = BLDG[type];
        if (!def) return false;
        const node = World.nearestOwnedNode(x, z, factionId);
        if (!node) { UI.showMsg('Must build within a controlled node!', 'err'); return false; }

        // Check building limits for this node
        const CR = CONFIG.CAPTURE_RADIUS;
        const nodeBldgs = GAME.buildings.filter(b => {
            const dx=b.x-node.x, dz=b.z-node.z;
            return dx*dx+dz*dz < CR*CR;
        });
        if (nodeBldgs.length >= CONFIG.MAX_BLDG_PER_NODE) {
            UI.showMsg('Building limit reached at this node! (max '+CONFIG.MAX_BLDG_PER_NODE+')', 'err');
            return false;
        }
        // Only 1 CMD center per node
        if (type === 'COMMAND_CENTER' && nodeBldgs.some(b => b.type === 'COMMAND_CENTER')) {
            UI.showMsg('Only 1 Command Center per node!', 'err');
            return false;
        }

        const NEEDS_CMD = ['AUTO_MINER', 'SHIELD_GEN', 'REPAIR_BCN'];
        if (NEEDS_CMD.includes(type) && !_hasCommandCenter(node, factionId)) {
            UI.showMsg('Build a Command Center at this node first!', 'err');
            return false;
        }

        // Engineer class discount
        const cls = SHIP_CLASSES[GAME.player.shipClass];
        const discount = (cls && cls.buildDiscount) ? cls.buildDiscount : 1;
        const cost = Math.floor(def.cost * discount);

        if (GAME.player.resources < cost) { UI.showMsg('Not enough resources!', 'err'); return false; }
        GAME.player.resources -= cost;
        const mesh = _buildMesh(type, x, z, factionId);
        GAME.scene.add(mesh);
        GAME.buildings.push({ type, faction:factionId, x, z, hp:def.hp, maxHp:def.hp, mesh, timer:0 });
        UI.showMsg(def.name + ' constructed', 'ok');
        Audio.play('build', x, z);
        STATS.buildingsBuilt++;
        XP.award('build');
        return true;
    }

    function _hasCommandCenter(node, factionId) {
        return GAME.buildings.some(b => {
            if (b.type !== 'COMMAND_CENTER' || b.faction !== factionId) return false;
            const dx = b.x - node.x, dz = b.z - node.z;
            return dx*dx + dz*dz < CONFIG.CAPTURE_RADIUS * CONFIG.CAPTURE_RADIUS;
        });
    }

    function _m(geo, mat) { return new THREE.Mesh(geo, mat); }

    function _buildMesh(type, x, z, factionId) {
        const group = new THREE.Group();
        group.position.set(x, 0, z);
        const col  = FACTIONS[factionId].color;

        // Shared factory functions — clean materials, no z-fighting
        const mHull = () => new THREE.MeshStandardMaterial({ color:0x1a1a28, roughness:0.62, metalness:0.92 });
        const mAcc  = () => new THREE.MeshStandardMaterial({ color:col, emissive:col, emissiveIntensity:0.58, roughness:0.25, metalness:0.88 });
        const mGlow = () => new THREE.MeshStandardMaterial({ color:col, emissive:col, emissiveIntensity:2.4 });
        const mDark = () => new THREE.MeshStandardMaterial({ color:0x101018, roughness:0.78, metalness:0.88 });
        const mGlass= () => new THREE.MeshStandardMaterial({ color:0x224466, emissive:0x0a1122, emissiveIntensity:0.8, roughness:0, transparent:true, opacity:0.75 });

        switch (type) {

            case 'COMMAND_CENTER': {
                // Smooth lathe-profile tower — no intersecting cylinders
                const prof = [
                    new THREE.Vector2(0,   0),
                    new THREE.Vector2(42,  0),
                    new THREE.Vector2(42,  4),
                    new THREE.Vector2(38,  6),   // base ledge
                    new THREE.Vector2(38, 14),
                    new THREE.Vector2(28, 18),   // taper
                    new THREE.Vector2(26, 36),
                    new THREE.Vector2(30, 38),   // top collar
                    new THREE.Vector2(30, 42),
                    new THREE.Vector2(14, 46),   // top
                    new THREE.Vector2(14, 52),
                    new THREE.Vector2(4,  54),
                    new THREE.Vector2(0,  54),
                ];
                const tGeo = new THREE.LatheGeometry(prof, 10);
                const tower = _m(tGeo, mHull());
                group.add(tower);

                // Faction accent band
                const band = _m(new THREE.CylinderGeometry(30.5,30.5,4,10), mAcc());
                band.position.y = 40;
                group.add(band);

                // Antenna
                const ant = _m(new THREE.CylinderGeometry(1.2,1.2,36,8), mGlow());
                ant.position.y = 72;
                group.add(ant);

                // Dish
                const dGeo = new THREE.CylinderGeometry(0,12,5,12,1,true);
                const dish = _m(dGeo, mAcc());
                dish.position.y = 92;
                group.add(dish);
                break;
            }

            case 'AUTO_MINER': {
                // Smooth lathe body + two rotating arm cylinders + drill
                const bProf = [
                    new THREE.Vector2(0,  0),
                    new THREE.Vector2(20, 0),
                    new THREE.Vector2(22, 2),
                    new THREE.Vector2(22, 14),
                    new THREE.Vector2(16, 18),
                    new THREE.Vector2(14, 22),
                    new THREE.Vector2(0,  22),
                ];
                const body = _m(new THREE.LatheGeometry(bProf, 10), mHull());
                group.add(body);

                // Accent top ring
                const top = _m(new THREE.CylinderGeometry(14.5,14.5,3,10), mAcc());
                top.position.y = 20;
                group.add(top);

                // Arms — horizontal cylinders extending from body
                for (const s of [-1, 1]) {
                    const arm = _m(new THREE.CylinderGeometry(2.5,2.5,28,8), mDark());
                    arm.rotation.z = Math.PI/2;
                    arm.position.set(s*16, 14, 6);
                    arm.userData.isArm = true;
                    group.add(arm);
                    // Drill bit — cone
                    const dGeo = new THREE.ConeGeometry(3.5,12,8);
                    dGeo.rotateX(-Math.PI/2);
                    const drill = _m(dGeo, mGlow());
                    drill.position.set(s*28, 14, 6);
                    group.add(drill);
                }
                break;
            }

            case 'TURRET': {
                // Smooth base + smooth turret dome + barrel
                const baseProf = [
                    new THREE.Vector2(0,   0),
                    new THREE.Vector2(24,  0),
                    new THREE.Vector2(26,  2),
                    new THREE.Vector2(26,  8),
                    new THREE.Vector2(22, 12),
                    new THREE.Vector2(18, 14),
                    new THREE.Vector2(0,  14),
                ];
                const base = _m(new THREE.LatheGeometry(baseProf, 12), mHull());
                group.add(base);

                // Accent ring between base and turret
                const ring = _m(new THREE.CylinderGeometry(19,19,2.5,12), mAcc());
                ring.position.y = 15.5;
                group.add(ring);

                // Turret dome — half sphere, smooth
                const domeGeo = new THREE.SphereGeometry(14,14,10,0,Math.PI*2,0,Math.PI/2);
                const dome = _m(domeGeo, mDark());
                dome.position.y = 17;
                dome.userData.isTurretHead = true;
                group.add(dome);

                // Barrel — rounded cylinder
                const barrel = _m(new THREE.CylinderGeometry(3,3.5,34,10), mDark());
                barrel.rotation.x = Math.PI/2;
                barrel.position.set(0, 22, -17);
                barrel.userData.isBarrel = true;
                group.add(barrel);

                // Muzzle glow
                const muzz = _m(new THREE.SphereGeometry(3.5,8,8), mGlow());
                muzz.position.set(0, 22, -35);
                muzz.userData.isBarrel = true;
                group.add(muzz);
                break;
            }

            case 'SHIELD_GEN': {
                // Pedestal + smooth sphere core + rings
                const pedProf = [
                    new THREE.Vector2(0,  0),
                    new THREE.Vector2(18, 0),
                    new THREE.Vector2(20, 2),
                    new THREE.Vector2(14, 16),
                    new THREE.Vector2(8,  20),
                    new THREE.Vector2(0,  20),
                ];
                const ped = _m(new THREE.LatheGeometry(pedProf, 12), mHull());
                group.add(ped);

                // Core sphere — smooth
                const core = _m(new THREE.SphereGeometry(12, 18, 18), mAcc());
                core.position.y = 32;
                group.add(core);

                // Orbiting rings
                const r1 = _m(new THREE.TorusGeometry(18, 2.2, 10, 30), mGlow());
                r1.position.y = 32;
                const r2 = r1.clone();
                r2.rotation.y = Math.PI/2;
                group.add(r1, r2);

                // Faint shield bubble
                const bubble = _m(
                    new THREE.SphereGeometry(BLDG.SHIELD_GEN.range*0.34, 18, 18),
                    new THREE.MeshBasicMaterial({ color:col, transparent:true, opacity:0.04,
                        side:THREE.DoubleSide, depthWrite:false })
                );
                bubble.position.y = 32;
                bubble.userData.isBubble = true;
                group.add(bubble);
                break;
            }

            case 'REPAIR_BCN': {
                // Rounded base + slim pole + glowing sphere top
                const baseProf = [
                    new THREE.Vector2(0,  0),
                    new THREE.Vector2(12, 0),
                    new THREE.Vector2(13, 1),
                    new THREE.Vector2(13, 9),
                    new THREE.Vector2(4,  12),
                    new THREE.Vector2(0,  12),
                ];
                const base = _m(new THREE.LatheGeometry(baseProf, 12), mHull());
                group.add(base);

                // Pole
                const pole = _m(new THREE.CylinderGeometry(2.2,2.8,44,10), mDark());
                pole.position.y = 34;
                group.add(pole);

                // Medical cross halo (two flat rings)
                const h1 = _m(new THREE.TorusGeometry(15,1.6,8,28), mAcc());
                h1.position.y = 60;
                const h2 = h1.clone();
                h2.rotation.y = Math.PI/2;
                group.add(h1, h2);

                // Orb
                const orb = _m(new THREE.SphereGeometry(11,16,16), mGlow());
                orb.position.y = 60;
                orb.userData.isOrb = true;
                group.add(orb);

                // Outer glow sphere (very faint)
                const glo = _m(new THREE.SphereGeometry(17,12,12),
                    new THREE.MeshBasicMaterial({ color:col, transparent:true, opacity:0.07,
                        side:THREE.DoubleSide, depthWrite:false }));
                glo.position.y = 60;
                glo.userData.isOrb = true;
                group.add(glo);
                break;
            }
        }

        return group;
    }

    // ── GHOST PREVIEW ─────────────────────────────────────────────────────────
    function createGhost(type, factionId) {
        const mesh = _buildMesh(type, 0, 0, factionId);
        mesh.traverse(c => {
            if (!c.isMesh) return;
            const m = c.material.clone();
            m.transparent = true;
            m.opacity     = 0.35;
            m.depthWrite  = false;
            c.material    = m;
        });
        GAME.scene.add(mesh);
        return mesh;
    }
    function removeGhost(mesh) { if (mesh) GAME.scene.remove(mesh); }

    // ── UPDATE ────────────────────────────────────────────────────────────────
    function update(dt) {
        const t = performance.now() * 0.001;
        for (let i = 0; i < GAME.buildings.length; i++) {
            const b = GAME.buildings[i];
            b.timer += dt;
            switch (b.type) {
                case 'AUTO_MINER': _updateMiner(b, dt, t);  break;
                case 'TURRET':     _updateTurret(b, dt, t); break;
                case 'REPAIR_BCN': _updateRepair(b, dt, t); break;
                case 'SHIELD_GEN': _updateShield(b, dt, t); break;
            }
        }
    }

    function _updateMiner(b, dt, t) {
        if (b.timer >= CONFIG.MINE_TICK) {
            b.timer = 0;
            if (b.faction === GAME.player.faction) GAME.player.resources += CONFIG.MINE_AMOUNT;
        }
        b.mesh.traverse(c => {
            if (c.userData.isArm) c.rotation.z = Math.sign(c.position.x) * Math.abs(Math.sin(t*1.8)*0.4);
        });
    }

    function _updateTurret(b, dt, t) {
        if (b.timer < BLDG.TURRET.fireRate) return;
        let target = null, nearDist = BLDG.TURRET.range * BLDG.TURRET.range;
        if (b.faction === GAME.player.faction) {
            GAME.aiShips.forEach(ai => {
                if (ai.faction === b.faction) return;
                const dx=ai.mesh.position.x-b.x, dz=ai.mesh.position.z-b.z, d=dx*dx+dz*dz;
                if (d<nearDist){nearDist=d; target={x:ai.mesh.position.x,z:ai.mesh.position.z};}
            });
        } else {
            const dx=GAME.player.mesh.position.x-b.x, dz=GAME.player.mesh.position.z-b.z;
            if (dx*dx+dz*dz<nearDist) target={x:GAME.player.mesh.position.x,z:GAME.player.mesh.position.z};
            GAME.aiShips.forEach(ai => {
                if (ai.faction===b.faction) return;
                const dx2=ai.mesh.position.x-b.x,dz2=ai.mesh.position.z-b.z,d=dx2*dx2+dz2*dz2;
                if (d<nearDist){nearDist=d;target={x:ai.mesh.position.x,z:ai.mesh.position.z};}
            });
        }
        if (!target) return;
        b.timer = 0;
        const angle = Math.atan2(-(target.x-b.x), -(target.z-b.z));
        b.mesh.traverse(c => { if (c.userData.isBarrel || c.userData.isTurretHead) c.parent.rotation.y = angle; });
        Combat.spawnProjectile(b.x, b.z, angle, b.faction);
    }

    function _updateRepair(b, dt, t) {
        b.mesh.traverse(c => { if (c.userData.isOrb) c.position.y = 60 + Math.sin(t*2.2)*7; });
        const R2 = BLDG.REPAIR_BCN.range * BLDG.REPAIR_BCN.range;

        // Heal player
        if (b.faction === GAME.player.faction) {
            const dx=GAME.player.mesh.position.x-b.x, dz=GAME.player.mesh.position.z-b.z;
            if (dx*dx+dz*dz < R2) {
                if (GAME.player.hp < GAME.player.maxHp) Audio.play('heal', b.x, b.z);
                GAME.player.hp     = Math.min(GAME.player.maxHp,    GAME.player.hp+dt*6);
                GAME.player.shield = Math.min(GAME.player.maxShield, GAME.player.shield+dt*10);
            }
        }

        // Heal friendly AI ships
        GAME.aiShips.forEach(ai => {
            if (ai.faction !== b.faction) return;
            const dx=ai.mesh.position.x-b.x, dz=ai.mesh.position.z-b.z;
            if (dx*dx+dz*dz < R2) {
                ai.hp     = Math.min(ai.maxHp,     ai.hp+dt*4);
                ai.shield = Math.min(ai.maxShield,  (ai.shield||0)+dt*8);
            }
        });

        // Repair nearby friendly buildings (slower rate)
        GAME.buildings.forEach(bldg => {
            if (bldg === b || bldg.faction !== b.faction) return;
            const dx=bldg.x-b.x, dz=bldg.z-b.z;
            if (dx*dx+dz*dz < R2) {
                bldg.hp = Math.min(bldg.maxHp, bldg.hp + dt*2);
            }
        });
    }

    function _updateShield(b, dt, t) {
        const s = 1+Math.sin(t*1.4)*0.05;
        b.mesh.traverse(c => { if (c.userData.isBubble) c.scale.setScalar(s); });
    }

    function destroy(idx) {
        if (idx<0||idx>=GAME.buildings.length) return;
        GAME.scene.remove(GAME.buildings[idx].mesh);
        GAME.buildings.splice(idx,1);
    }

    return { build, update, destroy, createGhost, removeGhost, _createMeshPublic:_buildMesh };
})();
