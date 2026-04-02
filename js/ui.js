'use strict';

const UI = (() => {
    let _msgTimer   = null;
    let _hitFlash   = 0;
    let _buildOpen  = false;
    let _ghostMesh  = null;

    // ── INIT ──────────────────────────────────────────────────────────────────
    function init() {
        GAME.minimapCtx = document.getElementById('minimap').getContext('2d');

        // Set faction badge colour
        const fac = FACTIONS[GAME.player.faction];
        document.getElementById('faction-badge').style.borderLeftColor = fac.colorHex;
        document.getElementById('badge-name').textContent = fac.name.toUpperCase();
        document.getElementById('badge-name').style.color = fac.colorHex;

        // Input
        window.addEventListener('keydown', e => {
            GAME.keys[e.code] = true;
            if (e.code === 'KeyB')  _toggleBuildMenu();
            if (e.code === 'Escape') _closeBuildMenu();
        });
        window.addEventListener('keyup', e => { delete GAME.keys[e.code]; });
        window.addEventListener('mousemove', e => {
            GAME.mouse.x = e.clientX;
            GAME.mouse.y = e.clientY;
            _updateBuildCursor(e);
        });
        window.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            // Only block clicks from inside the build menu buttons
            if (e.target.closest('#build-menu')) return;
            GAME.keys['MouseLeft'] = true;
            if (GAME.buildMode) { _placeBuild(); return; }
            Player.tryShoot();
        });
        window.addEventListener('mouseup', e => {
            if (e.button === 0) delete GAME.keys['MouseLeft'];
        });

        // Prevent right-click menu
        window.addEventListener('contextmenu', e => e.preventDefault());
    }

    // ── UPDATE ────────────────────────────────────────────────────────────────
    function update(dt) {
        document.getElementById('res-count').textContent = Math.floor(GAME.player.resources);

        const hpPct  = Math.max(0, GAME.player.hp / GAME.player.maxHp * 100);
        const hpFill = document.getElementById('hp-fill');
        hpFill.style.width      = hpPct + '%';
        hpFill.style.background = hpPct > 60 ? '#44ff66' : hpPct > 30 ? '#ffaa22' : '#ff3344';

        // Shield bar
        const shFill = document.getElementById('shield-fill');
        if (shFill) {
            const shPct = GAME.player.maxShield > 0 ? Math.max(0, GAME.player.shield/GAME.player.maxShield*100) : 0;
            shFill.style.width = shPct + '%';
        }

        // XP bar
        const xpEl = document.getElementById('xp-fill');
        if (xpEl) {
            xpEl.style.width = (GAME.player.xp / CONFIG.XP_PER_LEVEL * 100) + '%';
            const lvEl = document.getElementById('level-label');
            if (lvEl) lvEl.textContent = 'LVL ' + GAME.player.level + (GAME.player.statPoints > 0 ? ' ▲'+GAME.player.statPoints : '');
        }

        _updateTerritory();
        _drawMinimap();
        _updateNearbyNodes();
        _updateBuildingHealthBars();

        if (_hitFlash > 0) {
            _hitFlash -= dt;
            document.body.style.outline = `6px solid rgba(255,0,0,${(_hitFlash*1.8).toFixed(2)})`;
        } else {
            document.body.style.outline = '';
        }
        if (GAME.player.hp <= 0) _respawnPlayer();
    }

    function _updateTerritory() {
        const total = GAME.territory.length;
        if (!total) return;

        const counts = {};
        Object.keys(FACTIONS).forEach(f => counts[f] = 0);
        GAME.territory.forEach(n => { if (n.owner) counts[n.owner]++; });

        const cont = document.getElementById('terr-bars');
        cont.innerHTML = '';
        Object.keys(FACTIONS).forEach(f => {
            const pct = ((counts[f] / total) * 100).toFixed(0);
            const fac = FACTIONS[f];
            const isPlayer = f === GAME.player.faction;
            const div = document.createElement('div');
            div.className = 'tfbar';
            div.innerHTML = `
                <div class="tfbar-fill" style="height:${Math.max(3,pct*0.5)}px;background:${fac.colorHex};opacity:${isPlayer?1:0.65}"></div>
                <span style="color:${fac.colorHex};${isPlayer?'font-weight:bold':''}">${fac.name.split(' ')[0]}: ${pct}%</span>
            `;
            cont.appendChild(div);
        });

        // Win check — must own ALL nodes
        Object.keys(FACTIONS).forEach(f => {
            if (counts[f] === total && total > 0) _showWin(f);
        });
    }

    // ── MINIMAP ───────────────────────────────────────────────────────────────
    function _drawMinimap() {
        const ctx  = GAME.minimapCtx;
        const size = 180;
        const half = CONFIG.MAP_SIZE / 2;
        const toMM = (wx, wz) => ({
            x: (wx + half) / CONFIG.MAP_SIZE * size,
            y: (wz + half) / CONFIG.MAP_SIZE * size,
        });

        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = 'rgba(0,0,12,0.92)';
        ctx.fillRect(0, 0, size, size);

        // Faction base markers
        Object.values(FACTIONS).forEach(f => {
            const mm = toMM(f.sx, f.sz);
            ctx.strokeStyle = f.colorHex;
            ctx.lineWidth   = 1;
            ctx.strokeRect(mm.x-6, mm.y-6, 12, 12);
        });

        // Territory nodes
        GAME.territory.forEach(n => {
            const mm = toMM(n.x, n.z);
            ctx.beginPath();
            ctx.arc(mm.x, mm.y, 3.5, 0, Math.PI*2);
            ctx.fillStyle = n.owner ? FACTIONS[n.owner].colorHex : '#223355';
            ctx.fill();
        });

        // Buildings
        GAME.buildings.forEach(b => {
            const mm = toMM(b.x, b.z);
            ctx.fillStyle = FACTIONS[b.faction].colorHex;
            ctx.fillRect(mm.x-2.5, mm.y-2.5, 5, 5);
        });

        // AI ships
        GAME.aiShips.forEach(ai => {
            const mm = toMM(ai.mesh.position.x, ai.mesh.position.z);
            ctx.beginPath();
            ctx.arc(mm.x, mm.y, 2.5, 0, Math.PI*2);
            ctx.fillStyle = FACTIONS[ai.faction].colorHex;
            ctx.fill();
        });

        // Player (white dot, larger)
        const pm = toMM(GAME.player.mesh.position.x, GAME.player.mesh.position.z);
        ctx.beginPath();
        ctx.arc(pm.x, pm.y, 5, 0, Math.PI*2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Border
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth   = 1;
        ctx.strokeRect(0.5, 0.5, size-1, size-1);
    }

    // ── BUILD MENU ────────────────────────────────────────────────────────────
    function _toggleBuildMenu() {
        _buildOpen = !_buildOpen;
        document.getElementById('build-menu').style.display = _buildOpen ? 'flex' : 'none';
        if (!_buildOpen) _closeBuildMenu();
    }

    function _closeBuildMenu() {
        _buildOpen = false;
        GAME.buildMode = false;
        GAME.buildType = null;
        document.getElementById('build-menu').style.display = 'none';
        document.getElementById('build-cursor').style.display = 'none';
        // Remove ghost
        if (_ghostMesh) { Buildings.removeGhost(_ghostMesh); _ghostMesh = null; }
    }

    function buildStructure(type) {
        _closeBuildMenu();
        GAME.buildMode = true;
        GAME.buildType = type;
        const cursor = document.getElementById('build-cursor');
        cursor.style.display = 'block';
        cursor.textContent   = '▸ ' + BLDG[type].name + ' (' + BLDG[type].cost + ' res)';
        showMsg('Click within a controlled node to place · ESC to cancel', 'info');
        // Create ghost preview mesh
        _ghostMesh = Buildings.createGhost(type, GAME.player.faction);
    }

    function _placeBuild() {
        const pos = World.getMouseWorldPos();
        if (pos) {
            // Check valid zone before attempting — gives immediate visual feedback
            const validNode = World.nearestOwnedNode(pos.x, pos.z, GAME.player.faction);
            if (!validNode) {
                showMsg('Must build within a controlled node!', 'err');
                return; // don't close — let player try again
            }
            Buildings.build(GAME.buildType, pos.x, pos.z, GAME.player.faction);
        }
        _closeBuildMenu();
    }

    function _updateBuildCursor(e) {
        if (!GAME.buildMode) return;
        // Move HTML cursor label
        const cursor = document.getElementById('build-cursor');
        cursor.style.left = e.clientX + 'px';
        cursor.style.top  = e.clientY + 'px';

        // Move 3D ghost to mouse world position
        if (_ghostMesh) {
            const pos = World.getMouseWorldPos();
            if (pos) {
                _ghostMesh.position.set(pos.x, 0, pos.z);
                // Tint ghost red if outside valid zone
                const valid = World.nearestOwnedNode(pos.x, pos.z, GAME.player.faction);
                const tintCol = valid ? FACTIONS[GAME.player.faction].color : 0xff2200;
                _ghostMesh.traverse(c => {
                    if (c.isMesh && c.material.emissive) c.material.emissive.setHex(tintCol);
                });
            }
        }
    }

    // ── NEARBY NODES PANEL ────────────────────────────────────────────────────
    function _updateNearbyNodes() {
        const panel = document.getElementById('nearby-nodes');
        if (!panel || !GAME.player.mesh) return;
        const px = GAME.player.mesh.position.x, pz = GAME.player.mesh.position.z;
        const nearby = GAME.territory
            .map(n => ({ n, d: (n.x-px)*(n.x-px)+(n.z-pz)*(n.z-pz) }))
            .filter(o => o.d < 2200*2200)
            .sort((a,b) => a.d-b.d)
            .slice(0, 6);

        panel.innerHTML = '<div style="font-size:9px;letter-spacing:2px;color:rgba(255,255,255,0.3);margin-bottom:6px">NEARBY NODES</div>';
        nearby.forEach(({ n }) => {
            const col  = n.owner ? FACTIONS[n.owner].colorHex : '#336688';
            const pct  = Math.floor(n.progress);
            const isOwn = n.owner === GAME.player.faction;
            const hasStructures = GAME.buildings.some(b => {
                const dx=b.x-n.x,dz=b.z-n.z;
                return dx*dx+dz*dz < CONFIG.CAPTURE_RADIUS*CONFIG.CAPTURE_RADIUS && b.faction===n.owner;
            });
            const icons = (n.owner ? (hasStructures ? ' ⬡' : '') : '') ;
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:11px;';
            row.innerHTML = `
                <div style="width:8px;height:8px;border-radius:50%;background:${col};flex-shrink:0"></div>
                <div style="flex:1;color:${isOwn?col:'rgba(255,255,255,0.5)'}">
                    ${n.owner ? FACTIONS[n.owner].name.split(' ')[0] : 'NEUTRAL'}${icons}
                </div>
                <div style="width:50px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden">
                    <div style="height:100%;width:${pct}%;background:${col}"></div>
                </div>`;
            panel.appendChild(row);
        });
    }

    // ── BUILDING HEALTH BARS ──────────────────────────────────────────────────
    const _hpBarPool = [];
    function _getBuildingHPBars() {
        // Pre-create pool
        while (_hpBarPool.length < 30) {
            const el = document.createElement('div');
            el.style.cssText = `position:fixed;pointer-events:none;transform:translateX(-50%);display:none;z-index:11;`;
            el.innerHTML = `<div style="font-size:8px;text-align:center;color:rgba(255,255,255,0.6);margin-bottom:2px;letter-spacing:1px"></div>
                            <div style="width:54px;height:4px;background:rgba(0,0,0,0.6);border-radius:2px;overflow:hidden">
                                <div style="height:100%;background:#44ff66;border-radius:2px;transition:width 0.1s"></div>
                            </div>`;
            document.getElementById('hud').appendChild(el);
            _hpBarPool.push(el);
        }
        return _hpBarPool;
    }

    let _barsInit = false;
    function _updateBuildingHealthBars() {
        if (!_barsInit) { _getBuildingHPBars(); _barsInit = true; }
        const px = GAME.player.mesh.position.x, pz = GAME.player.mesh.position.z;
        const RANGE = 600*600;
        const bars  = _hpBarPool;
        let   bi    = 0;

        GAME.buildings.forEach(b => {
            if (bi >= bars.length) return;
            const dx=b.x-px, dz=b.z-pz;
            if (dx*dx+dz*dz > RANGE) return;

            // Project 3D to screen
            const v = new THREE.Vector3(b.x, 55, b.z);
            v.project(GAME.camera);
            if (v.z > 1) return;
            const sx = (v.x+1)/2*window.innerWidth;
            const sy = -(v.y-1)/2*window.innerHeight;

            const bar   = bars[bi++];
            const pct   = Math.max(0, b.hp/b.maxHp*100);
            const col   = pct > 60 ? '#44ff66' : pct > 30 ? '#ffaa22' : '#ff3344';
            const label = BLDG[b.type].name.split(' ')[0];
            const fCol  = FACTIONS[b.faction].colorHex;

            bar.style.display = 'block';
            bar.style.left    = sx + 'px';
            bar.style.top     = sy + 'px';
            bar.children[0].textContent = label;
            bar.children[0].style.color = fCol;
            bar.children[1].children[0].style.width  = pct+'%';
            bar.children[1].children[0].style.background = col;
        });

        // Hide unused bars
        for (; bi < bars.length; bi++) bars[bi].style.display = 'none';
    }

    // ── MESSAGES ──────────────────────────────────────────────────────────────
    function showMsg(text, type) {
        const el = document.getElementById('hud-msg');
        const cols = { ok:'#66ff88', err:'#ff4455', info:'#66ccff' };
        el.style.color   = cols[type] || '#fff';
        el.style.opacity = '1';
        el.textContent   = text;
        if (_msgTimer) clearTimeout(_msgTimer);
        _msgTimer = setTimeout(() => { el.style.opacity = '0'; }, 2800);
    }

    function flashHit() { _hitFlash = 0.4; }

    // ── LEVEL UP PANEL ────────────────────────────────────────────────────────
    function showLevelUp() {
        // If panel already open just refresh it
        let panel = document.getElementById('levelup-panel');
        if (panel) { _refreshLevelPanel(panel); return; }

        panel = document.createElement('div');
        panel.id = 'levelup-panel';
        panel.style.cssText = `
            position:fixed; right:14px; top:50%; transform:translateY(-50%);
            background:rgba(0,5,20,0.96); border:1px solid rgba(255,255,255,0.2);
            border-left:3px solid #ffcc22; padding:16px 18px; z-index:50;
            font-family:'Courier New'; min-width:220px; pointer-events:all;
        `;
        document.getElementById('hud').appendChild(panel);
        _refreshLevelPanel(panel);
    }

    function _refreshLevelPanel(panel) {
        const p = GAME.player;
        const stats = ['damage','fireRate','speed','hull','shield'];
        const labels = { damage:'DAMAGE', fireRate:'FIRE RATE', speed:'SPEED', hull:'HULL', shield:'SHIELD' };
        const upg = p.upgrades;

        panel.innerHTML = `
            <div style="font-size:11px;letter-spacing:3px;color:#ffcc22;margin-bottom:4px">LEVEL ${p.level}</div>
            <div style="font-size:9px;color:rgba(255,255,255,0.4);margin-bottom:12px;letter-spacing:1px">
                ${p.statPoints} POINT${p.statPoints!==1?'S':''} TO ALLOCATE
            </div>
            ${stats.map(s => {
                const base = (SHIP_CLASSES[p.shipClass]||SHIP_CLASSES.ASSAULT).stats[s] || 1;
                const bonus = playerStat(s) - base;
                const bonusPct = (bonus * 100).toFixed(1);
                const basePct  = (base  * 100).toFixed(0);
                return `
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                    <div style="flex:1;font-size:10px;color:rgba(255,255,255,0.6);letter-spacing:1px">${labels[s]}</div>
                    <div style="font-size:9px;color:rgba(255,255,255,0.35)">${basePct}%</div>
                    <div style="font-size:10px;color:#44ff88">+${bonusPct}%</div>
                    <button onclick="XP.upgradeStat('${s}');UI.showLevelUp()" style="
                        background:rgba(255,200,0,0.1);border:1px solid rgba(255,200,0,0.4);
                        color:#ffcc22;padding:2px 8px;cursor:pointer;font-family:'Courier New';
                        font-size:10px;border-radius:2px;${p.statPoints<=0?'opacity:0.3;pointer-events:none':''}
                    ">+</button>
                </div>`;
            }).join('')}
            ${p.statPoints <= 0 ? `<button onclick="document.getElementById('levelup-panel').remove()" style="
                background:transparent;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.5);
                padding:6px 14px;cursor:pointer;font-family:'Courier New';font-size:10px;
                letter-spacing:2px;width:100%;margin-top:6px;border-radius:2px;">CLOSE</button>` : ''}
        `;
        // Auto-close when all points spent
        if (p.statPoints <= 0 && !panel.querySelector('button[onclick*="remove"]')) {
            setTimeout(() => { if (panel.parentNode && p.statPoints <= 0) panel.remove(); }, 3000);
        }
    }

    // ── RESPAWN ───────────────────────────────────────────────────────────────
    function _respawnPlayer() {
        GAME.player.hp = GAME.player.maxHp;
        STATS.deaths++;
        const fac = FACTIONS[GAME.player.faction];
        GAME.player.mesh.position.set(fac.sx, 8, fac.sz);
        GAME.player.vx = 0; GAME.player.vz = 0;
        showMsg('Ship destroyed — respawning at base', 'err');
    }

    // ── WIN SCREEN ────────────────────────────────────────────────────────────
    function _showWin(factionId) {
        if (document.getElementById('win-screen')) return;
        GAME.running = false;
        const fac      = FACTIONS[factionId];
        const isPlayer = factionId === GAME.player.faction;
        const elapsed  = Math.floor((performance.now() - STATS.startTime) / 1000);
        const mins     = Math.floor(elapsed/60), secs = elapsed%60;
        const timeStr  = `${mins}:${secs.toString().padStart(2,'0')}`;

        const div = document.createElement('div');
        div.id = 'win-screen';
        div.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;
            background:rgba(0,0,0,0.92);display:flex;align-items:center;
            justify-content:center;flex-direction:column;z-index:999;font-family:'Courier New'`;
        div.innerHTML = `
            <div style="font-size:13px;letter-spacing:4px;color:${fac.colorHex};margin-bottom:10px">${fac.name.toUpperCase()}</div>
            <div style="font-size:46px;letter-spacing:6px;color:#fff;margin-bottom:8px">
                ${isPlayer ? 'SECTOR SECURED' : 'SECTOR LOST'}</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.35);margin-bottom:36px;letter-spacing:2px">
                ${isPlayer ? 'All nodes captured — the sector is yours' : fac.name+' controls every node'}
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,140px);gap:16px;margin-bottom:40px;text-align:center">
                ${_statBox('KILLS',         STATS.kills,           '#ff4444')}
                ${_statBox('DEATHS',        STATS.deaths,          '#888')}
                ${_statBox('NODES CAPPED',  STATS.nodesCaptured,   '#44aaff')}
                ${_statBox('RESOURCES',     Math.floor(STATS.resourcesMined/10)*10, '#ffcc22')}
                ${_statBox('BUILDINGS',     STATS.buildingsBuilt,  '#44ff88')}
                ${_statBox('TIME',          timeStr,               '#bb66ff')}
            </div>
            <button onclick="location.reload()" style="background:transparent;border:1px solid ${fac.colorHex};
                color:${fac.colorHex};padding:12px 40px;font-family:'Courier New';font-size:13px;
                letter-spacing:3px;cursor:pointer;border-radius:3px;">REDEPLOY</button>`;
        document.body.appendChild(div);
    }

    function _statBox(label, value, color) {
        return `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);
            padding:14px 10px;border-radius:3px;">
            <div style="font-size:22px;color:${color};font-weight:bold;margin-bottom:4px">${value}</div>
            <div style="font-size:9px;letter-spacing:2px;color:rgba(255,255,255,0.35)">${label}</div>
        </div>`;
    }

    return { init, update, buildStructure, showMsg, flashHit, showLevelUp };
})();
