'use strict';
const http = require('http');
const WebSocket = require('ws');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PORT        = parseInt(process.env.PORT) || 7777;
const SERVER_NAME = process.argv[2] || 'Territory.io';

// ── State ──────────────────────────────────────────────────────────────────
const players   = new Map(); // id → { ws, id, isHost, faction, shipClass }
let   hostWs    = null;
let   idCounter = 0;
let   gameStart = Date.now();
let   latestState = null;   // cached for late joiners

// ── HTTP — serve game files + /info + /ping ────────────────────────────────
const MIME = {
    '.html':'text/html', '.js':'application/javascript',
    '.css':'text/css',   '.png':'image/png', '.ico':'image/x-icon',
};

const httpServer = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin':'*' };
    const url  = req.url.split('?')[0];

    if (url === '/ping') {
        res.writeHead(200, cors); return res.end('pong');
    }
    if (url === '/info') {
        const pct = latestState ? latestState.territoryPct : {};
        const info = {
            name:        SERVER_NAME,
            playerCount: players.size,
            maxPlayers:  8,
            gameTime:    Math.floor((Date.now()-gameStart)/1000),
            territoryPct: pct,
            status:      hostWs ? 'playing' : 'waiting',
        };
        res.writeHead(200, { ...cors, 'Content-Type':'application/json' });
        return res.end(JSON.stringify(info));
    }

    // Serve static game files
    const file = url === '/' ? '/index.html' : url;
    const full = path.join(__dirname, file);
    if (!full.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
    fs.readFile(full, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        const ext = path.extname(full);
        res.writeHead(200, { 'Content-Type': MIME[ext]||'text/plain' });
        res.end(data);
    });
});

// ── WebSocket ──────────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws) => {
    const id      = ++idCounter;
    const isHost  = players.size === 0;
    players.set(id, { ws, id, isHost, faction:null, shipClass:null });

    if (isHost) {
        hostWs    = ws;
        gameStart = Date.now();
        console.log(`Host connected  id=${id}`);
    } else {
        console.log(`Player connected id=${id}`);
        // Send cached state so late joiners see current world
        if (latestState) ws.send(JSON.stringify({ type:'gameState', ...latestState }));
    }

    ws.send(JSON.stringify({ type:'welcome', id, isHost, serverName:SERVER_NAME }));

    if (!isHost && hostWs?.readyState === WebSocket.OPEN)
        hostWs.send(JSON.stringify({ type:'playerJoined', id }));

    _broadcast({ type:'playerCount', count: players.size });

    ws.on('message', raw => {
        let msg; try { msg = JSON.parse(raw); } catch { return; }
        _handle(id, msg);
    });

    ws.on('close', () => {
        players.delete(id);
        console.log(`Player ${id} disconnected`);

        if (ws === hostWs) {
            hostWs = null;
            const next = [...players.values()][0];
            if (next) {
                next.isHost = true; hostWs = next.ws;
                next.ws.send(JSON.stringify({ type:'promoted' }));
                console.log(`Player ${next.id} promoted to host`);
            }
        }
        if (hostWs?.readyState === WebSocket.OPEN)
            hostWs.send(JSON.stringify({ type:'playerLeft', id }));
        _broadcast({ type:'playerLeft', id });
        _broadcast({ type:'playerCount', count: players.size });
    });
});

function _handle(fromId, msg) {
    const player = players.get(fromId);
    if (!player) return;

    if (msg.type === 'gameState' && player.isHost) {
        latestState = msg;
        // Relay to all clients
        for (const [id, p] of players) {
            if (id !== fromId && p.ws.readyState === WebSocket.OPEN)
                p.ws.send(JSON.stringify({ type:'gameState', ...msg }));
        }

    } else if (msg.type === 'input' && !player.isHost) {
        if (hostWs?.readyState === WebSocket.OPEN)
            hostWs.send(JSON.stringify({ type:'playerInput', fromId, ...msg }));

    } else if (msg.type === 'join') {
        player.faction   = msg.faction;
        player.shipClass = msg.shipClass;
        if (hostWs?.readyState === WebSocket.OPEN)
            hostWs.send(JSON.stringify({ type:'playerJoined', id:fromId, ...msg }));

    } else if (msg.type === 'ping') {
        player.ws.send(JSON.stringify({ type:'pong', t:msg.t }));
    }
}

function _broadcast(msg) {
    const d = JSON.stringify(msg);
    for (const p of players.values())
        if (p.ws.readyState === WebSocket.OPEN) p.ws.send(d);
}

// ── Start ──────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
    const ifaces = os.networkInterfaces();
    const ips = Object.values(ifaces).flat()
        .filter(i => i.family==='IPv4' && !i.internal)
        .map(i => i.address);
    console.log('\n═══════════════════════════════════');
    console.log(`  Territory.io Server  v1.0`);
    console.log('═══════════════════════════════════');
    console.log(`  Port  : ${PORT}`);
    console.log(`  LAN   : ${ips.map(ip=>`http://${ip}:${PORT}`).join(', ')}`);
    console.log(`  Share one of these with friends`);
    console.log('═══════════════════════════════════\n');
});
