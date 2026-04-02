'use strict';

const Player = (() => {
    let _fireCooldown = 0;
    let _engineGlows  = [];

    function create() {
        const fac = FACTIONS[GAME.player.faction];
        const cls = GAME.player.shipClass || 'ASSAULT';

        // Apply ship class stats
        const sc = SHIP_CLASSES[cls];
        GAME.player.maxHp     = Math.round(CONFIG.SHIP_HP * playerStat('hull'));
        GAME.player.hp        = GAME.player.maxHp;
        GAME.player.maxShield = Math.round(CONFIG.SHIP_HP * 0.5 * playerStat('shield'));
        GAME.player.shield    = GAME.player.maxShield;
        GAME.player.statDamage   = playerStat('damage');
        GAME.player.statFireRate = playerStat('fireRate');
        GAME.player.statSpeed    = playerStat('speed');
        GAME.player.statShield   = playerStat('shield');

        const mesh = Render.createShipMesh(GAME.player.faction, cls);
        mesh.position.set(fac.sx, 8, fac.sz);
        GAME.scene.add(mesh);
        GAME.player.mesh = mesh;
        GAME.player.vx = 0;
        GAME.player.vz = 0;

        _engineGlows = [];
        mesh.traverse(c => { if (c.isMesh && c.userData.isEngine) _engineGlows.push(c); });

        const light = new THREE.PointLight(fac.color, 1.6, 260);
        light.position.y = 5;
        mesh.add(light);
    }

    function refreshStats() {
        GAME.player.maxHp        = Math.round(CONFIG.SHIP_HP * playerStat('hull'));
        GAME.player.hp           = Math.min(GAME.player.hp, GAME.player.maxHp);
        GAME.player.maxShield    = Math.round(CONFIG.SHIP_HP * 0.5 * playerStat('shield'));
        GAME.player.shield       = Math.min(GAME.player.shield, GAME.player.maxShield);
        GAME.player.statDamage   = playerStat('damage');
        GAME.player.statFireRate = playerStat('fireRate');
        GAME.player.statSpeed    = playerStat('speed');
        GAME.player.statShield   = playerStat('shield');
    }

    function update(dt) {
        _fireCooldown -= dt;
        _updateAim();
        _handleMovement(dt);
        _updateCamera();
        // Shield slow regen (faster when not recently hit)
        if (GAME.player.shield < GAME.player.maxShield) {
            GAME.player.shield = Math.min(GAME.player.maxShield, GAME.player.shield + dt*3);
        }
        if (GAME.keys['MouseLeft'] && !GAME.buildMode) tryShoot();
    }

    function _updateAim() {
        const mouseWorld = World.getMouseWorldPos();
        if (!mouseWorld) return;
        const mesh   = GAME.player.mesh;
        const dx     = mouseWorld.x - mesh.position.x;
        const dz     = mouseWorld.z - mesh.position.z;
        const target = Math.atan2(-dx, -dz);
        let delta    = target - mesh.rotation.y;
        while (delta >  Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        mesh.rotation.y += delta * CONFIG.SHIP_TURN_SPEED * 8;
        GAME.player.angle = mesh.rotation.y;
    }

    function _handleMovement(dt) {
        const k   = GAME.keys;
        const a   = GAME.player.mesh.rotation.y;
        const spd = CONFIG.SHIP_MAX_SPEED * GAME.player.statSpeed;
        const thr = CONFIG.SHIP_THRUST * dt;

        let thrusting = false;
        if (k['KeyW']||k['ArrowUp'])    { GAME.player.vx-=Math.sin(a)*thr; GAME.player.vz-=Math.cos(a)*thr; thrusting=true; }
        if (k['KeyS']||k['ArrowDown'])  { GAME.player.vx+=Math.sin(a)*thr; GAME.player.vz+=Math.cos(a)*thr; thrusting=true; }
        if (k['KeyA']||k['ArrowLeft'])  { GAME.player.vx-=Math.cos(a)*thr; GAME.player.vz+=Math.sin(a)*thr; thrusting=true; }
        if (k['KeyD']||k['ArrowRight']) { GAME.player.vx+=Math.cos(a)*thr; GAME.player.vz-=Math.sin(a)*thr; thrusting=true; }

        const drag = Math.pow(1 - CONFIG.SHIP_DRAG * dt, 1);
        GAME.player.vx *= drag;
        GAME.player.vz *= drag;

        const sp = Math.sqrt(GAME.player.vx*GAME.player.vx + GAME.player.vz*GAME.player.vz);
        if (sp > spd) { GAME.player.vx=(GAME.player.vx/sp)*spd; GAME.player.vz=(GAME.player.vz/sp)*spd; }

        Audio.setThrusterVolume(sp, spd);

        const mesh = GAME.player.mesh;
        mesh.position.x += GAME.player.vx * dt;
        mesh.position.z += GAME.player.vz * dt;

        const half = CONFIG.MAP_SIZE/2-100;
        if (mesh.position.x < -half) { mesh.position.x=-half; GAME.player.vx=Math.abs(GAME.player.vx)*0.3; }
        if (mesh.position.x >  half) { mesh.position.x= half; GAME.player.vx=-Math.abs(GAME.player.vx)*0.3; }
        if (mesh.position.z < -half) { mesh.position.z=-half; GAME.player.vz=Math.abs(GAME.player.vz)*0.3; }
        if (mesh.position.z >  half) { mesh.position.z= half; GAME.player.vz=-Math.abs(GAME.player.vz)*0.3; }

        const targetGlow = thrusting ? 2.5+Math.random()*0.6 : 0.6+(sp/spd)*0.8;
        _engineGlows.forEach(e => { e.material.emissiveIntensity += (targetGlow-e.material.emissiveIntensity)*0.3; });
    }

    function _updateCamera() {
        const mesh = GAME.player.mesh;
        const tx   = mesh.position.x, tz = mesh.position.z;
        GAME.camera.position.x += (tx-GAME.camera.position.x)*0.08;
        GAME.camera.position.y  = CONFIG.CAMERA_HEIGHT;
        GAME.camera.position.z += (tz+CONFIG.CAMERA_TILT-GAME.camera.position.z)*0.08;
        GAME.camera.lookAt(tx, 0, tz);
    }

    function tryShoot() {
        const cls = SHIP_CLASSES[GAME.player.shipClass] || SHIP_CLASSES.ASSAULT;
        const wep = cls.weapon;
        // Bomb has its own fixed cooldown regardless of upgrades
        const rate = wep && wep.fireRate ? wep.fireRate : CONFIG.FIRE_RATE / GAME.player.statFireRate;
        if (_fireCooldown > 0) return;
        _fireCooldown = rate;

        const mesh  = GAME.player.mesh;
        const a     = mesh.rotation.y;
        const fwdX  = -Math.sin(a), fwdZ = -Math.cos(a);
        const noseX = mesh.position.x + fwdX * 38;
        const noseZ = mesh.position.z + fwdZ * 38;

        Combat.fireWeapon(noseX, noseZ, a, GAME.player.faction, GAME.player.statDamage, GAME.player.shipClass);
        // Per-weapon shoot sound
        const shootType = {
            FIGHTER:'shoot_fighter', ASSAULT:'shoot_assault', SCOUT:'shoot_scout',
            CARRIER:'shoot_carrier', ENGINEER:'shoot_engineer', DREADNOUGHT:'shoot_dread'
        }[GAME.player.shipClass] || 'shoot';
        Audio.play(shootType, noseX, noseZ);
    }

    return { create, update, tryShoot, refreshStats };
})();
