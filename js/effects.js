'use strict';

const Effects = (() => {
    const _active = [];
    const _pool   = [];
    const POOL_SIZE = 300;

    function init() {
        const geo = new THREE.SphereGeometry(1, 4, 4);
        for (let i = 0; i < POOL_SIZE; i++) {
            const mesh = new THREE.Mesh(geo,
                new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, depthWrite:false }));
            mesh.visible = false;
            GAME.scene.add(mesh);
            _pool.push(mesh);
        }
    }

    function _spawn(x, z, color, scale, vx, vy, vz, life) {
        const mesh = _pool.pop();
        if (!mesh) return;
        mesh.material = mesh.material.clone();
        mesh.material.color.setHex(color);
        mesh.material.opacity = 1;
        mesh.scale.setScalar(scale);
        mesh.position.set(x, 10, z);
        mesh.visible = true;
        _active.push({ mesh, vx, vy, vz, life, maxLife:life });
    }

    function spawnExplosion(x, z, color, big) {
        const count = big ? 18 : 10;
        const spd   = big ? 280 : 180;
        const sc    = big ? 5   : 3;
        for (let i = 0; i < count; i++) {
            const a  = Math.random()*Math.PI*2;
            const el = (Math.random()-0.5)*Math.PI;
            const s  = spd*(0.4+Math.random()*0.8);
            _spawn(x, z, color, sc*(0.4+Math.random()*0.8),
                Math.cos(a)*Math.cos(el)*s,
                Math.abs(Math.sin(el))*s*0.6,
                Math.sin(a)*Math.cos(el)*s,
                0.5+Math.random()*0.4);
        }
        // Central flash — larger, shorter
        _spawn(x, z, 0xffffff, big?14:8, 0,0,0, 0.12);
        _spawn(x, z, color,    big?10:6, 0,0,0, 0.2);
    }

    function spawnMiningHit(x, z) {
        for (let i = 0; i < 6; i++) {
            const a = Math.random()*Math.PI*2;
            const s = 80+Math.random()*120;
            _spawn(x+(Math.random()-0.5)*20, z+(Math.random()-0.5)*20,
                0x00eeff, 1.5+Math.random()*2,
                Math.cos(a)*s, 40+Math.random()*60, Math.sin(a)*s,
                0.3+Math.random()*0.3);
        }
    }

    function spawnCapture(x, z, color) {
        for (let i = 0; i < 24; i++) {
            const a = (i/24)*Math.PI*2;
            const r = 50+Math.random()*180;
            _spawn(x+Math.cos(a)*10, z+Math.sin(a)*10, color, 2+Math.random()*3,
                Math.cos(a)*r, 60+Math.random()*80, Math.sin(a)*r,
                0.6+Math.random()*0.4);
        }
    }

    // AOE expanding ring flash — used by bomb detonation
    const _aoeRings = [];
    function spawnAOEFlash(x, z, radius, color) {
        // Create a flat torus ring that expands outward then fades
        const mat = new THREE.MeshBasicMaterial({
            color, transparent:true, opacity:0.85,
            side:THREE.DoubleSide, depthWrite:false,
            blending:THREE.AdditiveBlending
        });
        // Inner ring
        const geo  = new THREE.RingGeometry(0, radius * 0.1, 40);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI/2;
        mesh.position.set(x, 4, z);
        GAME.scene.add(mesh);
        _aoeRings.push({ mesh, mat, maxR:radius, life:0.55, maxLife:0.55 });

        // Also spawn a big particle burst
        spawnExplosion(x, z, color, true);
        for (let i = 0; i < 32; i++) {
            const a = (i/32)*Math.PI*2;
            _spawn(x+Math.cos(a)*radius*0.8, z+Math.sin(a)*radius*0.8,
                color, 3+Math.random()*4,
                Math.cos(a)*60, 30+Math.random()*60, Math.sin(a)*60, 0.5+Math.random()*0.3);
        }
    }

    function _updateAOERings(dt) {
        for (let i = _aoeRings.length-1; i >= 0; i--) {
            const r = _aoeRings[i];
            r.life -= dt;
            if (r.life <= 0) {
                GAME.scene.remove(r.mesh);
                _aoeRings.splice(i, 1);
                continue;
            }
            const t = 1 - r.life/r.maxLife; // 0→1 as ring expands
            const currentR = r.maxR * t;
            const thickness = r.maxR * 0.08 * (1-t*0.5);
            // Recreate geometry each frame to resize (rings can't be scaled non-uniformly)
            r.mesh.geometry.dispose();
            r.mesh.geometry = new THREE.RingGeometry(
                Math.max(0, currentR - thickness), currentR + thickness, 40
            );
            r.mat.opacity = (1-t) * 0.8;
        }
    }

    function update(dt) {
        _updateAOERings(dt);
        for (let i = _active.length-1; i >= 0; i--) {
            const p = _active[i];
            p.life -= dt;
            if (p.life <= 0) {
                p.mesh.visible = false;
                _pool.push(p.mesh);
                _active.splice(i, 1);
                continue;
            }
            const t = p.life / p.maxLife;
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.y += p.vy * dt;
            p.mesh.position.z += p.vz * dt;
            p.vy -= 160 * dt;
            p.mesh.material.opacity = t * t;
            p.mesh.scale.setScalar(p.mesh.scale.x * (0.96 + t*0.06));
        }
    }

    return { init, update, spawnExplosion, spawnMiningHit, spawnCapture, spawnAOEFlash };
})();
