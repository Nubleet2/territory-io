'use strict';

const CONFIG = {
    MAP_SIZE:         14000,
    TERRITORY_NODES:  90,
    RESOURCE_NODES:   80,
    ASTEROID_COUNT:   0,
    CAPTURE_RADIUS:   230,
    CAPTURE_SPEED:    22,
    SHIP_THRUST:      600,
    SHIP_DRAG:        1.5,
    SHIP_MAX_SPEED:   420,
    SHIP_TURN_SPEED:  0.14,
    SHIP_HP:          100,
    PROJ_SPEED:       680,
    PROJ_DAMAGE:      10,
    PROJ_LIFE:        1.4,    // shorter range — was 2.8
    FIRE_RATE:        0.16,
    CAMERA_HEIGHT:    1300,
    CAMERA_TILT:      420,
    RES_VALUE:        30,
    RES_RESPAWN:      28,
    ROCK_HP:          250,
    MINE_TICK:        3.0,
    MINE_AMOUNT:      12,
    NODE_INCOME:      0.4,
    MAX_BLDG_PER_NODE:15,

    // XP
    XP_KILL:          50,
    XP_BLDG_DESTROY:  30,
    XP_CAPTURE:       40,
    XP_BUILD:         10,
    XP_PER_LEVEL:     200,  // XP needed per level (flat)
    STAT_POINTS_LEVEL:5,
};

// ── SHIP CLASSES ──────────────────────────────────────────────────────────────
// Base multipliers applied on top of CONFIG values
const SHIP_CLASSES = {
    FIGHTER: {
        name:'Fighter',   desc:'High damage, fast fire rate. Average capture speed.',
        captureSpeed: 1.0,
        color:0xff6633,
        stats:{ damage:1.4, fireRate:0.85, speed:1.1, hull:0.9,  shield:0.8 },
        weapon:{
            name:'Needle Burst',
            // 3 rapid thin bolts from nose, slightly spread
            shots:    3,
            spread:   0.06,       // radians between shots
            geoType:  'needle',   // thin elongated box
            scale:    [2, 2, 26],
            color:    0xff5522,
            projSpeed:580,
            damageMult:0.75,      // lower per shot, compensated by 3 shots + high fireRate
            delay:    0.04,       // seconds between burst shots
        }
    },
    ASSAULT: {
        name:'Assault',   desc:'Balanced all-rounder. Standard capture speed.',
        captureSpeed: 1.0,
        color:0xff4444,
        stats:{ damage:1.1, fireRate:1.0, speed:1.0, hull:1.1,  shield:1.0 },
        weapon:{
            name:'Dual Laser',
            shots:    2,
            spread:   0,
            geoType:  'bolt',
            scale:    [3.5, 3.5, 18],
            color:    0xff4444,
            projSpeed:500,
            damageMult:1.0,
            delay:    0,
        }
    },
    SCOUT: {
        name:'Scout',     desc:'Very fast. Fastest node capture speed.',
        captureSpeed: 2.0,
        color:0x44ffaa,
        stats:{ damage:0.7, fireRate:1.1, speed:1.6, hull:0.75, shield:0.7 },
        weapon:{
            name:'Piercer',
            shots:    1,
            spread:   0,
            geoType:  'needle',
            scale:    [1.5, 1.5, 38],  // very long thin needle
            color:    0x00ffcc,
            projSpeed:750,            // fastest projectile
            damageMult:1.2,
            delay:    0,
        }
    },
    CARRIER: {
        name:'Carrier',   desc:'Tough support. Heals allies. Below average capture speed.',
        captureSpeed: 0.75,
        color:0x4499ff,
        stats:{ damage:0.8, fireRate:0.7, speed:0.75,hull:1.8,  shield:1.4 },
        weapon:{
            name:'Energy Ring',
            shots:    1,
            spread:   0,
            geoType:  'ring',          // torus — flat spinning ring, unmistakable
            scale:    [10, 2.5, 0],    // [radius, tube, unused]
            color:    0x44ccff,
            projSpeed:520,
            damageMult:1.6,
            hitRadius:30*30,
            delay:    0,
        }
    },
    ENGINEER: {
        name:'Engineer',  desc:'Fast builder. 20% build discount. Fast capture speed.',
        captureSpeed: 1.7,
        color:0xffcc22,
        stats:{ damage:0.8, fireRate:0.9, speed:1.0, hull:1.0,  shield:1.1 },
        buildDiscount: 0.8,
        weapon:{
            name:'Hex Spread',
            shots:    3,
            spread:   0.12,            // wider spread than fighter
            geoType:  'hex',           // hexagonal prism
            scale:    [5, 5, 10],
            color:    0xffcc00,
            projSpeed:420,
            damageMult:0.85,
            delay:    0,               // all 3 fire simultaneously
        }
    },
    DREADNOUGHT: {
        name:'Dreadnought',desc:'Slow heavy warship. High firepower. Slowest capture speed.',
        captureSpeed: 0.4,
        color:0xcc44ff,
        stats:{ damage:1.6, fireRate:0.7, speed:0.65,hull:2.2,  shield:1.5 },
        weapon:{
            name:'Gravity Bomb',
            shots:    1,
            spread:   0,
            geoType:  'bomb',          // octahedron bomb shape
            scale:    [14, 14, 14],
            color:    0xcc44ff,
            projSpeed:420,
            damageMult:5.0,
            aoe:      true,            // explodes on impact, damages all enemies in radius
            aoeRadius:200,             // area damage radius in world units
            fireRate: 1.6,             // override: 1.6s cooldown regardless of upgrades
            delay:    0,
        }
    },
};

const FACTIONS = {
    TERRAN: { id:'TERRAN', name:'Terran Vanguard',  world:'Earth Prime',    colorHex:'#ff4444', color:0xff4444, sx:-5000, sz:-5000 },
    HELIX:  { id:'HELIX',  name:'Helix Coalition',  world:'Nexus IV',       colorHex:'#44aaff', color:0x44aaff, sx: 5000, sz:-5000 },
    IRON:   { id:'IRON',   name:'Iron Dominion',    world:'Ferris Major',   colorHex:'#ffcc22', color:0xffcc22, sx: 5000, sz: 5000 },
    VOID:   { id:'VOID',   name:'Void Remnant',     world:'The Hollow',     colorHex:'#bb66ff', color:0xbb66ff, sx:-5000, sz: 5000 },
};

const BLDG = {
    COMMAND_CENTER: { name:'Command Center', cost:500, hp:1200, range:0,   fireRate:0 },
    AUTO_MINER:     { name:'Auto Miner',     cost:200, hp:300,  range:0,   fireRate:0 },
    TURRET:         { name:'Turret',         cost:300, hp:500,  range:420, fireRate:0.9 },
    SHIELD_GEN:     { name:'Shield Gen',     cost:400, hp:600,  range:340, fireRate:0 },
    REPAIR_BCN:     { name:'Repair Beacon',  cost:250, hp:350,  range:300, fireRate:0 },
};

const GAME = {
    scene:null, camera:null, renderer:null,
    player:{
        mesh:null, faction:'TERRAN', shipClass:'ASSAULT',
        hp:CONFIG.SHIP_HP, maxHp:CONFIG.SHIP_HP,
        shield:0, maxShield:0,           // filled on ship create
        resources:0, angle:0, fireCooldown:0,
        vx:0, vz:0,
        statDamage:1, statFireRate:1, statSpeed:1, statHull:1, statShield:1,
        xp:0, level:1, statPoints:0,
        upgrades:{ damage:0, fireRate:0, speed:0, hull:0, shield:0 },
    },
    territory:[], resources:[], buildings:[], projectiles:[], aiShips:[],
    remotePlayers: {},  // id → remote player state (multiplayer)
    keys:{}, mouse:{x:0,y:0},
    running:false, buildMode:false, buildType:null,
    multiplayer: false,  // true when connected to a server
    clock:null, minimapCtx:null,
};

const STATS = {
    kills:0, deaths:0, nodesCaptured:0,
    resourcesMined:0, buildingsBuilt:0, startTime:0,
};

// Seeded RNG — ensures all clients generate identical worlds
// Call SEED.init(n) before World.generate(), then use SEED.rand() instead of Math.random()
const SEED = (() => {
    let _s = 0;
    const init = (seed) => { _s = seed >>> 0; };
    const rand = () => {
        _s |= 0; _s = _s + 0x6D2B79F5 | 0;
        let t = Math.imul(_s ^ _s >>> 15, 1 | _s);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    return { init, rand };
})();
// Uses sqrt diminishing returns so dumping all points into one stat
// gives +~90% at 495 points, not +5000%
// At 99 points (balanced level 99): +~40% per stat
function playerStat(stat) {
    const cls  = SHIP_CLASSES[GAME.player.shipClass] || SHIP_CLASSES.ASSAULT;
    const base = cls.stats[stat] || 1;
    const upg  = GAME.player.upgrades[stat] || 0;
    // sqrt scaling: first points feel impactful, later ones diminish
    const bonus = Math.sqrt(upg) * 0.04;
    return base + bonus;
}
