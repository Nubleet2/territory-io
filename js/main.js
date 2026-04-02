'use strict';

let _selectedFaction   = 'TERRAN';
let _selectedShipClass = 'ASSAULT';
let _multiplayerMode   = false;
let _serverUrl         = null;

// ── OVERLAY BUILD ─────────────────────────────────────────────────────────
function _buildOverlay() {
    _buildFactionCards();
    _buildShipCards();
    _buildServerBrowser();

    document.getElementById('start-btn').addEventListener('click', () => {
        GAME.player.faction   = _selectedFaction;
        GAME.player.shipClass = _selectedShipClass;
        document.getElementById('overlay').style.display = 'none';

        if (_multiplayerMode && _serverUrl) {
            _initMultiplayer(_serverUrl);
        } else {
            _init();
        }
    });

    document.querySelectorAll('.bbtn[data-build]').forEach(btn => {
        btn.addEventListener('click', () => UI.buildStructure(btn.getAttribute('data-build')));
    });

    // Mode toggle
    document.getElementById('btn-solo').addEventListener('click', () => {
        _multiplayerMode = false;
        document.getElementById('server-browser').style.display = 'none';
        document.getElementById('deploy-section').style.display = '';
    });
    document.getElementById('btn-multi').addEventListener('click', () => {
        _multiplayerMode = true;
        document.getElementById('server-browser').style.display = '';
        document.getElementById('deploy-section').style.display = 'none';
        _refreshServerList();
    });
}

// ── FACTION CARDS ─────────────────────────────────────────────────────────
function _buildFactionCards() {
    const c = document.getElementById('faction-cards');
    Object.values(FACTIONS).forEach(f => {
        const card = document.createElement('div');
        card.className = 'fcard'; card.id = 'fcard-'+f.id;
        card.style.borderColor = f.colorHex+'55';
        card.innerHTML = `<div class="fname" style="color:${f.colorHex}">${f.name.toUpperCase()}</div><div class="fworld">${f.world}</div>`;
        card.addEventListener('click', () => _selectFaction(f.id));
        c.appendChild(card);
    });
    _selectFaction('TERRAN');
}

function _selectFaction(id) {
    _selectedFaction = id;
    document.querySelectorAll('.fcard').forEach(c => {
        c.classList.remove('selected');
        c.style.borderColor = FACTIONS[c.id.replace('fcard-','')].colorHex+'44';
    });
    const a = document.getElementById('fcard-'+id);
    if (a) { a.classList.add('selected'); a.style.borderColor = FACTIONS[id].colorHex; }
}

// ── SHIP CARDS ────────────────────────────────────────────────────────────
function _buildShipCards() {
    const c = document.getElementById('ship-cards');
    Object.entries(SHIP_CLASSES).forEach(([id, cls]) => {
        const card = document.createElement('div');
        card.className = 'scard'; card.id = 'scard-'+id;
        const hexCol = '#'+cls.color.toString(16).padStart(6,'0');
        card.style.borderColor = hexCol+'55';
        const s = cls.stats;
        const bar = (v,max) => {
            const pct=Math.round((v/max)*100);
            const col=v>=1.3?'#44ff88':v>=1.0?'#ffcc22':'#ff6644';
            return `<div style="display:inline-block;width:${pct}%;height:3px;background:${col};border-radius:1px;vertical-align:middle"></div>`;
        };
        card.innerHTML = `
            <div class="sname" style="color:${hexCol}">${cls.name.toUpperCase()}</div>
            <div class="sdesc">${cls.desc}</div>
            <div class="sstats">
                DMG &nbsp;${bar(s.damage,2)}<br>SPD &nbsp;${bar(s.speed,2)}<br>
                HULL ${bar(s.hull,2.5)}<br>SHLD ${bar(s.shield,2)}
            </div>`;
        card.addEventListener('click', () => _selectShipClass(id));
        c.appendChild(card);
    });
    _selectShipClass('ASSAULT');
}

function _selectShipClass(id) {
    _selectedShipClass = id;
    document.querySelectorAll('.scard').forEach(c => {
        c.classList.remove('selected');
        c.style.borderColor = '#'+SHIP_CLASSES[c.id.replace('scard-','')].color.toString(16).padStart(6,'0')+'44';
    });
    const a = document.getElementById('scard-'+id);
    if (a) {
        a.classList.add('selected');
        a.style.borderColor = '#'+SHIP_CLASSES[id].color.toString(16).padStart(6,'0');
    }
}

// ── SERVER BROWSER ────────────────────────────────────────────────────────
let _savedServers = JSON.parse(localStorage.getItem('tio_servers')||'[]');

function _buildServerBrowser() {
    const sb = document.getElementById('server-browser');

    sb.innerHTML = `
        <div style="font-size:9px;letter-spacing:3px;color:rgba(255,255,255,0.4);margin-bottom:12px">SERVER BROWSER</div>
        <div style="display:flex;gap:8px;margin-bottom:14px">
            <input id="server-input" placeholder="IP:PORT  e.g. 192.168.1.5:7777"
                style="flex:1;background:rgba(0,10,30,0.8);border:1px solid rgba(255,255,255,0.15);
                color:#fff;padding:8px 12px;font-family:'Courier New';font-size:11px;border-radius:3px;
                outline:none;"/>
            <button id="btn-add-server" style="background:rgba(0,200,255,0.1);border:1px solid #0cf;
                color:#0cf;padding:8px 16px;cursor:pointer;font-family:'Courier New';font-size:11px;
                border-radius:3px;letter-spacing:1px;">ADD</button>
        </div>
        <div id="server-list" style="display:flex;flex-direction:column;gap:8px;max-height:240px;overflow-y:auto;margin-bottom:14px"></div>
        <div style="display:flex;gap:8px;justify-content:center">
            <button id="btn-refresh" style="background:transparent;border:1px solid rgba(255,255,255,0.2);
                color:rgba(255,255,255,0.5);padding:8px 20px;cursor:pointer;font-family:'Courier New';
                font-size:10px;border-radius:3px;letter-spacing:2px;">↺ REFRESH</button>
        </div>`;

    document.getElementById('btn-add-server').addEventListener('click', () => {
        let val = document.getElementById('server-input').value.trim();
        // Strip any protocol prefix and trailing slashes
        val = val.replace(/^https?:\/\//,'').replace(/^wss?:\/\//,'').replace(/\/+$/,'');
        if (!val) return;
        if (!_savedServers.includes(val)) {
            _savedServers.push(val);
            localStorage.setItem('tio_servers', JSON.stringify(_savedServers));
        }
        _refreshServerList();
    });

    document.getElementById('btn-refresh').addEventListener('click', _refreshServerList);
}

function _refreshServerList() {
    const list = document.getElementById('server-list');
    if (!list) return;
    list.innerHTML = _savedServers.length
        ? '<div style="font-size:10px;color:rgba(255,255,255,0.25);letter-spacing:1px">Pinging servers...</div>'
        : '<div style="font-size:10px;color:rgba(255,255,255,0.25)">No servers saved. Add one above.</div>';

    _savedServers.forEach(host => {
        Network.pingServer(host).then(info => {
            if (!list) return;
            // Remove placeholder
            list.querySelector('div')?.remove();
            _renderServerCard(list, host, info);
        });
    });
}

function _renderServerCard(list, host, info) {
    const old = document.getElementById('srv-'+host.replace(/[:.]/g,'_'));
    if (old) old.remove();

    const card = document.createElement('div');
    card.id = 'srv-'+host.replace(/[:.]/g,'_');
    card.style.cssText = `background:rgba(0,10,30,0.8);border:1px solid rgba(255,255,255,0.12);
        padding:10px 14px;border-radius:3px;display:flex;align-items:center;gap:12px;`;

    if (!info) {
        card.innerHTML = `
            <div style="flex:1">
                <div style="font-size:11px;color:rgba(255,255,255,0.4)">${host}</div>
                <div style="font-size:9px;color:#ff4444;margin-top:2px">Offline / unreachable</div>
            </div>
            <button onclick="_removeServer('${host}')" style="background:transparent;border:1px solid rgba(255,50,50,0.3);
                color:rgba(255,80,80,0.6);padding:4px 10px;cursor:pointer;font-family:'Courier New';
                font-size:9px;border-radius:2px;">✕</button>`;
    } else {
        const terr = Object.entries(info.territoryPct||{})
            .map(([f,pct]) => `<span style="color:${FACTIONS[f]?.colorHex||'#fff'}">${FACTIONS[f]?.name.split(' ')[0]||f} ${pct}%</span>`)
            .join(' · ');
        const mins = Math.floor(info.gameTime/60), secs=info.gameTime%60;
        const pingCol = info.ping<50?'#44ff88':info.ping<120?'#ffcc22':'#ff6644';

        card.innerHTML = `
            <div style="flex:1">
                <div style="font-size:12px;color:#fff;margin-bottom:3px">${info.name||host}</div>
                <div style="font-size:9px;color:rgba(255,255,255,0.4);margin-bottom:3px">${host}</div>
                <div style="font-size:9px;color:rgba(255,255,255,0.35)">${terr||'No territory data'}</div>
            </div>
            <div style="text-align:right;min-width:90px">
                <div style="font-size:10px;color:#0cf">${info.playerCount}/${info.maxPlayers} players</div>
                <div style="font-size:9px;color:rgba(255,255,255,0.4);margin-top:2px">${mins}:${secs.toString().padStart(2,'0')} elapsed</div>
                <div style="font-size:9px;color:${pingCol};margin-top:2px">${info.ping}ms</div>
            </div>
            <button onclick="_joinServer('${host}')" style="background:rgba(0,200,255,0.1);border:1px solid #0cf;
                color:#0cf;padding:8px 14px;cursor:pointer;font-family:'Courier New';font-size:11px;
                border-radius:3px;letter-spacing:1px;white-space:nowrap;">JOIN</button>`;
    }
    list.appendChild(card);
}

function _removeServer(host) {
    _savedServers = _savedServers.filter(s=>s!==host);
    localStorage.setItem('tio_servers', JSON.stringify(_savedServers));
    _refreshServerList();
}

function _joinServer(host) {
    _serverUrl = host;
    _multiplayerMode = true;
    // Show deploy section so player can pick faction/ship
    document.getElementById('server-browser').style.display = 'none';
    document.getElementById('deploy-section').style.display = '';
    document.getElementById('start-btn').textContent = 'CONNECT + DEPLOY';
}

// ── INIT ──────────────────────────────────────────────────────────────────
function _init() {
    Render.init();
    Effects.init();
    Audio.init();
    World.generate();
    Player.create();
    AI.init();
    UI.init();

    STATS.startTime = performance.now();
    GAME.clock      = { last: performance.now() };
    GAME.running    = true;

    requestAnimationFrame(_loop);
}

function _initMultiplayer(host) {
    // Clean host just in case
    const cleanHost = host.replace(/^https?:\/\//,'').replace(/^wss?:\/\//,'').replace(/\/+$/,'');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${cleanHost}`;
    GAME.multiplayer = true;

    Network.connect(wsUrl, (isHost, localId) => {
        // Tell server our faction+ship choice
        // (WebSocket is open by welcome message)
        setTimeout(() => {
            // small delay so ws is stable
        }, 50);
    });

    // Init game world first
    Render.init();
    Effects.init();
    Audio.init();
    World.generate();
    Player.create();

    if (Network.isHost()) {
        AI.init();
    }
    UI.init();

    // Tell server who we are
    const sendJoin = () => {
        if (Network.isConnected()) {
            // send via raw ws - Network handles this on welcome
        }
    };

    STATS.startTime = performance.now();
    GAME.clock      = { last: performance.now() };
    GAME.running    = true;

    requestAnimationFrame(_loopMulti);
}

// ── GAME LOOPS ────────────────────────────────────────────────────────────
function _loop(now) {
    if (!GAME.running) return;
    requestAnimationFrame(_loop);
    const dt = Math.min((now-GAME.clock.last)*0.001, 0.05);
    GAME.clock.last = now;
    Player.update(dt);
    World.update(dt);
    Buildings.update(dt);
    AI.update(dt);
    Combat.update(dt);
    Effects.update(dt);
    UI.update(dt);
    Render.render();
}

function _loopMulti(now) {
    if (!GAME.running) return;
    requestAnimationFrame(_loopMulti);
    const dt = Math.min((now-GAME.clock.last)*0.001, 0.05);
    GAME.clock.last = now;

    Player.update(dt);
    World.update(dt);
    Buildings.update(dt);
    Network.updateRemotePlayers(dt); // simulate remote players on host

    if (Network.isHost()) {
        AI.update(dt);    // only host runs AI
        Combat.update(dt);
    }

    Effects.update(dt);
    Network.update(dt);  // sync state / send inputs
    UI.update(dt);
    Render.render();
}

_buildOverlay();
