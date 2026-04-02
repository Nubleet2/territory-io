'use strict';

const Render = (() => {

    function init() {
        const canvas = document.getElementById('gameCanvas');
        GAME.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        GAME.renderer.setSize(window.innerWidth, window.innerHeight);
        GAME.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        GAME.renderer.shadowMap.enabled = false;
        GAME.renderer.setClearColor(0x00000a);

        GAME.scene = new THREE.Scene();
        GAME.scene.fog = new THREE.FogExp2(0x00000a, 0.000042);

        const fac = FACTIONS[GAME.player.faction];
        GAME.camera = new THREE.PerspectiveCamera(56, window.innerWidth/window.innerHeight, 1, 22000);
        GAME.camera.position.set(fac.sx, CONFIG.CAMERA_HEIGHT, fac.sz + CONFIG.CAMERA_TILT);
        GAME.camera.lookAt(fac.sx, 0, fac.sz);

        _setupLighting();
        _createStarfield();
        _createNebulae();
        _createCelestialBodies();

        window.addEventListener('resize', () => {
            GAME.camera.aspect = window.innerWidth / window.innerHeight;
            GAME.camera.updateProjectionMatrix();
            GAME.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    function _setupLighting() {
        GAME.scene.add(new THREE.AmbientLight(0x141e30, 2.8));
        const key = new THREE.DirectionalLight(0x99aadd, 2.4);
        key.position.set(3000, 5000, 2000);
        GAME.scene.add(key);
        const fill = new THREE.DirectionalLight(0x220033, 0.5);
        fill.position.set(-3000, -500, -2000);
        GAME.scene.add(fill);
    }

    function _createStarfield() {
        const layers = [
            { count:4000, y:[-1800,-800], size:1.5, op:0.5 },
            { count:3000, y:[-600,-200],  size:2.2, op:0.75 },
            { count:1200, y:[-80,  20],   size:3.0, op:1.0 },
        ];
        layers.forEach(l => {
            const pos = new Float32Array(l.count*3);
            const col = new Float32Array(l.count*3);
            for (let i = 0; i < l.count; i++) {
                pos[i*3  ] = (Math.random()-0.5)*22000;
                pos[i*3+1] = l.y[0]+Math.random()*(l.y[1]-l.y[0]);
                pos[i*3+2] = (Math.random()-0.5)*22000;
                const v = 0.35+Math.random()*0.65, t = Math.random();
                if      (t<0.15) { col[i*3]=v;     col[i*3+1]=v*0.6; col[i*3+2]=v*0.4; }
                else if (t<0.25) { col[i*3]=v*0.7; col[i*3+1]=v*0.8; col[i*3+2]=v; }
                else             { col[i*3]=v;     col[i*3+1]=v;     col[i*3+2]=v; }
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
            geo.setAttribute('color',    new THREE.BufferAttribute(col,3));
            GAME.scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
                size:l.size, vertexColors:true, sizeAttenuation:false,
                transparent:true, opacity:l.op
            })));
        });
    }

    function _createNebulae() {
        const defs = [
            [0xaa00ff,-4000,-5000,3200,0.18],[0x0055ff,5500,3000,2800,0.16],
            [0xff2233,-2500,6000,3400,0.14], [0x00ccff,7000,-4000,2600,0.16],
            [0x6600cc,-7000,2000,3000,0.15], [0xff6600,1000,7500,2400,0.13],
            [0xff3300,4000,-7000,3600,0.12], [0x00ff88,-6000,-3000,2600,0.13],
            [0xffaa00,500,-8000,2200,0.14],  [0x9900ff,8000,6000,3000,0.13],
        ];
        defs.forEach(([col,x,z,sz,op]) => {
            for (let i=0;i<6;i++) {
                const m = new THREE.Mesh(
                    new THREE.CircleGeometry(sz*(0.4+Math.random()*0.7),14),
                    new THREE.MeshBasicMaterial({ color:col, transparent:true,
                        opacity:op*(0.3+Math.random()*0.7), side:THREE.DoubleSide,
                        depthWrite:false, blending:THREE.AdditiveBlending })
                );
                m.position.set(x+(Math.random()-0.5)*sz*0.7,-380+(Math.random()-0.5)*160,z+(Math.random()-0.5)*sz*0.7);
                m.rotation.x = -Math.PI/2+(Math.random()-0.5)*0.45;
                m.rotation.z = Math.random()*Math.PI;
                GAME.scene.add(m);
            }
        });
    }

    function _createCelestialBodies() {
        const sp = {x:-1000,y:-3000,z:-1500};
        const sm = new THREE.Mesh(new THREE.SphereGeometry(1100,28,28), new THREE.MeshBasicMaterial({color:0xffee88}));
        sm.position.set(sp.x,sp.y,sp.z); GAME.scene.add(sm);
        [[1400,0xffaa22,0.28],[1900,0xff7711,0.14],[2800,0xff4400,0.06]].forEach(([r,c,o])=>{
            const h=new THREE.Mesh(new THREE.SphereGeometry(r,10,10),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:o,side:THREE.BackSide}));
            h.position.set(sp.x,sp.y,sp.z); GAME.scene.add(h);
        });
        const sl=new THREE.PointLight(0xffcc66,1.2,24000); sl.position.set(sp.x,sp.y,sp.z); GAME.scene.add(sl);

        const bp={x:9000,y:-2000,z:9000};
        const bm=new THREE.Mesh(new THREE.SphereGeometry(500,16,16),new THREE.MeshBasicMaterial({color:0x88ccff}));
        bm.position.set(bp.x,bp.y,bp.z); GAME.scene.add(bm);
        [[700,0x4488ff,0.20],[1200,0x2255cc,0.09]].forEach(([r,c,o])=>{
            const h=new THREE.Mesh(new THREE.SphereGeometry(r,8,8),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:o,side:THREE.BackSide}));
            h.position.set(bp.x,bp.y,bp.z); GAME.scene.add(h);
        });
        const bl=new THREE.PointLight(0x6699ff,0.5,16000); bl.position.set(bp.x,bp.y,bp.z); GAME.scene.add(bl);

        _makePlanet(-8000,-2000, 7000,750,0x0d2233);
        _makePlanet( 9000,-1800,-7000,460,0x551a00);
        _makePlanet(-5000,-1400,-8000,200,0x7799aa);
        _makePlanet( 2000,-1600, 9000,340,0x1a0500);
        _makeRingedPlanet(8500,-3000,8500,580,0x3d4422,0x667744);
        _makeGalaxy(-9000,-2200,-9500);
    }

    function _makePlanet(x,y,z,r,col) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(r,32,32),
            new THREE.MeshStandardMaterial({color:col,roughness:0.88,metalness:0}));
        m.position.set(x,y,z); GAME.scene.add(m);
        const atmo = new THREE.Mesh(new THREE.SphereGeometry(r*1.06,16,16),
            new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.09,side:THREE.BackSide}));
        atmo.position.set(x,y,z); GAME.scene.add(atmo);
    }
    function _makeRingedPlanet(x,y,z,r,pc,rc) {
        _makePlanet(x,y,z,r,pc);
        const ring=new THREE.Mesh(new THREE.RingGeometry(r*1.4,r*2.2,42),
            new THREE.MeshBasicMaterial({color:rc,side:THREE.DoubleSide,transparent:true,opacity:0.55}));
        ring.position.set(x,y,z); ring.rotation.x=1.1; GAME.scene.add(ring);
    }
    function _makeGalaxy(x,y,z) {
        for (let i=0;i<3;i++) {
            const m=new THREE.Mesh(new THREE.CircleGeometry(1800+i*600,24),
                new THREE.MeshBasicMaterial({color:[0x884499,0x3344aa,0x225588][i],transparent:true,
                    opacity:0.07-i*0.015,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));
            m.position.set(x,y+i*30,z);
            m.rotation.x=-Math.PI/2+(Math.random()-0.5)*0.3;
            m.rotation.z=Math.random()*Math.PI;
            GAME.scene.add(m);
        }
    }

    // ── ASTEROID GEOMETRY — smooth icosphere + coherent sine displacement ─────
    function _makeAsteroidGeo(size, seed) {
        // IcosahedronGeometry detail=3 gives 1280 smooth faces — no spiky tangles
        const geo  = new THREE.IcosahedronGeometry(size, 3);
        const pos  = geo.attributes.position;
        const s    = seed || Math.random()*100;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            // Coherent noise using overlapping sin waves — smooth lumps, no spikes
            const n = 1.0
                + 0.22 * Math.sin(x*0.10 + s)     * Math.cos(z*0.10)
                + 0.14 * Math.sin(y*0.14 + s*1.3) * Math.cos(x*0.08)
                + 0.09 * Math.sin(z*0.12 + s*0.7) * Math.cos(y*0.11)
                + 0.05 * Math.sin((x+y)*0.07);
            pos.setXYZ(i, x*n, y*n, z*n);
        }
        geo.computeVertexNormals();
        return geo;
    }

    // ── SHIP MESHES — 6 distinct class designs ───────────────────────────────
    function createShipMesh(factionId, shipClassId) {
        const col    = factionId ? FACTIONS[factionId].color : 0xffffff;
        const cls    = shipClassId || 'ASSAULT';
        const clsCol = SHIP_CLASSES[cls] ? SHIP_CLASSES[cls].color : col;
        const accentCol = factionId ? col : clsCol;

        const mHull  = () => new THREE.MeshStandardMaterial({ color:0x1c1c28, roughness:0.55, metalness:0.92 });
        const mDark  = () => new THREE.MeshStandardMaterial({ color:0x111118, roughness:0.7,  metalness:0.90 });
        const mAcc   = () => new THREE.MeshStandardMaterial({ color:accentCol, emissive:accentCol, emissiveIntensity:0.6, roughness:0.2, metalness:0.9 });
        const mGlow  = () => new THREE.MeshStandardMaterial({ color:accentCol, emissive:accentCol, emissiveIntensity:2.8 });
        const mGlass = () => new THREE.MeshStandardMaterial({ color:0x1a3355, emissive:0x0a1a33, emissiveIntensity:0.9, transparent:true, opacity:0.82, roughness:0 });
        const mHvy   = () => new THREE.MeshStandardMaterial({ color:0x252535, roughness:0.5, metalness:0.95 });

        const group = new THREE.Group();
        const V2 = (r,y) => new THREE.Vector2(r,y);

        switch (cls) {

            case 'FIGHTER': {
                // Needle-nosed interceptor — very swept, aggressive
                const fGeo = new THREE.LatheGeometry([V2(0,-38),V2(1,-32),V2(3.5,-18),V2(6,-5),V2(7,6),V2(6.5,18),V2(5,28)], 14);
                fGeo.rotateX(Math.PI/2);
                group.add(_m(fGeo, mHull()));
                // Twin swept delta wings
                for (const s of [-1,1]) {
                    const wv = new Float32Array([s*6,-2,-22, s*42,-2,14, s*6,-2,20]);
                    const wg = new THREE.BufferGeometry(); wg.setAttribute('position',new THREE.BufferAttribute(wv,3)); wg.computeVertexNormals();
                    group.add(_m(wg, mDark())); 
                    const wv2 = new Float32Array([s*6,-3,-22, s*42,-3,14, s*6,-3,20]);
                    const wg2 = new THREE.BufferGeometry(); wg2.setAttribute('position',new THREE.BufferAttribute(wv2,3)); wg2.computeVertexNormals();
                    group.add(_m(wg2, mDark()));
                    const tip=_m(new THREE.BoxGeometry(3,1.5,10),mAcc()); tip.position.set(s*40,-2,10); group.add(tip);
                }
                // Twin cannons on nose
                for (const s of [-1,1]) { const c=_m(new THREE.CylinderGeometry(1.2,1.2,16,8),mDark()); c.rotation.x=Math.PI/2; c.position.set(s*3.5,0,-42); group.add(c); }
                const spine=_m(new THREE.BoxGeometry(2,1.5,42),mAcc()); spine.position.y=7.5; group.add(spine);
                const cock=_m(new THREE.SphereGeometry(4,10,8,0,Math.PI*2,0,Math.PI/1.6),mGlass()); cock.scale.z=2.4; cock.position.set(0,7,-8); group.add(cock);
                for(const s of[-1,1]){const p=_m(new THREE.CylinderGeometry(3,4,18,10),mDark()); p.rotation.x=Math.PI/2; p.position.set(s*6.5,-1.5,22); group.add(p); const n=_m(new THREE.CylinderGeometry(3.2,3.2,4,10),mGlow()); n.rotation.x=Math.PI/2; n.position.set(s*6.5,-1.5,31); n.userData.isEngine=true; group.add(n);}
                break;
            }

            case 'ASSAULT': {
                // Standard balanced fighter
                const prof=[V2(0,-34),V2(1.5,-30),V2(4.5,-20),V2(7.5,-8),V2(8.5,0),V2(8.0,12),V2(6.5,24),V2(5.5,32)];
                const fGeo=new THREE.LatheGeometry(prof,16); fGeo.rotateX(Math.PI/2);
                group.add(_m(fGeo,mHull()));
                const cock=_m(new THREE.SphereGeometry(5.5,14,10,0,Math.PI*2,0,Math.PI/1.8),mGlass()); cock.scale.z=2.2; cock.position.set(0,8,-9); group.add(cock);
                // Wings using flat boxes — visible from both sides, no missing geometry
                for(const s of[-1,1]){
                    const wInner=_m(new THREE.BoxGeometry(22,1.8,34),mDark()); wInner.position.set(s*18,-2.5,5); group.add(wInner);
                    const wOuter=_m(new THREE.BoxGeometry(14,1.5,22),mDark()); wOuter.position.set(s*34,-2.8,2); wOuter.rotation.y=s*0.18; group.add(wOuter);
                    const tip=_m(new THREE.BoxGeometry(3.5,1.5,13),mAcc()); tip.position.set(s*40,-2.8,4); group.add(tip);
                }
                const spine=_m(new THREE.BoxGeometry(2.5,1.5,46),mAcc()); spine.position.y=8.8; group.add(spine);
                for(const s of[-1,1]){const p=_m(new THREE.CylinderGeometry(3.5,4.8,22,12),mDark()); p.rotation.x=Math.PI/2; p.position.set(s*7.5,-2,25); group.add(p); const n=_m(new THREE.CylinderGeometry(3.8,3.8,5,12),mGlow()); n.rotation.x=Math.PI/2; n.position.set(s*7.5,-2,35.5); n.userData.isEngine=true; group.add(n);}
                break;
            }

            case 'SCOUT': {
                // Ultra-slim dart — tiny, fast-looking
                const prof=[V2(0,-42),V2(0.8,-36),V2(2.5,-20),V2(4.5,-5),V2(5,5),V2(4.5,16),V2(3.5,26)];
                const fGeo=new THREE.LatheGeometry(prof,12); fGeo.rotateX(Math.PI/2);
                group.add(_m(fGeo,mHull()));
                // Tiny stub wings
                for(const s of[-1,1]){
                    const wing=_m(new THREE.BoxGeometry(22,1.2,14),mDark()); wing.position.set(s*14,-1.5,8); group.add(wing);
                    const tip=_m(new THREE.BoxGeometry(3,1.2,8),mAcc()); tip.position.set(s*24,-1.5,8); group.add(tip);
                }
                // Long thin dorsal fin
                const fin=_m(new THREE.BoxGeometry(1.5,8,32),mAcc()); fin.position.set(0,7,4); group.add(fin);
                const cock=_m(new THREE.SphereGeometry(3.5,10,8,0,Math.PI*2,0,Math.PI/1.6),mGlass()); cock.scale.z=2.8; cock.position.set(0,6,-10); group.add(cock);
                // Single central engine
                const p=_m(new THREE.CylinderGeometry(4,5.5,16,12),mDark()); p.rotation.x=Math.PI/2; p.position.set(0,0,22); group.add(p);
                const n=_m(new THREE.CylinderGeometry(4.2,4.2,5,12),mGlow()); n.rotation.x=Math.PI/2; n.position.set(0,0,30); n.userData.isEngine=true; group.add(n);
                break;
            }

            case 'CARRIER': {
                // Elongated flat-deck carrier — long wide hull, support struts
                // Main hull — long flat body
                const hull = _m(new THREE.BoxGeometry(20, 6, 64), mHvy()); group.add(hull);
                // Raised flight deck on top — flat wide platform
                const deck = _m(new THREE.BoxGeometry(34, 2, 56), mHull()); deck.position.y = 4; group.add(deck);
                // Deck accent stripe
                const stripe = _m(new THREE.BoxGeometry(36, 0.5, 54), mAcc()); stripe.position.y = 5.5; group.add(stripe);
                // Medical cross on deck (large, visible)
                const ch = _m(new THREE.BoxGeometry(28, 1, 5), mAcc()); ch.position.set(0,6,0); group.add(ch);
                const cv = _m(new THREE.BoxGeometry(5, 1, 28), mAcc()); cv.position.set(0,6,0); group.add(cv);
                // Side support struts — 3 per side
                for (const s of [-1,1]) {
                    for (const oz of [-18,0,18]) {
                        const strut = _m(new THREE.BoxGeometry(8,8,10), mDark());
                        strut.position.set(s*20,0,oz); group.add(strut);
                    }
                    // Outer hull edge
                    const edge = _m(new THREE.BoxGeometry(4,6,60), mAcc());
                    edge.position.set(s*25,0,0); group.add(edge);
                }
                // Bridge tower mid-rear
                const bridge = _m(new THREE.BoxGeometry(10,12,14), mHull()); bridge.position.set(0,9,12); group.add(bridge);
                const cock = _m(new THREE.BoxGeometry(8,5,10), mGlass()); cock.position.set(0,15,12); group.add(cock);
                // 4 rear engines
                for (const [sx,sz] of [[-7,28],[7,28],[-7,34],[7,34]]) {
                    const ep = _m(new THREE.CylinderGeometry(4.5,5.5,16,10), mDark());
                    ep.rotation.x = Math.PI/2; ep.position.set(sx,-1,sz); group.add(ep);
                    const en = _m(new THREE.CylinderGeometry(4.5,4.5,5,10), mGlow());
                    en.rotation.x = Math.PI/2; en.position.set(sx,-1,sz+11);
                    en.userData.isEngine = true; group.add(en);
                }
                break;
            }

            case 'ENGINEER': {
                // Utilitarian workhorse — boxy with crane arm and tools
                const prof=[V2(0,-22),V2(4,-16),V2(9,-6),V2(10,4),V2(10,14),V2(8,24),V2(6,30)];
                const fGeo=new THREE.LatheGeometry(prof,8); fGeo.rotateX(Math.PI/2);
                group.add(_m(fGeo,mHull()));
                // Boxy body pod on underside
                const pod=_m(new THREE.BoxGeometry(16,8,28),mDark()); pod.position.set(0,-8,4); group.add(pod);
                // Construction arm on right
                const arm=_m(new THREE.BoxGeometry(3,3,28),mAcc()); arm.position.set(16,4,0); arm.rotation.z=-0.3; group.add(arm);
                const claw=_m(new THREE.BoxGeometry(8,8,6),mAcc()); claw.position.set(21,2,-12); group.add(claw);
                // Flat stubby wings
                for(const s of[-1,1]){
                    const wing=_m(new THREE.BoxGeometry(24,3,20),mDark()); wing.position.set(s*18,-2,4); group.add(wing);
                    const tip=_m(new THREE.BoxGeometry(4,3,12),mAcc()); tip.position.set(s*29,-2,4); group.add(tip);
                }
                const cock=_m(new THREE.BoxGeometry(9,6,10),mGlass()); cock.position.set(0,11,-8); group.add(cock);
                for(const s of[-1,1]){const p=_m(new THREE.CylinderGeometry(4,5,18,10),mDark()); p.rotation.x=Math.PI/2; p.position.set(s*7,0,24); group.add(p); const n=_m(new THREE.CylinderGeometry(4,4,5,10),mGlow()); n.rotation.x=Math.PI/2; n.position.set(s*7,0,33); n.userData.isEngine=true; group.add(n);}
                break;
            }

            case 'DREADNOUGHT': {
                // Flat rectangular brick warship — very different from carrier disc
                const hull = _m(new THREE.BoxGeometry(26, 9, 58), mHvy());
                group.add(hull);
                // Nose wedge
                const nGeo = new THREE.CylinderGeometry(0,13,18,4); nGeo.rotateX(Math.PI/2);
                const nose = _m(nGeo, mHvy()); nose.position.z = -38; group.add(nose);
                // Thick side armour slabs with gun rows
                for (const s of [-1,1]) {
                    const slab = _m(new THREE.BoxGeometry(16,12,46), mHull());
                    slab.position.set(s*20,1,0); group.add(slab);
                    for (const oz of [-14,0,14]) {
                        const trt = _m(new THREE.BoxGeometry(7,5,7), mDark());
                        trt.position.set(s*27,5,oz); group.add(trt);
                        const brl = _m(new THREE.CylinderGeometry(1.4,1.4,14,6), mDark());
                        brl.rotation.x = Math.PI/2; brl.position.set(s*27,5,oz-11); group.add(brl);
                        const muz = _m(new THREE.SphereGeometry(2.2,6,6), mGlow());
                        muz.position.set(s*27,5,oz-19); group.add(muz);
                    }
                    const tip = _m(new THREE.BoxGeometry(4,9,40), mAcc());
                    tip.position.set(s*31,1,0); group.add(tip);
                }
                // Bridge tower
                const bridge = _m(new THREE.BoxGeometry(14,10,18), mHull());
                bridge.position.set(0,9,-8); group.add(bridge);
                const cock = _m(new THREE.BoxGeometry(12,5,12), mGlass());
                cock.position.set(0,15,-8); group.add(cock);
                // 4 massive engines
                for (const [sx,sz] of [[-7,25],[7,25],[-7,31],[7,31]]) {
                    const ep = _m(new THREE.CylinderGeometry(6.5,8.5,22,8), mDark());
                    ep.rotation.x = Math.PI/2; ep.position.set(sx,-1,sz); group.add(ep);
                    const en = _m(new THREE.CylinderGeometry(6.5,6.5,7,8), mGlow());
                    en.rotation.x = Math.PI/2; en.position.set(sx,-1,sz+15);
                    en.userData.isEngine = true; group.add(en);
                }
                break;
            }
        }

        return group;
    }

    // ── TERRITORY NODE ────────────────────────────────────────────────────────
    function createNodeMesh(x, z) {
        const group = new THREE.Group();
        group.position.set(x, 0, z);

        // Platform — visible against space, with emissive edge
        const platform = _m(new THREE.CylinderGeometry(56, 60, 8, 6),
            new THREE.MeshStandardMaterial({ color:0x1a1a2e, roughness:0.5, metalness:0.9 }).clone());
        group.add(platform);

        // Glowing trim ring on top — clearly marks the node
        const trim = _m(new THREE.CylinderGeometry(58, 58, 2.5, 6),
            new THREE.MeshStandardMaterial({ color:0x224466, emissive:0x224466, emissiveIntensity:0.8, roughness:0.3 }).clone());
        trim.position.y = 5.5;
        group.add(trim);

        // Floor glow disc — additive blended halo at ground level
        const glowDisc = _m(new THREE.CircleGeometry(80, 24),
            new THREE.MeshBasicMaterial({ color:0x112244, transparent:true, opacity:0.35,
                side:THREE.DoubleSide, depthWrite:false, blending:THREE.AdditiveBlending }));
        glowDisc.rotation.x = -Math.PI/2;
        glowDisc.position.y = 0.5;
        group.add(glowDisc);

        // Capture radius ring — more visible
        const capRing = _m(new THREE.RingGeometry(CONFIG.CAPTURE_RADIUS - 7, CONFIG.CAPTURE_RADIUS, 54),
            new THREE.MeshBasicMaterial({ color:0x2255aa, side:THREE.DoubleSide,
                transparent:true, opacity:0.35, depthWrite:false }));
        capRing.rotation.x = -Math.PI/2;
        capRing.position.y = 1;
        group.add(capRing);

        // Central spire with emissive glow
        const spire = _m(new THREE.CylinderGeometry(1.8, 3.5, 54, 8),
            new THREE.MeshStandardMaterial({ color:0x2255aa, emissive:0x2255aa, emissiveIntensity:0.8, roughness:0.3 }).clone());
        spire.position.y = 31;
        group.add(spire);

        // Beacon orb — big and bright so it's visible from a distance
        const orb = _m(new THREE.SphereGeometry(13, 18, 18),
            new THREE.MeshStandardMaterial({ color:0x4488cc, emissive:0x2255aa, emissiveIntensity:1.8, roughness:0.05 }));
        orb.position.y = 60;
        group.add(orb);

        // Progress arc — filled clockwise from top as capture progresses
        // Starts invisible, updated by world.js
        const progressArc = new THREE.Mesh(
            new THREE.BufferGeometry(),
            new THREE.MeshBasicMaterial({
                color: 0xffffff, side: THREE.DoubleSide,
                transparent: true, opacity: 0.9,
                depthWrite: false, blending: THREE.AdditiveBlending,
            })
        );
        progressArc.position.y = 2;
        progressArc.visible = false;
        group.add(progressArc);

        group.userData = { platform, trim, ring:capRing, beacon:spire, orb, progressArc };
        return group;
    }

    // Build a partial ring arc geometry — progress 0-100, sweeps clockwise from top
    function buildProgressArcGeo(progress, radius) {
        const pct      = Math.max(0, Math.min(100, progress)) / 100;
        const segments = Math.max(1, Math.floor(pct * 56));
        const angle    = pct * Math.PI * 2;
        const inner    = radius - 10, outer = radius + 10;
        const verts    = [];
        const indices  = [];

        for (let i = 0; i <= segments; i++) {
            const a   = -Math.PI / 2 + (i / segments) * angle;
            const cos = Math.cos(a), sin = Math.sin(a);
            // XZ plane — y=0 so mesh lies flat without needing rotation
            verts.push(cos * inner, 0, sin * inner);
            verts.push(cos * outer, 0, sin * outer);
        }
        for (let i = 0; i < segments; i++) {
            const b = i * 2;
            indices.push(b, b+2, b+1,  b+1, b+2, b+3);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
        geo.setIndex(indices);
        return geo;
    }

    // ── RESOURCE ROCK — smooth icosphere, group at world pos ─────────────────
    function createResourceMesh(x, z) {
        const group = new THREE.Group();
        group.position.set(x, 0, z);  // group at world pos, children at local (0,0)

        const size = 40 + Math.random()*30;
        const seed = Math.random()*200;

        const mRock = new THREE.MeshStandardMaterial({ color:0x252030, roughness:0.92, metalness:0.06 });
        const rock  = _m(_makeAsteroidGeo(size, seed), mRock);
        rock.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
        group.add(rock);  // local (0,0,0)

        // Crystal veins — positioned at LOCAL offsets
        const mCrystal = new THREE.MeshStandardMaterial({
            color:0x00eeff, emissive:0x00aabb, emissiveIntensity:1.1,
            roughness:0.05, metalness:0.3, transparent:true, opacity:0.88
        });
        const cc = 2 + Math.floor(Math.random()*3);
        for (let i = 0; i < cc; i++) {
            const cs  = 7 + Math.random()*10;
            // Use a small smooth sphere for crystals, not jagged octahedron
            const cr  = _m(new THREE.SphereGeometry(cs, 8, 8), mCrystal);
            const ang = (i/cc)*Math.PI*2 + Math.random()*0.8;
            cr.position.set(
                Math.cos(ang)*size*0.55,
                Math.random()*size*0.3,
                Math.sin(ang)*size*0.55
            );
            cr.scale.set(1, 0.5+Math.random()*0.6, 0.7+Math.random()*0.5);
            group.add(cr);
        }

        group.userData = { size };
        return group;
    }

    // ── DECORATION ASTEROID — same smooth icosphere, just static scene deco ──
    function createDecAsteroid(x, y, z, size) {
        const seed = Math.random()*200;
        const mat  = new THREE.MeshStandardMaterial({ color:0x1e1828, roughness:0.94, metalness:0.04 });
        const mesh = _m(_makeAsteroidGeo(size, seed), mat);
        mesh.position.set(x, y, z);
        mesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
        GAME.scene.add(mesh);
    }

    function _m(geo, mat) { return new THREE.Mesh(geo, mat); }
    function render() { GAME.renderer.render(GAME.scene, GAME.camera); }

    return { init, render, createShipMesh, createNodeMesh, buildProgressArcGeo, createResourceMesh, createDecAsteroid };
})();
