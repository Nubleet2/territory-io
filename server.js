'use strict';
const http = require('http');
const WebSocket = require('ws');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PORT        = parseInt(process.env.PORT) || 7777;
const SERVER_NAME = process.argv[2] || 'Territory.io';

const players = new Map(); // id → { ws, id, isHost, faction, shipClass }
let   hostWs    = null;
let   idCounter = 0;
let   gameStart = Date.now();
let   latestState = null;

const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'};

const httpServer = http.createServer((req, res) => {
    const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET'};
    const url  = req.url.split('?')[0];
    if (url === '/ping') { res.writeHead(200,cors); return res.end('pong'); }
    if (url === '/info') {
        const info = {
            name: SERVER_NAME,
            playerCount: players.size,
            maxPlayers: 8,
            gameTime: Math.floor((Date.now()-gameStart)/1000),
            territoryPct: latestState ? latestState.territoryPct : {},
            status: hostWs ? 'playing' : 'waiting',
        };
        res.writeHead(200,{...cors,'Content-Type':'application/json'});
        return res.end(JSON.stringify(info));
    }
    const file = url === '/' ? '/index.html' : url;
    const full = path.join(__dirname, file);
    if (!full.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
    fs.readFile(full, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, {'Content-Type': MIME[path.extname(full)]||'text/plain', ...cors});
        res.end(data);
    });
});

const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws) => {
    const id     = ++idCounter;
    const isHost = players.size === 0;
    players.set(id, { ws, id, isHost, faction:'TERRAN', shipClass:'ASSAULT' });

    if (isHost) { hostWs = ws; gameStart = Date.now(); }

    // Tell this player who they are
    ws.send(JSON.stringify({ type:'welcome', id, isHost, serverName:SERVER_NAME }));

    // Send cached state to late joiners so they see the current world
    if (!isHost && latestState) {
        ws.send(JSON.stringify({ type:'gameState', ...latestState }));
    }

    // Tell EVERYONE about this new player (broadcast to all existing)
    // We don't have faction/shipClass yet — will arrive in 'join' message
    _broadcastExcept(id, { type:'playerJoined', id, faction:'TERRAN', shipClass:'ASSAULT' });
    _broadcast({ type:'playerCount', count: players.size });

    ws.on('message', raw => {
        let msg; try { msg = JSON.parse(raw); } catch { return; }
        _handle(id, msg);
    });

    ws.on('close', () => {
        players.delete(id);
        if (ws === hostWs) {
            hostWs = null;
            latestState = null;
            const next = [...players.values()][0];
            if (next) {
                next.isHost = true;
                hostWs = next.ws;
                next.ws.send(JSON.stringify({ type:'promoted' }));
            }
        }
        _broadcast({ type:'playerLeft', id });
        _broadcast({ type:'playerCount', count: players.size });
    });
});

function _handle(fromId, msg) {
    const player = players.get(fromId);
    if (!player) return;

    if (msg.type === 'gameState' && player.isHost) {
        latestState = msg;
        // Relay to all non-host clients
        for (const [id, p] of players) {
            if (id !== fromId && p.ws.readyState === WebSocket.OPEN)
                p.ws.send(JSON.stringify({ type:'gameState', ...msg }));
        }

    } else if (msg.type === 'input' && !player.isHost) {
        // Forward client input to host
        if (hostWs?.readyState === WebSocket.OPEN)
            hostWs.send(JSON.stringify({ type:'playerInput', fromId, ...msg }));

    } else if (msg.type === 'join') {
        // Player sent their faction/ship — update and tell everyone including host
        player.faction   = msg.faction;
        player.shipClass = msg.shipClass;
        // Broadcast updated info to ALL players
        _broadcast({ type:'playerJoined', id:fromId, faction:msg.faction, shipClass:msg.shipClass });

    } else if (msg.type === 'ping') {
        player.ws.send(JSON.stringify({ type:'pong', t:msg.t }));
    }
}

function _broadcast(msg) {
    const d = JSON.stringify(msg);
    for (const p of players.values())
        if (p.ws.readyState === WebSocket.OPEN) p.ws.send(d);
}

function _broadcastExcept(excludeId, msg) {
    const d = JSON.stringify(msg);
    for (const [id, p] of players)
        if (id !== excludeId && p.ws.readyState === WebSocket.OPEN) p.ws.send(d);
}

httpServer.listen(PORT, () => {
    const ips = Object.values(os.networkInterfaces()).flat()
        .filter(i=>i.family==='IPv4'&&!i.internal).map(i=>i.address);
    console.log(`\n  Territory.io Server running`);
    console.log(`  LAN: ${ips.map(ip=>`http://${ip}:${PORT}`).join(', ')}`);
    console.log(`  Port: ${PORT}\n`);
});
