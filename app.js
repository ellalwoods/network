'use strict';
/* Network (internally "rolo"): a personal network app.
   Data is stored on the device (IndexedDB) and, when signed in, synced to Supabase
   through the rolo_* functions (see supabase/rolo.sql). The login itself is never sent:
   only a SHA-256 hash of "rolo:" + the normalised login leaves the device. */

const CFG = window.ROLO_CONFIG || {};
const SYNC_ON = !!(CFG.supabaseUrl && CFG.supabaseKey);
const PROJECT = ((CFG.supabaseUrl||'').match(/https:\/\/([^.]+)\./)||[])[1] || '';

/* ---------- constants ---------- */
const PALETTE = [
  {id:'kwm',    firm:'Mallesons',            name:'Periwinkle',    hex:'#CCCCFE'},
  {id:'kwm2',   firm:'Mallesons',            name:'Blackcurrant',  hex:'#33203F'},
  {id:'apc',    firm:'Ashurst Perkins Coie', name:'Liberty green', hex:'#3DE3B9'},
  {id:'apc2',   firm:'Ashurst Perkins Coie', name:'Deep teal',     hex:'#002D3B'},
  {id:'ash',    firm:'Ashurst (prior)',      name:'Peach',         hex:'#F98D72'},
  {id:'allens', firm:'Allens',               name:'Magenta',       hex:'#AF005F'},
  {id:'hsf',    firm:'HSF Kramer',           name:'Teal',          hex:'#40AAB8'},
];
const PLANETS = [['Mercury',3],['Venus',5],['Earth',5.5],['Mars',4],['Jupiter',10],['Saturn',8.5],['Uranus',7],['Neptune',7]];
const CONS = ['Crux','Orion','Lyra','Cygnus','Carina','Centaurus','Scorpius','Pegasus'];
const CON_PTS = [[[17,3],[17,22],[9,11],[25,11],[21,18]],[[9,4],[25,5],[14,13],[17,13],[20,13],[10,22],[24,21]],[[17,4],[13,12],[21,12],[12,21],[22,21]],[[17,3],[17,23],[7,9],[27,9],[17,13]],[[5,18],[12,14],[19,15],[26,8],[29,20]],[[6,6],[12,12],[18,10],[24,16],[28,22],[16,21]],[[6,5],[11,9],[15,14],[19,19],[24,21],[29,17]],[[8,6],[26,6],[8,20],[26,20],[3,12]]];
const RINGS = ['Inner','Middle','Outer'];
const FIRMS = ['Allens','Ashurst Perkins Coie','Clayton Utz','Herbert Smith Freehills Kramer','King & Wood Mallesons','MinterEllison'];
const DAY = 864e5;
const NOGROUP = '#B5B3AC';

/* ---------- small helpers ---------- */
const $ = s => document.querySelector(s);
const now = () => Date.now();
const uid = () => Math.random().toString(36).slice(2,9) + now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(3,'0');
const norm = s => s.trim().toLowerCase().replace(/\s+/g,' ');
const titleCase = s => s.trim().replace(/\s+/g,' ').replace(/\b\p{L}/gu, c => c.toUpperCase());
const fmtDate = t => new Date(t).toLocaleDateString('en-AU',{day:'2-digit',month:'short'});
const ini = p => (((p.first||'')[0]||'') + ((p.last||'')[0]||'')).toUpperCase() || '?';
const fullName = p => [p.first,p.last].filter(Boolean).join(' ');

/* ---------- colour system ---------- */
const lum = h => { const [r,g,b]=[1,3,5].map(i=>parseInt(h.substr(i,2),16)/255); return .2126*r+.7152*g+.0722*b };
const onC = h => lum(h) > .55 ? '#111110' : '#FBFAF7';
const mixP = (h,t) => '#'+[1,3,5].map((i,k)=>Math.round(parseInt(h.substr(i,2),16)*t+[0xF3,0xF2,0xEE][k]*(1-t)).toString(16).padStart(2,'0')).join('');
const darkHue = hex => { let [r,g,b]=[1,3,5].map(i=>parseInt(hex.substr(i,2),16)/255); const mx=Math.max(r,g,b), mn=Math.min(r,g,b); let h=0,sat=0; const l=(mx+mn)/2;
  if(mx!==mn){ const d=mx-mn; sat=l>.5?d/(2-mx-mn):d/(mx+mn); h=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4; h/=6 }
  sat=Math.min(sat,.62); const L=.27, q=L<.5?L*(1+sat):L+sat-L*sat, pp=2*L-q;
  const f=t=>{ if(t<0)t+=1; if(t>1)t-=1; return t<1/6?pp+(q-pp)*6*t:t<.5?q:t<2/3?pp+(q-pp)*(2/3-t)*6:pp };
  return '#'+[h+1/3,h,h-1/3].map(t=>Math.round(f(t)*255).toString(16).padStart(2,'0')).join('') };
// Each colour has a tonal range: wash (faded) -> soft -> base (bright) -> deep (text)
const tones = h => { const L=lum(h); return { wash:mixP(h,.13), soft:mixP(h,L>.6?.55:.32), base:h, deep:L<.12?h:darkHue(h) } };

/* ---------- storage (IndexedDB key/value) ---------- */
const idb = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res,rej) => { const r = indexedDB.open('rolo',1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) }));
  const tx = (mode,fn) => open().then(db => new Promise((res,rej) => { const t = db.transaction('kv',mode); const out = fn(t.objectStore('kv'));
    t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error) }));
  return { get:k=>tx('readonly',s=>s.get(k)), set:(k,v)=>tx('readwrite',s=>{s.put(v,k)}), del:k=>tx('readwrite',s=>{s.delete(k)}),
           keys:()=>tx('readonly',s=>s.getAllKeys()), clear:()=>tx('readwrite',s=>{s.clear()}) };
})();

/* ---------- state ---------- */
const blank = () => ({v:1, people:[], groups:[], log:[], plans:[], sets:[], deleted:{}, settings:{colour:false,u:0}});
let D = blank();          // synced document
let PH = {};              // person id -> {d: dataURL|null, t: updated ms}
let acct = null;          // {label, key}; label stays on this device only
const sync = {state: SYNC_ON ? 'idle' : 'off', last: 0, err: ''};
const ui = {view:'people', filter:'all', q:'', lq:'', person:null, fc:null, cardDeck:'all', navList:null, psel:new Set(), pq:'',
            sort: localStorage.getItem('rolo-sort') || 'az', layout: localStorage.getItem('rolo-layout') || 'list',
            login:{name:'', planet:null, con:null, mode:'signin', busy:false, msg:'', pending:null},
            sel:new Set(), ring:3, photo:undefined, gcolour:'kwm'};

const colourOn = () => !!D.settings.colour;
const G = id => D.groups.find(g => g.id === id);
const P = id => D.people.find(p => p.id === id);
const pal = id => PALETTE.find(x => x.id === id) || PALETTE[0];
const gHex = g => g ? pal(g.pc).hex : NOGROUP;
const pHex = p => gHex(G((p.groups||[]).find(id => G(id))));
const inG = gid => D.people.filter(p => (p.groups||[]).includes(gid));
const touch = x => { x.u = now(); return x };

function commit(){ idb.set('data', D); render(); schedulePush() }

/* ---------- photos ---------- */
// Face-centred photos: the bundled MediaPipe face detector (vendor/mediapipe) finds the face on this device,
// and the photo is cropped to a square around it, so every little circle shows the face.
let faceDet = null;
async function findFace(img){
  try{
    if(!faceDet){
      const v = await import('./vendor/mediapipe/vision_bundle.mjs');
      const files = await v.FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm', location.href).href);
      faceDet = await v.FaceDetector.createFromOptions(files, {baseOptions:{modelAssetPath:new URL('vendor/mediapipe/blaze_face_short_range.tflite', location.href).href}, runningMode:'IMAGE', minDetectionConfidence:.5});
    }
    const best = r => (r.detections || []).map(d => ({...d.boundingBox, score:(d.categories&&d.categories[0]&&d.categories[0].score)||0})).sort((a,b) => b.width*b.height - a.width*a.height)[0];
    let f = best(faceDet.detect(img)); if(f) return f;
    // the model is tuned for close-ups, so if the face is small, look again in zoomed-in, overlapping windows
    const W = img.naturalWidth, H = img.naturalHeight, c = document.createElement('canvas'), ctx = c.getContext('2d');
    for(const frac of [.5, .33]){
      const s = Math.round(Math.min(W,H) * frac * (W > H ? 1.2 : 1)), step = s * .5; let found = null;
      for(let y = 0; y + s <= H + 1 && !found; y += step) for(let x = 0; x + s <= W + 1; x += step){
        const w = Math.min(s, W - x), h = Math.min(s, H - y); c.width = w; c.height = h; ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
        const g = best(faceDet.detect(c)); if(g && (!found || g.score > found.score)) found = {...g, originX:g.originX + x, originY:g.originY + y};
      }
      if(found) return found;
    }
    return null;
  }catch(e){ console.warn('face detection unavailable', e); return null }
}
function cropBox(W, H, f){
  if(!f) { const s = Math.min(W,H); return {sx:(W-s)/2, sy:(H-s)*.3, s} }            // no face found: centre, slightly high
  let s = Math.min(Math.max(f.width, f.height) * 2.3, W, H);                          // head and a little shoulder
  const cx = f.originX + f.width/2, cy = f.originY + f.height*.58;
  return {sx: Math.max(0, Math.min(W - s, cx - s/2)), sy: Math.max(0, Math.min(H - s, cy - s/2)), s};
}
const loadImg = src => new Promise((res,rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image')); i.src = src });
async function cropToFace(img){
  const W = img.naturalWidth, H = img.naturalHeight, f = await findFace(img), {sx, sy, s} = cropBox(W, H, f);
  const S = 420, c = document.createElement('canvas'); c.width = c.height = S;
  c.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, S, S);
  return {d: c.toDataURL('image/jpeg', .84), face: !!f};
}
async function compress(file){
  const url = URL.createObjectURL(file);
  try{ return (await cropToFace(await loadImg(url))).d } finally { URL.revokeObjectURL(url) }
}
async function recentrePhotos(){
  const ids = Object.keys(PH).filter(id => PH[id] && PH[id].d && P(id)); if(!ids.length) return toast('No photos yet');
  toast('Finding faces…'); let n = 0;
  for(const id of ids){ const img = await loadImg(PH[id].d), f = await findFace(img); if(!f) continue;
    const {s} = cropBox(img.naturalWidth, img.naturalHeight, f); if(s > img.naturalWidth * .92) continue;   // already framed on the face
    setPhoto(id, (await cropToFace(img)).d); n++ }
  commit(); toast(n ? `Centred ${n} photo${n>1?'s':''} on faces` : 'Photos already look centred');
}
function setPhoto(id, d){ PH[id] = {d, t:now()}; idb.set('ph:'+id, PH[id]) }
const photoOf = p => PH[p.id] && PH[p.id].d;

/* ---------- sync ---------- */
async function rpc(fn, args){
  const r = await fetch(`${CFG.supabaseUrl.replace(/\/$/,'')}/rest/v1/rpc/${fn}`, {method:'POST',
    headers:{apikey:CFG.supabaseKey, ...(CFG.supabaseKey.startsWith('eyJ') ? {Authorization:'Bearer '+CFG.supabaseKey} : {}), 'Content-Type':'application/json'}, body:JSON.stringify(args)});
  if(r.status === 404){ console.warn('rpc 404', fn, await r.text()); throw new Error('NOT_SETUP') }
  if(!r.ok) throw new Error((await r.text()).slice(0,200) || r.statusText);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');

function mergeList(a, b, del){
  const m = new Map();
  for(const x of [...(a||[]), ...(b||[])]){ const o = m.get(x.id); if(!o || (x.u||0) > (o.u||0)) m.set(x.id, x) }
  return [...m.values()].filter(x => !(del[x.id] && del[x.id] >= (x.u||0)));
}
function merge(L, R){
  const del = {...(R.deleted||{})};
  for(const [k,v] of Object.entries(L.deleted||{})) del[k] = Math.max(v, del[k]||0);
  return {v:1, deleted:del, people:mergeList(L.people,R.people,del), groups:mergeList(L.groups,R.groups,del), log:mergeList(L.log,R.log,del), plans:mergeList(L.plans,R.plans,del), sets:mergeList(L.sets,R.sets,del),
          settings: ((R.settings&&R.settings.u)||0) > ((L.settings&&L.settings.u)||0) ? R.settings : (L.settings||blank().settings)};
}

let pushT = null, syncing = false, again = false;
function schedulePush(){ if(!acct || !SYNC_ON) return; clearTimeout(pushT); pushT = setTimeout(syncNow, 1200) }
async function syncNow(){
  if(!acct || !SYNC_ON) return;
  if(syncing){ again = true; return }
  syncing = true; sync.state = 'syncing'; paintSync();
  const key = acct.key;
  try{
    const remote = await rpc('rolo_load', {p_key:key});
    if(remote) D = merge(D, remote);
    await rpc('rolo_save', {p_key:key, p_data:D});
    await idb.set('data', D);
    const list = await rpc('rolo_photo_list', {p_key:key}) || [];
    const rmap = new Map(list.map(r => [r.person_id, Number(r.updated)]));
    for(const [id, rt] of rmap){
      const l = PH[id];
      if(!l || l.t < rt){ const d = await rpc('rolo_photo_get', {p_key:key, p_person:id}); PH[id] = {d, t:rt}; await idb.set('ph:'+id, PH[id]) }
    }
    for(const [id, l] of Object.entries(PH)){
      const rt = rmap.get(id);
      if((rt === undefined && l.d) || (rt !== undefined && l.t > rt))
        await rpc('rolo_photo_put', {p_key:key, p_person:id, p_data:l.d, p_updated:l.t});
    }
    sync.state = 'ok'; sync.last = now(); sync.err = '';
  }catch(e){
    sync.state = 'error';
    sync.err = e.message === 'NOT_SETUP' ? `Supabase project “${PROJECT}” doesn’t have Network’s tables yet. Your changes are safe on this device.` : 'Couldn’t reach the sync server. Your changes are safe on this device and will sync later.';
    console.warn('sync', e);
  }
  syncing = false; softRender();
  if(again){ again = false; syncNow() }
}
function paintSync(){ const el = $('#syncdot'); if(el) el.dataset.s = sync.state }

/* ---------- navigation ---------- */
const NAV = [['people','People'],['plans','Plans'],['log','Log'],['orbit','Orbit'],['groups','Groups']];
function go(v){ ui.view = v; render(); window.scrollTo(0,0) }
function openPerson(id){ ui.person = id; go('person') }
function setFilter(f){ ui.filter = f; render() }
function openOrbitGroups(){
  sheet(`<div class="title">Groups in<br>your orbit</div><p class="intro grey" style="padding-top:0">Adding a group puts everyone in it on your orbit. You can still remove individual people from their page.</p>
    ${D.groups.map(g => `<div class="set"><div><b>${esc(g.name)}</b><small>${inG(g.id).length} people</small></div><button class="tog ${g.orbit?'on':''}" role="switch" aria-checked="${!!g.orbit}" aria-label="Show ${esc(g.name)} in orbit" onclick="setGroupOrbit('${g.id}',${!g.orbit});openOrbitGroups()"><i></i></button></div>`).join('') || '<p class="emptyrow grey">No groups yet.</p>'}
    <div class="sheetbtns" style="grid-template-columns:1fr"><button onclick="closeSheet()">Done</button></div>`);
}

function renderNav(){
  const v = ['person','cards','set'].includes(ui.view) ? 'people' : ui.view;
  const sw = g => colourOn() ? `<i class="sw" style="background:${gHex(g)}"></i>` : '';
  $('#side').innerHTML =
    `<div class="brand">Network<span id="syncdot" data-s="${sync.state}" title="Sync status"></span></div>` +
    NAV.map(([k,l],i) => `<button class="navbtn ${v===k?'on':''}" onclick="go('${k}')"><span>${l}</span><span>0${i+1}</span></button>`).join('') +
    `<div class="mono grey" style="padding:22px 20px 8px">Groups</div>` +
    D.groups.map(g => `<button class="grp" onclick="ui.filter='${g.id}';go('people')"><span>${sw(g)}${esc(g.name)}</span><span>${pad(inG(g.id).length)}</span></button>`).join('') +
    `<button class="grp grey" onclick="openGroupSheet()"><span>+ New group</span><span></span></button>` +
    `<button class="navbtn ${v==='settings'?'on':''}" style="margin-top:auto;border-top:1px solid var(--soft)" onclick="go('settings')"><span>Settings</span><span>06</span></button>` +
    `<button class="newbtn" onclick="openAdd()">+ Add</button>`;
  $('#tabbar').innerHTML = NAV.slice(0,4).map(([k,l]) => `<button class="${v===k?'on':''}" onclick="go('${k}')">${l}</button>`).join('') +
    `<button class="add" onclick="openAdd()" aria-label="Add">+</button>`;
  $('#tabbar').style.display = ui.view === 'login' ? 'none' : '';
}

/* ---------- shared fragments ---------- */
function faceBox(p, cls, extraStyle=''){
  const d = photoOf(p), t = tones(pHex(p));
  const style = colourOn() ? `background:${t.soft};color:${t.deep};` : '';
  return `<div class="${cls}" style="${style}${extraStyle}">${d ? `<img src="${d}" alt="">` : esc(ini(p))}</div>`;
}
const row = (p, n, right='') => `<button class="ent" onclick="openPerson('${p.id}')"><span class="n">${pad(n)}</span>${faceBox(p,'ph')}<div style="min-width:0"><b>${esc(fullName(p))}</b><small>${esc([p.role,p.team,p.firm].filter(Boolean).join(' / ') || '—')}</small></div>${right}</button>`;
const groupFilters = (cur, fn, extra='') => `<div class="filters"><button class="${cur==='all'?'on':''}" onclick="${fn}('all')">All</button>${D.groups.map(g => `<button class="${cur===g.id?'on':''}" onclick="${fn}('${g.id}')">${colourOn()?`<i class="sw" style="background:${gHex(g)}"></i>`:''}${esc(g.short||g.name)}</button>`).join('')}${extra}</div>`;
const today = () => new Date().toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'});

/* ---------- orbit ---------- */
// Orbit is opt-in: a person shows if added individually, or if one of their groups is added (unless removed individually)
const viaGroup = p => (p.groups||[]).some(id => G(id) && G(id).orbit);
const inOrbit = p => !isProspect(p) && (p.orbit === true || (p.orbit !== false && viaGroup(p)));
const orbitPeople = () => D.people.filter(inOrbit);
const secOf = p => (p.groups||[]).find(id => G(id) && G(id).orbit) || (p.groups||[]).find(id => G(id)) || '_none';
function sectors(){
  const used = new Set(orbitPeople().map(secOf));
  const s = D.groups.filter(g => used.has(g.id));
  if(used.has('_none')) s.push({id:'_none', name:'No group', short:'Other', pc:null});
  return s;
}
function setOrbit(pid, on){ const p = P(pid); p.orbit = on; if(on && !p.ring) p.ring = 3; touch(p); commit(); toast(on ? `${p.first} added to your orbit` : `${p.first} removed from your orbit`) }
function setGroupOrbit(gid, on){ const g = G(gid); g.orbit = on; touch(g); commit(); toast(on ? `${g.name} added to your orbit` : `${g.name} removed from your orbit`) }
function orbitSVG(){
  const C=210, R={1:78,2:132,3:186}, secs=sectors(), n=Math.max(secs.length,1), step=2*Math.PI/n, start=-Math.PI/2, col=colourOn();
  const dimG = id => ui.filter !== 'all' && ui.filter !== id;
  let s = `<svg class="orbit" viewBox="-64 -14 548 448" font-family="JetBrains Mono, monospace" role="img" aria-label="Orbit map of your network"><defs>`, body = '';
  if(col) secs.forEach((g,gi) => {
    const w = tones(g.pc ? gHex(g) : NOGROUP).wash, op = dimG(g.id) ? .35 : 1;
    if(n === 1){ body += `<circle cx="${C}" cy="${C}" r="196" fill="${w}"/>`; return }
    const a0=start+gi*step, a1=a0+step, pt=(r,a)=>`${(C+r*Math.cos(a)).toFixed(1)} ${(C+r*Math.sin(a)).toFixed(1)}`, big=step>Math.PI?1:0;
    body += `<path d="M${pt(30,a0)} L${pt(196,a0)} A196 196 0 ${big} 1 ${pt(196,a1)} L${pt(30,a1)} A30 30 0 ${big} 0 ${pt(30,a0)}Z" fill="${w}" opacity="${op}"/>`;
  });
  [R[1],R[2],R[3]].forEach(r => body += `<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="#8C8B86" stroke-width=".6" stroke-dasharray="2 4"/>`);
  secs.forEach((g,gi) => {
    const a = start+gi*step;
    if(n > 1) body += `<line x1="${C+34*Math.cos(a)}" y1="${C+34*Math.sin(a)}" x2="${C+204*Math.cos(a)}" y2="${C+204*Math.sin(a)}" stroke="#D9D7D0" stroke-width=".8"/>`;
    const m = n > 1 ? a+step/2 : start, cx = Math.cos(m), lx = C+212*cx, ly = C+(n>1?212:214)*Math.sin(m), anchor = cx > .35 ? 'start' : cx < -.35 ? 'end' : 'middle';
    const label = (g.short||g.name).toUpperCase().slice(0,16);
    body += `<text x="${lx}" y="${ly}" font-size="9" letter-spacing=".8" text-anchor="${anchor}" dominant-baseline="middle" fill="${col?tones(g.pc?gHex(g):NOGROUP).deep:'#111110'}" font-weight="${col?600:400}" opacity="${dimG(g.id)?.25:1}" style="cursor:pointer" onclick="setFilter(ui.filter==='${g.id}'?'all':'${g.id}')">${esc(label)}</text>`;
  });
  body += `<circle cx="${C}" cy="${C}" r="24" fill="#111110"/><text x="${C}" y="${C+1}" font-size="9" letter-spacing="1" text-anchor="middle" dominant-baseline="middle" fill="#FBFAF7">YOU</text>`;
  secs.forEach((g,gi) => [1,2,3].forEach(ring => {
    const ps = D.people.filter(p => inOrbit(p) && secOf(p) === g.id && (p.ring||3) === ring).sort((a,b) => (a.n||0)-(b.n||0));
    const rr = Math.max(8, Math.min(15, (R[ring]*step)/(ps.length+1)/(ps.length > 6 ? 1.5 : 2.3)));
    ps.forEach((p,k) => {
      const crowd = ps.length > 6, rad = R[ring] + (crowd ? (k%2 ? -14 : 10) * (ring===1 ? .6 : 1) : 0);
      const a = start+gi*step+step*(k+1)/(ps.length+1), x = +(C+rad*Math.cos(a)).toFixed(1), y = +(C+rad*Math.sin(a)).toFixed(1);
      const dim = ui.filter !== 'all' && !(p.groups||[]).includes(ui.filter) && !(ui.filter==='_none' && g.id==='_none');
      const t = tones(pHex(p)), d = photoOf(p);
      const fill = col ? [0,t.base,t.soft,'#FBFAF7'][ring] : '#FBFAF7';
      const txt = col ? (ring===1 ? onC(t.base) : t.deep) : '#111110';
      const stroke = col ? (ring===1 ? t.deep : t.base) : '#111110';
      let face;
      if(d){ s += `<clipPath id="c${p.id}"><circle cx="${x}" cy="${y}" r="${rr}"/></clipPath>`;
        face = `<image href="${d}" x="${x-rr}" y="${y-rr}" width="${rr*2}" height="${rr*2}" clip-path="url(#c${p.id})" preserveAspectRatio="xMidYMid slice" opacity="${ring===3?.7:1}"/><circle cx="${x}" cy="${y}" r="${rr}" fill="none" stroke="${stroke}" stroke-width="${col?(ring===1?2.4:1.6):1}"/>`;
      } else face = `<circle class="face" cx="${x}" cy="${y}" r="${rr}" fill="${fill}" stroke="${stroke}" stroke-width="${col?1.2:1}"/><text class="ini" x="${x}" y="${y+.5}" font-size="${(rr*.6).toFixed(1)}" font-family="Archivo Black, sans-serif" text-anchor="middle" dominant-baseline="middle" fill="${txt}">${esc(ini(p))}</text>`;
      body += `<g class="node ${dim?'dim':''}" onclick="openPerson('${p.id}')"><title>${esc(fullName(p))}</title>${face}
        ${rr >= 11 && ps.length <= 6 ? `<text x="${x}" y="${y+rr+11}" font-size="8" text-anchor="middle" fill="#8C8B86">${esc((p.first||'').toUpperCase().slice(0,12))}</text>` : ''}</g>`;
    });
  }));
  return s + `</defs>` + body + `</svg>`;
}

/* ---------- views ---------- */
const views = {};

/* ---------- people helpers ---------- */
const entriesFor = pid => D.log.filter(e => (e.people||[]).includes(pid)).sort((a,b) => b.t - a.t);
function lastEntryMap(){ const m = {}; for(const e of D.log) for(const pid of e.people||[]) if(!m[pid] || m[pid].t < e.t) m[pid] = e; return m }
const lastAct = (p, m) => Math.max(p.created||0, (m[p.id]||{}).t||0);
const monthName = t => new Date(t).toLocaleDateString('en-AU',{month:'long',year:'numeric'});
const dayLabel = t => new Date(t).toLocaleDateString('en-AU',{weekday:'short',day:'2-digit',month:'short'});
const rel = t => { const d = Math.floor((startOfDay(now()) - startOfDay(t))/DAY); return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? `${d} days ago` : fmtDate(t) };
const startOfDay = t => { const d = new Date(t); d.setHours(0,0,0,0); return d.getTime() };
const dateInput = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` };
const fromDateInput = (v, fallback) => { if(!v) return fallback; const [y,m,d] = v.split('-').map(Number); const t = new Date(y,m-1,d,12).getTime(); return startOfDay(t) === startOfDay(now()) ? now() : t };

/* ---------- orbit ---------- */
views.orbit = () => {
  const fol = D.people.filter(p => p.follow), recent = [...D.log].sort((a,b) => b.t - a.t).slice(0,5);
  const head = `<div class="bar mono"><span>Network / Orbit</span><button class="grey" onclick="go('settings')">Settings</button></div>`;
  const ops = orbitPeople(), secs = sectors();
  if(ui.filter !== 'all' && !secs.some(g => g.id === ui.filter)) ui.filter = 'all';
  const groupAdder = D.groups.filter(g => !g.orbit).map(g => `<button class="btn small ghost" onclick="setGroupOrbit('${g.id}',true)">+ ${esc(g.name)}</button>`).join('');
  if(!ops.length) return head + `<div class="title">Orbit</div><div class="empty"><p>Your orbit is for the people who matter most: you choose who’s in it. Add a whole group, or open someone’s page and tap “Add to orbit”.</p>
    ${groupAdder ? `<p class="mono grey" style="margin-top:22px">Add a group</p><div class="btnrow" style="margin-top:10px">${groupAdder}</div>` : ''}
    <div class="btnrow"><button class="btn" onclick="go('people')">Choose people →</button></div></div>`;
  return head + `
  <div class="stats">
    <button onclick="go('people')"><b>${pad(ops.length)}</b><span class="mono grey">In orbit · of ${D.people.length}</span></button>
    <button onclick="go('groups')"><b>${pad(secs.length)}</b><span class="mono grey">Groups shown</span></button>
    <button onclick="go('log')"><b>${pad(D.log.length)}</b><span class="mono grey">Log entries</span></button>
  </div>
  <div class="orbitwrap">
    <div>
      <div class="filters" style="border-top:0"><button class="${ui.filter==='all'?'on':''}" onclick="setFilter('all')">All</button>${secs.filter(g=>g.id!=='_none').map(g => `<button class="${ui.filter===g.id?'on':''}" onclick="setFilter('${g.id}')">${colourOn()?`<i class="sw" style="background:${gHex(g)}"></i>`:''}${esc(g.short||g.name)}</button>`).join('')}<button onclick="openOrbitGroups()">+ Group</button></div>
      ${orbitSVG()}
      <div class="legend mono grey"><span><i class="lg-ring"></i>Inner ring = closer</span>${colourOn()?'<span><i class="lg-ring" style="border:0;background:linear-gradient(90deg,#AF005F,#F3D9E6)"></i>Brighter = closer</span>':''}<span>Tap a name to open</span></div>
    </div>
    <div>
      <div class="sect mono" style="border-top:1px solid var(--ink)"><span>Latest in the log</span><button class="grey" onclick="go('log')">All →</button></div>
      ${recent.map(e => entryHTML(e, {compact:true})).join('') || `<p class="emptyrow grey">Nothing logged yet.</p>`}
      ${fol.length ? `<div class="sect mono" style="border-top:1px solid var(--ink);margin-top:-1px"><span>Follow-ups</span><span class="grey">${pad(fol.length)}</span></div>
      ${fol.map((p,i) => row(p,i+1,`<span class="tagline" ${tagStyle(p)}>${esc(p.follow)}</span>`)).join('')}` : ''}
    </div>
  </div>`;
};
const tagStyle = p => colourOn() ? `style="background:${tones(pHex(p)).wash};border-color:${tones(pHex(p)).deep};color:${tones(pHex(p)).deep}"` : '';

/* ---------- people (the notebook) ---------- */
const SORTS = [['az','A–Z'],['recent','Recent'],['firm','Firm'],['team','Team'],['group','Group']];
function setSort(s){ ui.sort = s; localStorage.setItem('rolo-sort', s); render() }
function setLayout(l){ ui.layout = l; localStorage.setItem('rolo-layout', l); render() }
function filteredPeople(){
  const q = norm(ui.q), m = lastEntryMap();
  const text = p => norm([p.first,p.last,p.team,p.firm,p.role,p.hook,p.met,p.follow,p.email,...(p.talk||[]).map(t=>t.text),...entriesFor(p.id).map(e=>e.text),...(p.groups||[]).map(id=>G(id)?.name)].join(' '));
  const list = D.people.filter(p => (ui.filter==='all' || (p.groups||[]).includes(ui.filter)) && (!q || text(p).includes(q)));
  return ui.sort === 'recent' ? list.sort((a,b) => lastAct(b,m) - lastAct(a,m)) : list.sort((a,b) => fullName(a).localeCompare(fullName(b)));
}
function sections(list){
  const m = lastEntryMap(), out = new Map(), add = (k,p) => { if(!out.has(k)) out.set(k,[]); out.get(k).push(p) };
  if(ui.sort === 'az') list.forEach(p => add(((p.first||p.last||'#')[0]||'#').toUpperCase().replace(/[^A-Z]/,'#'), p));
  else if(ui.sort === 'recent') list.forEach(p => { const d = (startOfDay(now()) - startOfDay(lastAct(p,m)))/DAY; add(d < 7 ? 'This week' : d < 31 ? 'This month' : d < 365 ? 'This year' : 'Earlier', p) });
  else if(ui.sort === 'firm'){ list.forEach(p => add(p.firm || 'No firm', p)); return new Map([...out].sort((a,b) => a[0]==='No firm' ? 1 : b[0]==='No firm' ? -1 : a[0].localeCompare(b[0]))) }
  else if(ui.sort === 'team'){ list.forEach(p => add(p.team || 'No team', p)); return new Map([...out].sort((a,b) => a[0]==='No team' ? 1 : b[0]==='No team' ? -1 : a[0].localeCompare(b[0]))) }
  else { D.groups.forEach(g => list.filter(p => (p.groups||[]).includes(g.id)).forEach(p => add(g.name, p))); list.filter(p => !(p.groups||[]).some(id => G(id))).forEach(p => add('No group', p)) }
  return out;
}
function personRow(p, m){
  const e = m[p.id];
  return `<button class="prow" onclick="openPerson('${p.id}')">${faceBox(p,'ph')}<div class="pr-main"><b>${esc(fullName(p))}</b><small>${esc([p.role,p.team,p.firm].filter(Boolean).join(' · ') || '—')}</small>
    ${e ? `<span class="snip"><span class="mono grey">${esc(rel(e.t))}</span> ${esc(e.text.slice(0,90))}</span>` : p.met ? `<span class="snip"><span class="mono grey">Met</span> ${esc(p.met)}</span>` : ''}</div>
    ${isProspect(p) ? `<span class="tagline">To meet</span>` : p.catchup ? `<span class="tagline">Catch up</span>` : p.follow ? `<span class="tagline" ${tagStyle(p)}>Follow up</span>` : ''}</button>`;
}
function personCard(p){
  return `<button class="pcard" onclick="openPerson('${p.id}')">${faceBox(p,'pc-face')}<b>${esc(fullName(p))}</b><small>${esc([p.role,p.team,p.firm].filter(Boolean).join(' · ') || '—')}</small></button>`;
}
function listHTML(){
  const list = filteredPeople(), m = lastEntryMap();
  ui.navList = list.map(p => p.id);
  if(!list.length) return `<p class="emptyrow grey">${D.people.length ? 'No one matches.' : 'No one here yet.'}</p>`;
  // keep it calm: A–Z and Recent only get section headers once the list is long enough to need them
  const flat = (ui.sort === 'az' && list.length <= 14) || (ui.layout === 'grid' && (ui.sort === 'az' || ui.sort === 'recent'));
  if(flat) return ui.layout === 'grid' ? `<div class="pgrid">${list.map(personCard).join('')}</div>` : list.map(p => personRow(p, m)).join('');
  const secs = sections(list);
  const jump = ui.sort === 'az' && list.length > 8 ? `<div class="jump">${[...secs.keys()].map(k => `<button class="mono" onclick="document.getElementById('sec-${k}').scrollIntoView({behavior:'smooth'})">${k}</button>`).join('')}</div>` : '';
  return jump + [...secs].map(([k,ps]) => `<div class="sec-h mono" id="sec-${esc(k.replace(/\s/g,'_'))}"><span>${esc(k)}</span>${ui.sort==='az'?'':`<span class="grey">${pad(ps.length)}</span>`}</div>` +
    (ui.layout === 'grid' ? `<div class="pgrid">${ps.map(personCard).join('')}</div>` : ps.map(p => personRow(p, m)).join(''))).join('');
}
views.people = () => {
  const fol = D.people.filter(p => p.follow).length;
  const pk = pendingPack(), packBar = pk ? `<button class="composer" onclick="openPackSheet('${pk.file}')"><span><b>${esc(pk.label)}</b> <span class="grey">· ${pk.count} people ready to add</span></span><span class="mono">Add →</span></button>` : '';
  if(!D.people.length) return `<div class="bar mono"><span>${today()}</span><button class="grey" onclick="go('settings')">Settings</button></div>${packBar}
    <div class="title">Your<br>people</div>
    <div class="empty"><p>A notebook of everyone you meet: who they are, where you met, and what you talked about. Add someone, then log what happens.</p>
      <div class="btnrow"><button class="btn" onclick="openPersonSheet()">+ Add your first person</button><button class="btn ghost" onclick="openGroupSheet()">+ Create a group</button></div>
      <button class="link mono" onclick="loadSamples()">Or explore with sample people →</button></div>`;
  return `
  <div class="bar mono"><span>${today()}</span><span class="barbtns">${fol?`<button class="grey" onclick="ui.folOpen=true;go('log')">${fol} follow-up${fol>1?'s':''} →</button>`:''}<button class="grey" onclick="go('groups')">Groups</button><button onclick="startCards('${ui.filter}')">Flashcards</button></span></div>
  <div class="title">People</div>
  ${packBar}
  ${groupFilters(ui.filter,'setFilter',`<button onclick="openGroupSheet()">+ Group</button>`)}
  <div class="search"><span class="mono grey">Search</span><input id="q" value="${esc(ui.q)}" placeholder="Name, team, or anything you wrote" oninput="ui.q=this.value;document.getElementById('list').innerHTML=listHTML()" autocomplete="off"></div>
  <div class="toolbar"><div class="seg">${SORTS.map(([k,l]) => `<button class="${ui.sort===k?'on':''}" onclick="setSort('${k}')">${l}</button>`).join('')}</div>
    <div class="seg">${[['list','List'],['grid','Grid']].map(([k,l]) => `<button class="${ui.layout===k?'on':''}" onclick="setLayout('${k}')">${l}</button>`).join('')}</div></div>
  <div id="list">${listHTML()}</div>`;
};

/* ---------- log (the diary) ---------- */
function entryHTML(e, o={}){
  const ps = (e.people||[]).map(P).filter(Boolean);
  const chips = ps.filter(p => p.id !== o.except).map(p => `<button class="pchip" onclick="event.stopPropagation();openPerson('${p.id}')">${faceBox(p,'mini')}${esc(p.first||fullName(p))}</button>`).join('');
  return `<div class="entry ${o.compact?'compact':''}" onclick="openEntrySheet('${e.id}')"><span class="mono grey e-date">${o.compact ? esc(rel(e.t)) : esc(dayLabel(e.t))}</span>
    <div class="e-body"><p>${esc(e.text)}</p>${chips ? `<div class="pchips">${chips}</div>` : ''}</div></div>`;
}
function filteredLog(){
  const q = norm(ui.lq||'');
  return D.log.filter(e => (ui.filter==='all' || (e.people||[]).some(id => (P(id)?.groups||[]).includes(ui.filter))) &&
    (!q || norm(e.text + ' ' + (e.people||[]).map(id => P(id) ? fullName(P(id)) : '').join(' ')).includes(q))).sort((a,b) => b.t - a.t);
}
function logListHTML(){
  const l = filteredLog(); if(!l.length) return `<p class="emptyrow grey">${D.log.length ? 'No entries match.' : 'Nothing logged yet. Write down who you met and what you talked about.'}</p>`;
  let out = '', cur = '';
  for(const e of l){ const mth = monthName(e.t); if(mth !== cur){ cur = mth; out += `<div class="sec-h mono"><span>${esc(mth)}</span></div>` } out += entryHTML(e) }
  return out;
}
views.log = () => {
  const fol = D.people.filter(p => p.follow);
  return `
  <div class="bar mono"><span>Network / Log</span><span class="grey">${pad(D.log.length)} entries</span></div>
  <div class="title">Log</div>
  <button class="composer" onclick="openEntrySheet()"><span class="grey">What happened? Who did you meet?</span><span class="mono">+ New entry</span></button>
  ${fol.length ? `<details class="folds" ${ui.folOpen?'open':''} ontoggle="ui.folOpen=this.open"><summary class="sect mono"><span>Open follow-ups · ${fol.length}</span><span class="grey">Show ▾</span></summary>
    ${fol.map((p,i) => row(p,i+1,`<span class="tagline" ${tagStyle(p)}>${esc(p.follow)}</span>`)).join('')}</details>` : ''}
  ${groupFilters(ui.filter,'setFilter')}
  <div class="search"><span class="mono grey">Search</span><input id="lq" value="${esc(ui.lq||'')}" placeholder="Search the log" oninput="ui.lq=this.value;document.getElementById('loglist').innerHTML=logListHTML()" autocomplete="off"></div>
  <div id="loglist">${logListHTML()}</div>`;
};

/* ---------- person page ---------- */
views.person = () => {
  const p = P(ui.person); if(!p){ ui.view='people'; return views.people() }
  const t = tones(pHex(p)), col = colourOn();
  const nav = (ui.navList && ui.navList.includes(p.id)) ? ui.navList : D.people.slice().sort((a,b)=>fullName(a).localeCompare(fullName(b))).map(x=>x.id);
  const i = nav.indexOf(p.id), prev = nav[i-1], next = nav[i+1];
  const fact = (k,v) => v ? `<div><span>${k}</span><span>${v}</span></div>` : '';
  const link = (u,l) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a>`;
  const li = p.linkedin ? (/^https?:\/\//.test(p.linkedin) ? p.linkedin : 'https://'+p.linkedin) : '';
  const entries = entriesFor(p.id);
  return `
  <div class="bar mono"><button onclick="go('people')">← People</button>
    <span class="pager"><button ${prev?`onclick="openPerson('${prev}')"`:'disabled'} aria-label="Previous person">‹</button><span class="grey">${i+1} / ${nav.length}</span><button ${next?`onclick="openPerson('${next}')"`:'disabled'} aria-label="Next person">›</button></span>
    <button class="grey" onclick="openPersonSheet('${p.id}')">Edit</button></div>
  <div class="profile" style="border-top:0">
    <div>
      ${faceBox(p,'portrait')}
      <div class="pname">${esc(p.first)}<br>${esc(p.last)}</div>
      <div class="pactions">
        ${isProspect(p) ? `<button onclick="markMet('${p.id}')">✓ Mark as met</button>` : p.catchup ? `<button class="on" onclick="setCatchup('${p.id}',false)">✓ Catching up</button>` : `<button onclick="setCatchup('${p.id}',true)">+ Catch up</button>`}
        <button onclick="openPlanSheet(null,'${p.id}')">Schedule</button>
        <button onclick="openEntrySheet(null,'${p.id}')">Log</button>
      </div>
      <div class="facts">
        ${isProspect(p) ? `<div><span>Status</span><span><span class="tagline">Want to meet</span> <button class="glink" style="margin-left:8px" onclick="markMet('${p.id}')">Mark as met</button></span></div>` : ''}
        ${fact('Role',esc(p.role))}${fact('Team',esc(p.team))}${fact('Firm',esc(p.firm))}${fact(isProspect(p)?'Via':'Met',esc(p.met))}
        ${fact('Groups',(p.groups||[]).map(id=>G(id)).filter(Boolean).map(g=>`<button class="glink" onclick="ui.filter='${g.id}';go('people')">${esc(g.name)}</button>`).join(', '))}
        ${fact('Email',p.email?link('mailto:'+p.email,p.email):'')}${fact('Phone',p.phone?link('tel:'+p.phone,p.phone):'')}${fact('LinkedIn',li?link(li,'Profile ↗'):'')}
        ${isProspect(p) ? '' : inOrbit(p) ? `<div><span>Orbit</span><span><span class="rings">${RINGS.map((l,k)=>`<button class="${(p.ring||3)===k+1?'on':''}" onclick="setRing('${p.id}',${k+1})">${l}</button>`).join('')}</span><button class="glink grey" style="margin-top:8px;display:block;font-size:13px" onclick="setOrbit('${p.id}',false)">Remove from orbit</button></span></div>`
          : `<div><span>Orbit</span><span><button class="btn small ghost" onclick="setOrbit('${p.id}',true)">+ Add to orbit</button></span></div>`}
        ${fact('Added', p.created ? esc(dayLabel(p.created)) : '')}
      </div>
    </div>
    <div>
      <div class="hook" ${col?`style="background:${t.wash}"`:''}><span class="mono grey">Memory hook</span><p>${p.hook ? esc(p.hook) : `<button class="grey" onclick="openPersonSheet('${p.id}','hook')">+ Add something to remember them by</button>`}</p></div>
      <div class="sect mono"><span>To talk about</span><span class="grey">${pad(openTalk(p).length)}</span></div>
      ${talkHTML(p)}
      <div class="sect mono" style="border-top:1px solid var(--ink);margin-top:-1px"><span>Plans</span><button class="grey" onclick="openPlanSheet(null,'${p.id}')">+ Schedule</button></div>
      ${plansFor(p.id).map(planCard).join('') || `<p class="emptyrow grey">Nothing scheduled with ${esc(p.first||'them')}.</p>`}
      <div class="hook" style="border-top:1px solid var(--ink);margin-top:-1px"><span class="mono grey">Follow-up</span>
        ${p.follow ? `<p>${esc(p.follow)}</p><button class="btn small" style="margin-top:12px" onclick="doneFollow('${p.id}')">✓ Done</button>`
          : `<form class="inline" onsubmit="setFollow(event,'${p.id}')"><input name="f" placeholder="e.g. Coffee in December" autocomplete="off"><button class="mono">Set</button></form>`}
      </div>
      <div class="sect mono"><span>Log</span><span class="grey">${pad(entries.length)}</span></div>
      <form class="inline note-add" onsubmit="quickEntry(event,'${p.id}')"><input name="t" placeholder="Log something about ${esc(p.first||'them')}…" autocomplete="off"><button class="mono">Add</button><button type="button" class="mono grey" onclick="openEntrySheet(null,'${p.id}',this.form.t.value)">More</button></form>
      ${entries.map(e => entryHTML(e, {except:p.id})).join('')}
      ${p.created ? `<div class="entry auto"><span class="mono grey e-date">${esc(dayLabel(p.created))}</span><div class="e-body"><p class="grey">Added to Network${p.met?` · ${isProspect(p)?'via':'met at'} ${esc(p.met)}`:''}</p></div></div>` : ''}
    </div>
  </div>`;
};

/* ---------- groups ---------- */
views.groups = () => `
  <div class="bar mono"><span>Network / Groups</span><span class="grey">${pad(D.groups.length)} groups</span></div>
  <div class="title">Groups</div>
  <p class="intro grey">Make a group for any context: a cohort, a team, an event. One person can be in as many groups as you like.</p>
  <div style="border-top:1px solid var(--ink)">
  ${D.groups.map((g,i) => { const h = gHex(g); return `<div class="glrow" style="${colourOn()?`box-shadow:inset 6px 0 0 ${h};background:linear-gradient(90deg,${tones(h).wash},transparent 70%)`:''}">
      <button class="gl" onclick="ui.filter='${g.id}';go('people')"><span class="mono grey">${pad(i+1)}</span><b>${esc(g.name)}</b><span class="ct">${pad(inG(g.id).length)}</span></button>
      <button class="mono gedit ${g.orbit?'':'grey'}" onclick="setGroupOrbit('${g.id}',${!g.orbit})" title="${g.orbit?'Remove group from orbit':'Add group to orbit'}">${g.orbit?'● Orbit':'+ Orbit'}</button><button class="mono grey gedit" onclick="startCards('${g.id}')">Cards</button><button class="mono grey gedit" onclick="openGroupSheet('${g.id}')">Edit</button></div>` }).join('')}
  <button class="gl" onclick="openGroupSheet()"><span class="mono grey">+</span><b class="grey">New group</b><span></span></button></div>`;

/* ---------- plans: people to meet, talking points, scheduled coffees ---------- */
const KINDS = ['Coffee','Lunch','Drinks','Call','Meeting','Event'];
const isProspect = p => p.status === 'tomeet';
const plansFor = pid => D.plans.filter(x => (x.people||[]).includes(pid) && !x.done).sort((a,b) => a.t - b.t);
const timeLabel = t => new Date(t).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}).replace(' ','').toLowerCase();
const dtInput = t => `${dateInput(t)}T${String(new Date(t).getHours()).padStart(2,'0')}:${String(new Date(t).getMinutes()).padStart(2,'0')}`;
const planTitle = x => `${x.kind||'Catch-up'}${(x.people||[]).length ? ' with ' + (x.people||[]).map(P).filter(Boolean).map(p => p.first||fullName(p)).join(', ') : ''}`;
const openTalk = p => (p.talk||[]).filter(t => !t.done);

function talkHTML(p){
  const items = p.talk || [];
  return `<div class="talk">${items.map(t => `<div class="titem ${t.done?'done':''}"><button class="tick" onclick="toggleTalk('${p.id}','${t.id}')" aria-label="${t.done?'Mark not discussed':'Mark discussed'}">${t.done?'✓':''}</button><span>${esc(t.text)}</span><button class="x" onclick="delTalk('${p.id}','${t.id}')" title="Remove">×</button></div>`).join('')}
    <form class="inline" onsubmit="addTalk(event,'${p.id}')"><input name="t" placeholder="+ Something to ask or talk about" autocomplete="off"><button class="mono">Add</button></form></div>`;
}
function addTalk(e, pid){ e.preventDefault(); const v = e.target.t.value.trim(); if(!v) return; const p = P(pid); (p.talk = p.talk||[]).push({id:uid(), text:v, done:false}); touch(p); commit();
  setTimeout(() => { const i = document.querySelector(`form[onsubmit*="addTalk(event,'${pid}')"] input`); if(i) i.focus() }, 0) }
function toggleTalk(pid, tid){ const p = P(pid), t = (p.talk||[]).find(x => x.id === tid); t.done = !t.done; touch(p); commit() }
function delTalk(pid, tid){ const p = P(pid); p.talk = (p.talk||[]).filter(x => x.id !== tid); touch(p); commit() }
function setCatchup(pid, on){ const p = P(pid); p.catchup = on; touch(p); commit(); toast(on ? `${p.first} added to catch-ups` : `${p.first} removed from catch-ups`) }
function openCatchupPicker(){
  ui.cq = '';
  sheet(`<div class="title">Catch up<br>with…</div><div class="search" style="border-top:1px solid var(--ink)"><span class="mono grey">Search</span><input id="cq" placeholder="Name, team or firm" autocomplete="off" oninput="ui.cq=this.value;document.getElementById('cqlist').innerHTML=catchupList()"></div>
    <div id="cqlist">${catchupList()}</div><div class="sheetbtns" style="grid-template-columns:1fr"><button onclick="closeSheet();render()">Done</button></div>`);
  if(matchMedia('(min-width:900px)').matches) setTimeout(() => $('#cq').focus(), 50);
}
function catchupList(){
  const q = norm(ui.cq||'');
  const list = D.people.filter(p => !isProspect(p) && (!q || norm([fullName(p),p.team,p.firm,p.role].join(' ')).includes(q))).sort((a,b) => fullName(a).localeCompare(fullName(b)));
  return list.map(p => `<div class="tmrow"><div class="prow" style="cursor:default">${faceBox(p,'ph')}<div class="pr-main"><b>${esc(fullName(p))}</b><small>${esc([p.role,p.team,p.firm].filter(Boolean).join(' · ') || '—')}</small></div></div>
    <button class="mono tmbtn" onclick="P('${p.id}').catchup=!P('${p.id}').catchup;touch(P('${p.id}'));idb.set('data',D);schedulePush();document.getElementById('cqlist').innerHTML=catchupList()">${p.catchup?'✓ Added':'+ Add'}</button></div>`).join('') || '<p class="emptyrow grey">No one matches.</p>';
}
function markMet(pid){ const p = P(pid); p.status = 'met'; touch(p); commit(); toast(`${p.first} moved to people you’ve met`) }

function planCard(x){
  const d = new Date(x.t), ps = (x.people||[]).map(P).filter(Boolean), past = x.t < now() - 2*3600e3;
  const pts = ps.flatMap(p => openTalk(p).map(t => ({p, t})));
  return `<div class="plan ${past?'past':''}">
    <button class="pdate" onclick="openPlanSheet('${x.id}')"><b>${d.getDate()}</b><span class="mono">${d.toLocaleDateString('en-AU',{month:'short'})}</span><span class="mono grey">${d.toLocaleDateString('en-AU',{weekday:'short'})}</span></button>
    <div class="pbody"><button class="ptitle" onclick="openPlanSheet('${x.id}')"><b>${esc(planTitle(x))}</b><small class="mono grey">${esc(timeLabel(x.t))}${x.place?` · ${esc(x.place)}`:''}</small></button>
      ${ps.length ? `<div class="pchips">${ps.map(p => `<button class="pchip" onclick="openPerson('${p.id}')">${faceBox(p,'mini')}${esc(p.first||fullName(p))}</button>`).join('')}</div>` : ''}
      ${x.notes ? `<p class="pnotes">${esc(x.notes)}</p>` : ''}
      ${pts.length ? `<ul class="ppts">${pts.slice(0,5).map(({p,t}) => `<li>${ps.length>1?`<span class="mono grey">${esc(p.first)}</span> `:''}${esc(t.text)}</li>`).join('')}${pts.length>5?`<li class="grey">+ ${pts.length-5} more</li>`:''}</ul>` : ''}
      <div class="pacts">${past ? `<button class="btn small" onclick="logPlan('${x.id}')">How did it go? Log it →</button>` : `<button class="btn small ghost" onclick="downloadICS('${x.id}')">+ Calendar</button><button class="btn small ghost" onclick="logPlan('${x.id}')">Done · log it</button>`}</div>
    </div></div>`;
}
views.plans = () => {
  const up = D.plans.filter(x => !x.done).sort((a,b) => a.t - b.t);
  const past = up.filter(x => x.t < now() - 2*3600e3), future = up.filter(x => x.t >= now() - 2*3600e3);
  const tm = D.people.filter(isProspect).sort((a,b) => fullName(a).localeCompare(fullName(b)));
  const cu = D.people.filter(p => p.catchup && !isProspect(p)).sort((a,b) => fullName(a).localeCompare(fullName(b)));
  const m = lastEntryMap();
  const wantRow = (p, catchup) => { const pts = openTalk(p), nextPlan = plansFor(p.id)[0], last = m[p.id]; return `<div class="tmrow">
      <button class="prow" onclick="openPerson('${p.id}')">${faceBox(p,'ph')}<div class="pr-main"><b>${esc(fullName(p))}</b><small>${esc([p.role,p.team,p.firm].filter(Boolean).join(' · ') || '—')}</small>
        ${pts.length ? `<span class="snip"><span class="mono grey">${pts.length} to talk about</span> ${esc(pts[0].text)}${pts.length>1?'…':''}</span>` : catchup && last ? `<span class="snip"><span class="mono grey">Last ${esc(rel(last.t))}</span> ${esc(last.text.slice(0,70))}</span>` : p.met ? `<span class="snip"><span class="mono grey">${catchup?'Met':'Via'}</span> ${esc(p.met)}</span>` : ''}</div>
        ${nextPlan ? `<span class="tagline">${esc(new Date(nextPlan.t).toLocaleDateString('en-AU',{day:'numeric',month:'short'}))}</span>` : ''}</button>
      ${nextPlan ? '' : `<button class="mono tmbtn" onclick="openPlanSheet(null,'${p.id}')">Schedule</button>`}</div>` };
  return `
  <div class="bar mono"><span>Network / Plans</span><span class="grey">${pad(future.length)} upcoming</span></div>
  <div class="title">Plans</div>
  <div class="btnrow pad" style="margin-top:0"><button class="btn" onclick="openPlanSheet()">+ Schedule a coffee</button><button class="btn ghost" onclick="openCatchupPicker()">+ Catch up with…</button><button class="btn ghost" onclick="openPersonSheet(null,null,'tomeet')">+ Someone new to meet</button></div>
  ${past.length ? `<div class="sect mono" style="border-top:1px solid var(--ink)"><span>To log · how did it go?</span><span class="grey">${pad(past.length)}</span></div>${past.map(planCard).join('')}` : ''}
  <div class="sect mono" style="border-top:1px solid var(--ink);margin-top:-1px"><span>Upcoming</span><span class="grey">${pad(future.length)}</span></div>
  ${future.map(planCard).join('') || `<p class="emptyrow grey">Nothing scheduled. Plan a coffee with someone you want to get to know.</p>`}
  <div class="sect mono" style="border-top:1px solid var(--ink);margin-top:-1px"><span>Want to catch up</span><button class="grey" onclick="openCatchupPicker()">+ Add</button></div>
  ${cu.map(p => wantRow(p, true)).join('') || `<p class="emptyrow grey">People you already know and want to see again. Tap “+ Add”, or “Want to catch up” on someone’s page.</p>`}
  <div class="sect mono" style="border-top:1px solid var(--ink);margin-top:-1px"><span>Want to meet</span><span class="grey">${pad(tm.length)}</span></div>
  ${tm.map(p => wantRow(p, false)).join('') || `<p class="emptyrow grey">People you haven’t met yet: a partner in a team you’re curious about, a grad, a speaker. Jot down what to ask them.</p>`}`;
};

function openPlanSheet(id, pid){
  const x = id ? D.plans.find(y => y.id === id) : null;
  ui.psel = new Set(x ? x.people||[] : pid ? [pid] : []); ui.pq = ''; ui.kind = x ? x.kind : 'Coffee';
  const def = new Date(now() + DAY); def.setHours(10,0,0,0);
  sheet(`<form onsubmit="savePlan(event,${x?`'${x.id}'`:'null'})"><div class="title">${x?'Edit<br>plan':'Schedule'}</div>
    <div class="fld"><span class="mono grey">What</span><div class="opts">${KINDS.map(k => `<button type="button" class="opt ${ui.kind===k?'on':''}" onclick="ui.kind='${k}';pickOne(this)">${k}</button>`).join('')}</div></div>
    <div class="fld"><span class="mono grey">With</span><div class="picker" id="picker">${pickerHTML()}</div></div>
    <div class="two"><label class="fld"><span class="mono grey">When</span><input type="datetime-local" name="t" value="${dtInput(x ? x.t : def.getTime())}" required></label>
    <label class="fld"><span class="mono grey">Where</span><input name="place" value="${esc(x ? x.place||'' : '')}" placeholder="Cafe downstairs" autocomplete="off"></label></div>
    <label class="fld"><span class="mono grey">Notes</span><textarea name="notes" rows="2" placeholder="Booked? Who reached out? Anything to bring?">${esc(x ? x.notes||'' : '')}</textarea></label>
    <p class="intro grey" style="padding-top:12px">Talking points live on each person’s page and show up on this plan automatically.</p>
    ${x?`<button type="button" class="link mono danger" style="margin:4px 20px 0" onclick="deletePlan('${x.id}')">Delete plan</button>`:''}
    <div class="sheetbtns"><button type="button" onclick="closeSheet()">Cancel</button><button type="submit">Save →</button></div></form>`);
}
function savePlan(ev, id){
  ev.preventDefault(); const f = new FormData(ev.target), v = f.get('t'); if(!v) return;
  const [dp, tp] = v.split('T'), [y,m,d] = dp.split('-').map(Number), [hh,mm] = (tp||'09:00').split(':').map(Number);
  let x = id ? D.plans.find(y => y.id === id) : null;
  if(!x){ x = {id:uid(), done:false}; D.plans.push(x) }
  Object.assign(x, {kind:ui.kind||'Coffee', people:[...ui.psel], t:new Date(y,m-1,d,hh,mm).getTime(), place:(f.get('place')||'').toString().trim(), notes:(f.get('notes')||'').toString().trim()}); touch(x);
  closeSheet(); commit(); toast(id ? 'Plan saved' : 'Scheduled');
}
function deletePlan(id){ D.plans = D.plans.filter(x => x.id !== id); D.deleted[id] = now(); closeSheet(); commit(); toast('Plan deleted') }
function logPlan(id){
  const x = D.plans.find(y => y.id === id); ui.fromPlan = id;
  const done = (x.people||[]).map(P).filter(Boolean).flatMap(p => (p.talk||[]).filter(t => t.done).map(t => t.text));
  openEntrySheet(null, null, `${planTitle(x)}${x.place?` at ${x.place}`:''}. ${done.length ? 'Talked about: ' + done.join('; ').replace(/[.?!]$/,'') + '. ' : ''}`);
  ui.psel = new Set(x.people||[]); refreshPicker(false);
  const dEl = $('#sheet [name=d]'); if(dEl) dEl.value = dateInput(x.t);
}
function downloadICS(id){
  const x = D.plans.find(y => y.id === id), ps = (x.people||[]).map(P).filter(Boolean);
  const f = t => { const d = new Date(t); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}00` };
  const ic = s => String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/[,;]/g, m => '\\'+m);
  const pts = ps.flatMap(p => openTalk(p).map(t => `- ${t.text}`));
  const desc = [x.notes, pts.length ? 'To talk about:\n' + pts.join('\n') : ''].filter(Boolean).join('\n\n');
  const body = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Network//EN','BEGIN:VEVENT',`UID:${x.id}@network`,`DTSTAMP:${f(now())}`,`DTSTART:${f(x.t)}`,`DTEND:${f(x.t + ((x.kind==='Call')?30:60)*60e3)}`,
    `SUMMARY:${ic(planTitle(x))}`, x.place ? `LOCATION:${ic(x.place)}` : '', desc ? `DESCRIPTION:${ic(desc)}` : '', 'END:VEVENT','END:VCALENDAR'].filter(Boolean).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], {type:'text/calendar'})); a.download = `${planTitle(x).replace(/[^\w ]+/g,'').slice(0,40)}.ics`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- flashcards ---------- */
// Decks: 'all' (everyone in People), a group id, or 'set:<id>' for a practice set (a deletable folder of cards kept apart from People).
const SET = id => (D.sets||[]).find(s => s.id === id);
const isSetDeck = d => typeof d === 'string' && d.startsWith('set:');
function startCards(deck){ ui.fc = null; ui.cardDeck = deck || 'all'; go('cards') }
function buildDeck(deck){
  let ids;
  if(isSetDeck(deck)){ const s = SET(deck.slice(4)); ids = s ? s.cards.filter(c => ui.withKnown || !c.known).map(c => c.id) : [] }
  else ids = (deck === 'all' || !G(deck) ? [...D.people] : inG(deck)).filter(p => !isProspect(p)).map(p => p.id);
  ids = ids.map(id => [Math.random(), id]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
  ui.fc = {deck, queue:ids, i:0, flipped:false, again:new Set()};
}
function setDeck(d){ buildDeck(d); render() }
function cardStep(n){ const f = ui.fc; f.i = Math.max(0, Math.min(f.queue.length, f.i + n)); f.flipped = false; render() }
function cardKnow(known){
  const f = ui.fc, s = SET(f.deck.slice(4)), c = s && s.cards.find(x => x.id === f.queue[f.i]); if(!c) return;
  if(known){ c.known = true } else if(!f.again.has(c.id)){ f.queue.push(c.id); f.again.add(c.id) }   // "Again" comes back once at the end
  touch(s); idb.set('data', D); schedulePush(); f.i++; f.flipped = false; render();
}
function cardHTML(x, front, deckLabel, col, t){
  return `<div class="flip ${ui.fc.flipped?'on':''}" onclick="ui.fc.flipped=!ui.fc.flipped;this.classList.toggle('on')">
      <div class="flip-in">
        <div class="fa" style="${col?`background:${t.base};color:${onC(t.base)}`:''}"><div class="foot mono" style="border-top:0;border-bottom:1px solid currentColor;opacity:.85"><span>Who’s this?</span><span>${esc(deckLabel)}</span></div>${front}<div class="foot mono" style="opacity:.85"><span>Tap to flip</span><span>↻</span></div></div>
        <div class="fb" ${col?`style="background:${t.wash}"`:''}><div class="pname">${esc(x.first)}<br>${esc(x.last)}</div>
          <div class="facts">${x.role?`<div><span>Role</span><span>${esc(x.role)}</span></div>`:''}${x.team?`<div><span>Team</span><span>${esc(x.team)}</span></div>`:''}${x.firm?`<div><span>Firm</span><span>${esc(x.firm)}</span></div>`:''}${x.met?`<div><span>Met</span><span>${esc(x.met)}</span></div>`:''}</div>
          ${x.hook?`<div class="hk"><span class="mono grey" style="display:block;margin-bottom:4px">Memory hook</span>${esc(x.hook)}</div>`:''}</div>
      </div>
    </div>`;
}
views.cards = () => {
  if(!ui.fc) buildDeck(ui.cardDeck || 'all');
  const f = ui.fc, q = f.queue, inSet = isSetDeck(f.deck), s = inSet ? SET(f.deck.slice(4)) : null;
  if(inSet && !s){ ui.fc = null; ui.cardDeck = 'all'; return views.cards() }
  const head = `<div class="bar mono"><button onclick="go('people')">← People</button><span class="grey">${String(Math.min(f.i+1,q.length)).padStart(2,'0')}/${String(q.length).padStart(2,'0')}</span></div>
    <div class="filters" style="border-top:0"><button class="${f.deck==='all'?'on':''}" onclick="setDeck('all')">Everyone</button>${D.groups.map(g=>`<button class="${f.deck===g.id?'on':''}" onclick="setDeck('${g.id}')">${esc(g.short||g.name)}</button>`).join('')}${(D.sets||[]).map(x=>`<button class="setchip ${f.deck==='set:'+x.id?'on':''}" onclick="setDeck('set:${x.id}')">▣ ${esc(x.name)}</button>`).join('')}</div>
    ${s ? `<div class="sethead"><div><b>${esc(s.name)}</b><small class="mono grey">${s.cards.filter(c=>c.known).length} of ${s.cards.length} known</small></div><button class="btn small ghost" onclick="go('set');ui.setId='${s.id}';render()">Open folder</button></div>` : ''}`;
  if(!q.length) return head + (s
    ? `<div class="drill"><div class="title" style="padding:40px 0 10px">All<br>known.</div><p class="grey" style="margin-bottom:24px">You’ve marked everyone in this set as known.</p><div class="btnrow"><button class="btn" onclick="ui.withKnown=true;setDeck('${f.deck}');ui.withKnown=false">Go through everyone again</button><button class="btn ghost" onclick="ui.setId='${s.id}';go('set')">Open folder</button></div></div>`
    : `<div class="drill"><div class="title" style="padding:40px 0 10px">No<br>cards.</div><p class="grey" style="margin-bottom:24px">Add people (ideally with a photo) to flip through them here.</p><button class="btn" onclick="openPersonSheet()">+ Add person</button></div>`);
  if(f.i >= q.length) return head + `<div class="drill"><div class="title" style="padding:40px 0 10px">${s?'Round<br>done.':'That’s<br>everyone.'}</div><p class="mono grey" style="margin-bottom:24px">${s ? `${s.cards.filter(c=>c.known).length} of ${s.cards.length} known` : pad(q.length)+' cards'}</p><div class="btnrow"><button class="btn" onclick="setDeck('${f.deck}')">${s?'Keep going →':'Shuffle again →'}</button><button class="btn ghost" onclick="go('people')">Back to people</button></div></div>`;
  if(s){
    const c = s.cards.find(x => x.id === q[f.i]); if(!c){ f.i++; return views.cards() }
    const t = tones(pal(s.pc||'kwm').hex), d = PH[c.id] && PH[c.id].d;
    const front = d ? `<div class="big photo-big"><img src="${d}" alt=""></div>` : `<div class="big clue"><span class="mono" style="opacity:.7">No photo · clues</span><p>${esc([c.role,c.team,c.firm].filter(Boolean).join(', ')||'—')}</p>${c.met?`<p class="sm">${esc(c.met)}</p>`:''}${c.hook?`<p class="sm">“${esc(c.hook)}”</p>`:''}</div>`;
    return head + `<div class="drill"><div class="prog">${q.map((_,k)=>`<i class="${k<f.i?'done':''}"></i>`).join('')}</div>${cardHTML(c, front, s.name, colourOn(), t)}
      <div class="rate"><button onclick="cardStep(-1)" ${f.i===0?'disabled':''}>← Back</button><button onclick="cardKnow(false)">Again</button><button onclick="cardKnow(true)">Know it ✓</button></div>
      <p class="mono grey" style="text-align:center;margin-top:12px">“Know it” takes them out of the deck · “Again” brings them back at the end</p></div>`;
  }
  const p = P(q[f.i]); if(!p){ f.i++; return views.cards() }
  const g = G((p.groups||[]).find(id=>G(id))), d = photoOf(p);
  const front = d ? `<div class="big photo-big"><img src="${d}" alt=""></div>` :
    `<div class="big clue"><span class="mono" style="opacity:.7">No photo · clues</span><p>${esc([p.role,p.team,p.firm].filter(Boolean).join(', ')||'—')}</p>${p.met?`<p class="sm">Met: ${esc(p.met)}</p>`:''}${p.hook?`<p class="sm">“${esc(p.hook)}”</p>`:''}</div>`;
  return head + `<div class="drill"><div class="prog">${q.map((_,k)=>`<i class="${k<f.i?'done':''}"></i>`).join('')}</div>${cardHTML(p, front, g?(g.short||g.name):'', colourOn(), tones(pHex(p)))}
    <div class="rate"><button onclick="cardStep(-1)" ${f.i===0?'disabled':''}>← Back</button><button onclick="openPerson('${p.id}')">Open page</button><button onclick="cardStep(1)">Next →</button></div></div>`;
};

/* ---------- practice set folder ---------- */
views.set = () => {
  const s = SET(ui.setId) || (D.sets||[])[0]; if(!s){ ui.view = 'cards'; return views.cards() }
  ui.setId = s.id;
  const known = s.cards.filter(c => c.known).length;
  const cards = s.cards.slice().sort((a,b) => (a.known - b.known) || `${a.first} ${a.last}`.localeCompare(`${b.first} ${b.last}`));
  return `<div class="bar mono"><button onclick="startCards('set:${s.id}')">← Flashcards</button><span class="grey">Practice set</span></div>
  <div class="title">${esc(s.name)}</div>
  <p class="intro grey">A separate folder just for flashcards. These people aren’t in your People, Log or Orbit. Delete the folder when you’re done with it.</p>
  <div class="stats"><button onclick="startCards('set:${s.id}')"><b>${pad(s.cards.length - known)}</b><span class="mono grey">To learn</span></button><button><b>${pad(known)}</b><span class="mono grey">Known</span></button><button onclick="startCards('set:${s.id}')"><b>▶</b><span class="mono grey">Practise</span></button></div>
  ${cards.map(c => { const d = PH[c.id] && PH[c.id].d; return `<div class="tmrow ${c.known?'known':''}"><div class="prow" style="cursor:default"><div class="ph">${d?`<img src="${d}" alt="">`:esc(((c.first||'')[0]||'')+((c.last||'')[0]||''))}</div><div class="pr-main"><b>${esc(c.first+' '+c.last)}</b><small>${esc([c.role,c.firm].filter(Boolean).join(' · '))}</small></div></div>
    <label class="mono tmbtn" style="display:grid;place-items:center;cursor:pointer">${d?'Photo ✓':'+ Photo'}<input type="file" accept="image/*" hidden onchange="setCardPhoto(this,'${s.id}','${c.id}')"></label>
    <button class="mono tmbtn" onclick="toggleKnown('${s.id}','${c.id}')">${c.known?'✓ Known':'Mark known'}</button></div>` }).join('')}
  <div class="btnrow pad" style="margin-top:22px"><button class="btn ghost" onclick="resetKnown('${s.id}')">Reset known</button><button class="btn ghost danger" style="border-color:#9A2B2B" onclick="confirmDeleteSet('${s.id}')">Delete this folder</button></div>`;
};
function toggleKnown(sid, cid){ const s = SET(sid), c = s.cards.find(x => x.id === cid); c.known = !c.known; touch(s); commit() }
function resetKnown(sid){ const s = SET(sid); s.cards.forEach(c => c.known = false); touch(s); commit(); toast('Everyone’s back in the deck') }
async function setCardPhoto(input, sid, cid){ const f = input.files && input.files[0]; if(!f) return; try{ setPhoto(cid, await compress(f)); touch(SET(sid)); commit(); toast('Photo added') }catch(e){ toast(e.message) } }
function confirmDeleteSet(sid){
  const s = SET(sid);
  sheet(`<div class="title">Delete<br>folder?</div><p class="intro" style="padding-top:0">This deletes “${esc(s.name)}”: all ${s.cards.length} cards and their photos, on every device. It doesn’t touch anyone in your People.</p>
    <div class="sheetbtns"><button onclick="closeSheet()">Cancel</button><button onclick="deleteSet('${sid}')">Delete</button></div>`);
}
function deleteSet(sid){
  const s = SET(sid); s.cards.forEach(c => { if(PH[c.id]) setPhoto(c.id, null) });
  D.sets = D.sets.filter(x => x.id !== sid); D.deleted[sid] = now(); ui.fc = null; ui.cardDeck = 'all';
  closeSheet(); ui.view = 'people'; commit(); toast('Folder deleted');
}
// Move the clerks that were imported into People across into their own practice set.
function clerksToSet(){
  const ps = D.people.filter(p => p.id.startsWith('slc26-')); if(!ps.length || D.deleted['set-slc26']) return false;
  D.sets = D.sets || [];
  let s = SET('set-slc26'); if(!s){ s = {id:'set-slc26', name:'Allens summer clerks', pc:'allens', cards:[]}; D.sets.push(s) }
  const busy = p => p.catchup || p.follow || (p.talk||[]).length || D.log.some(e => (e.people||[]).includes(p.id)) || D.plans.some(x => (x.people||[]).includes(p.id));
  const t = now();
  ps.forEach(p => {
    if(!s.cards.some(c => c.id === p.id)) s.cards.push({id:p.id, first:p.first, last:p.last, role:p.role, team:p.team, firm:p.firm, met:p.met, hook:p.hook, known:false});
    if(busy(p)){ p.groups = (p.groups||[]).filter(g => g !== 'slc26-allens'); delete p.orbit; touch(p) }   // you've logged/planned with them: keep them in People too
    else { D.people = D.people.filter(x => x.id !== p.id); D.deleted[p.id] = t }
  });
  if(G('slc26-allens')){ D.groups = D.groups.filter(g => g.id !== 'slc26-allens'); D.deleted['slc26-allens'] = t }
  if(ui.filter === 'slc26-allens') ui.filter = 'all';
  touch(s); return true;
}

/* ---------- settings ---------- */
views.settings = () => {
  const col = colourOn();
  const tog = (on, fn) => `<button class="tog ${on?'on':''}" onclick="${fn}" role="switch" aria-checked="${on}" aria-label="Colour mode"><i></i></button>`;
  const syncLine = !SYNC_ON ? 'Sync isn’t configured in this copy of the app, so everything stays on this device.' :
    !acct ? 'Saved on this device only.' :
    sync.state === 'error' ? sync.err :
    sync.state === 'syncing' ? 'Syncing…' :
    sync.last ? `Synced across your devices · last sync ${new Date(sync.last).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}` : 'Synced across your devices';
  const samples = D.people.filter(p => p.sample).length;
  return `
  <div class="bar mono"><span>Network / Settings</span><span class="grey">v1.0</span></div>
  <div class="title">Settings</div>
  <div class="sect mono" style="border-top:1px solid var(--ink)"><span>Appearance</span></div>
  <div class="set"><div><b>Colour mode</b><small>Give each group its own colour across your people, log, orbit and flashcards. Off = black and white.</small></div>${tog(col,'setColour('+!col+')')}</div>
  ${col ? `<div class="set" style="display:block"><b>Tones</b><small>Each colour comes in a faded, soft, bright and deep version. Brighter means closer on your orbit.</small>
    ${D.groups.map(g=>{const t=tones(gHex(g));return `<div class="ramp"><span class="mono grey">${esc(g.short||g.name)}</span>${[t.wash,t.soft,t.base,t.deep].map(c=>`<i style="background:${c}"></i>`).join('')}</div>`}).join('') || '<p class="grey" style="margin-top:8px">Create a group to see its tones.</p>'}</div>
  ${D.groups.length ? `<div class="sect mono" style="border-top:1px solid var(--ink);margin-top:-1px"><span>Group colours</span><span class="grey">Tap a swatch</span></div>
  ${D.groups.map(g => `<div class="set"><div><b>${esc(g.name)}</b><small>${esc(pal(g.pc).firm)} · ${esc(pal(g.pc).name)}</small></div><div class="swatches">${PALETTE.map(x=>`<button class="swb ${g.pc===x.id?'on':''}" style="background:${x.hex}" title="${esc(x.firm+' '+x.name)}" onclick="setGroupColour('${g.id}','${x.id}')"></button>`).join('')}</div></div>`).join('')}` : ''}` : ''}
  <div class="sect mono" style="border-top:1px solid var(--ink);margin-top:-1px"><span>Account &amp; sync</span></div>
  <div class="set"><div><b>${acct ? esc(acct.label) : 'Not signed in'}</b><small>${esc(syncLine)}</small></div><span class="mono grey">${acct ? (sync.state==='error'?'!&nbsp;Offline':'●&nbsp;Live') : '○&nbsp;Local'}</span></div>
  ${acct ? `<button class="set" style="width:100%" onclick="syncNow()"><div><b>Sync now</b></div><span class="mono grey">↻</span></button>
    <button class="set" style="width:100%" onclick="startLogin('change')"><div><b>Change planet &amp; constellation</b><small>Keeps all your people; you’ll use the new combination to sign in.</small></div><span class="mono grey">→</span></button>
    <button class="set" style="width:100%" onclick="confirmSwitch()"><div><b>Switch account</b><small>Signs out and clears this device.</small></div><span class="mono grey">→</span></button>`
    : `<button class="set" style="width:100%" onclick="startLogin('signin')"><div><b>Sign in to sync</b><small>Name + planet + constellation</small></div><span class="mono grey">→</span></button>`}
  <div class="sect mono" style="border-top:1px solid var(--ink);margin-top:-1px"><span>Data</span></div>
  <button class="set" style="width:100%" onclick="recentrePhotos()"><div><b>Centre photos on faces</b><small>Re-crops photos you’ve already added so the circles show their face</small></div><span class="mono grey">◎</span></button>
  <button class="set" style="width:100%" onclick="exportData()"><div><b>Export backup</b><small>Download everyone, notes and photos as a file</small></div><span class="mono grey">↓</span></button>
  <label class="set" style="cursor:pointer"><div><b>Import backup</b><small>Merge a Network backup file into this orbit</small></div><span class="mono grey">↑</span><input type="file" accept="application/json,.json" hidden onchange="importData(this)"></label>
  ${samples ? `<button class="set" style="width:100%" onclick="removeSamples()"><div><b>Remove sample people</b><small>${samples} sample ${samples===1?'person':'people'}</small></div><span class="mono grey">×</span></button>` : ''}
  <p class="intro grey" style="padding-top:20px;padding-bottom:40px">To install: on iPhone, tap Share → Add to Home Screen. On a laptop, use the install icon in the address bar.</p>`;
};
function setColour(on){ D.settings = touch({...D.settings, colour:on}); commit() }
function setGroupColour(gid, pid){ const g = G(gid); g.pc = pid; touch(g); commit() }

/* ---------- login ---------- */
function startLogin(mode){ Object.assign(ui.login, {mode, busy:false, msg:'', planet:null, con:null, name: mode==='change' && acct ? acct.label.split(' · ')[0] : ui.login.name}); go('login') }
const planetGlyph = (r,ring) => `<svg width="34" height="26" viewBox="0 0 34 26" aria-hidden="true"><circle cx="17" cy="13" r="${r}" fill="currentColor"/>${ring?'<ellipse cx="17" cy="13" rx="14" ry="3.5" fill="none" stroke="currentColor" stroke-width="1"/>':''}</svg>`;
const conGlyph = i => `<svg width="34" height="26" viewBox="0 0 34 26" aria-hidden="true">${CON_PTS[i].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="1.7" fill="currentColor"/>`).join('')}</svg>`;
function pickLogin(k,v){ ui.login[k] = v; ui.login.msg = ''; render() }
const loginReady = () => ui.login.name.trim() && ui.login.planet && ui.login.con;
views.login = () => {
  const L = ui.login, change = L.mode === 'change';
  return `<div class="bar mono"><span>Network / ${change?'Change login':'Sign in'}</span><button class="grey" onclick="skipLogin()">${change?'Cancel':'Not now'}</button></div>
  <div class="title">${change?'New<br>combination':'Who’s in<br>orbit?'}</div>
  <div class="loginwrap">
  <label class="fld" style="border-top:1px solid var(--ink)"><span class="mono grey">01 / Your name</span><input id="lname" value="${esc(L.name)}" placeholder="Ella" autocomplete="off" autocapitalize="words" oninput="ui.login.name=this.value;document.getElementById('enter').disabled=!loginReady()"></label>
  <div class="sect mono" style="border-top:1px solid var(--ink)"><span>02 / Pick a planet</span><span class="grey">${L.planet||''}</span></div>
  <div class="pick">${PLANETS.map(([n,r])=>`<button class="${L.planet===n?'on':''}" onclick="pickLogin('planet','${n}')">${planetGlyph(r,n==='Saturn')}<span class="mono">${n}</span></button>`).join('')}</div>
  <div class="sect mono" style="border-top:1px solid var(--ink)"><span>03 / Pick a constellation</span><span class="grey">${L.con||''}</span></div>
  <div class="pick">${CONS.map((n,i)=>`<button class="${L.con===n?'on':''}" onclick="pickLogin('con','${n}')">${conGlyph(i)}<span class="mono">${n}</span></button>`).join('')}</div>
  ${L.msg ? `<p class="msg">${esc(L.msg)}</p>` : ''}
  <div class="sheetbtns" style="grid-template-columns:1fr;margin-top:0"><button id="enter" ${loginReady()&&!L.busy?'':'disabled'} onclick="submitLogin()">${L.busy?'Checking…':change?'Change login →':'Enter orbit →'}</button></div>
  <p class="loginnote">Capitals and spaces in your name don’t matter. ${change?'Your people stay exactly as they are.':'New combination? You’ll be asked to start a new orbit, and anything already on this device comes with you.'} Remember your combination: it can’t be recovered.</p>
  </div>`;
};
function skipLogin(){ localStorage.setItem('rolo-skip-login','1'); go(ui.login.mode==='change'?'settings':'people') }
async function submitLogin(){
  const L = ui.login; if(!loginReady() || L.busy) return;
  if(!SYNC_ON){ L.msg = 'Sync isn’t set up in this copy of the app yet. Tap “Not now” to keep using Network on this device.'; return render() }
  const label = `${titleCase(L.name)} · ${L.planet} · ${L.con}`;
  const key = await sha(`rolo:${norm(L.name)}|${L.planet.toLowerCase()}|${L.con.toLowerCase()}`);
  L.busy = true; L.msg = ''; render();
  try{
    if(L.mode === 'change'){
      if(key === acct.key){ L.msg = 'That’s your current combination.'; }
      else if(await rpc('rolo_load',{p_key:key})){ L.msg = 'That combination is already taken. Try a different planet or constellation.'; }
      else {
        await rpc('rolo_save',{p_key:key, p_data:D});
        for(const [id,l] of Object.entries(PH)) if(l.d) await rpc('rolo_photo_put',{p_key:key,p_person:id,p_data:l.d,p_updated:l.t});
        await rpc('rolo_delete',{p_key:acct.key});
        acct = {label, key}; await idb.set('acct', acct);
        L.busy = false; toast('Login changed'); return go('settings');
      }
    } else {
      const remote = await rpc('rolo_load',{p_key:key});
      if(remote){ acct = {label,key}; await idb.set('acct',acct); D = merge(D, remote); await idb.set('data',D);
        L.busy = false; toast('Welcome back'); go('people'); await syncNow(); autoPacks(); fixups(); return }
      L.pending = {label, key}; L.busy = false; render();
      return sheet(`<div class="title">New<br>orbit?</div>
        <p class="intro" style="padding-top:0">There’s no orbit for <b>${esc(label)}</b> yet.${D.people.length?` The ${D.people.length} ${D.people.length===1?'person':'people'} on this device will come with you.`:''}</p>
        <p class="intro grey" style="padding-top:0">If you already have an orbit, go back and check your name, planet and constellation.</p>
        <div class="sheetbtns"><button onclick="closeSheet()">Back</button><button onclick="confirmNewOrbit()">Start new orbit →</button></div>`);
    }
  }catch(e){
    console.warn(e);
    L.msg = e.message === 'NOT_SETUP' ? `Supabase project “${PROJECT}” doesn’t have Network’s tables yet. In Supabase, open that exact project → SQL Editor and run the setup script. Tap “Not now” to keep working on this device meanwhile.`
      : 'Couldn’t reach the sync server. Check your connection, or tap “Not now” to keep working on this device.';
  }
  L.busy = false; render();
}
async function confirmNewOrbit(){
  closeSheet(); acct = ui.login.pending; ui.login.pending = null;
  await idb.set('acct', acct); toast('New orbit created'); go('people'); await syncNow(); autoPacks();
}
function confirmSwitch(){
  sheet(`<div class="title">Switch<br>account?</div>
    <p class="intro" style="padding-top:0">You’ll be signed out and this device will be cleared. Your orbit stays safe in sync. Sign back in with <b>${esc(acct.label)}</b>.</p>
    <div class="sheetbtns"><button onclick="closeSheet()">Cancel</button><button onclick="switchAccount()">Sign out →</button></div>`);
}
async function switchAccount(){
  closeSheet(); if(sync.state !== 'error') await syncNow();
  await idb.clear(); D = blank(); PH = {}; acct = null; sync.state = SYNC_ON ? 'idle' : 'off';
  localStorage.removeItem('rolo-skip-login'); ui.filter = 'all'; ui.q = '';
  Object.assign(ui.login, {name:'', planet:null, con:null}); startLogin('signin');
}

/* ---------- person + log actions ---------- */
function setRing(id, r){ const p = P(id); p.ring = r; touch(p); commit() }
function setFollow(e, id){ e.preventDefault(); const v = e.target.f.value.trim(); if(!v) return; const p = P(id); p.follow = v; touch(p); commit() }
function doneFollow(id){ const p = P(id); D.log.push(touch({id:uid(), t:now(), people:[id], text:'✓ Followed up: '+p.follow})); p.follow = ''; touch(p); commit(); toast('Follow-up done and logged') }
function quickEntry(e, pid){ e.preventDefault(); const v = e.target.t.value.trim(); if(!v) return; D.log.push(touch({id:uid(), t:now(), people:[pid], text:v})); commit(); toast('Logged') }

function pickerHTML(){
  const q = norm(ui.pq||''), chosen = [...ui.psel].map(P).filter(Boolean);
  const matches = q ? D.people.filter(p => !ui.psel.has(p.id) && norm(fullName(p)+' '+(p.team||'')).includes(q)).slice(0,6) : [];
  return `${chosen.map(p => `<button type="button" class="pchip on" onclick="togglePsel('${p.id}')">${faceBox(p,'mini')}${esc(fullName(p))} ×</button>`).join('')}
    <input id="pq" value="${esc(ui.pq||'')}" placeholder="${chosen.length?'+ Add another person':'Type a name…'}" autocomplete="off" oninput="ui.pq=this.value;refreshPicker(true)" onkeydown="if(event.key==='Enter'){event.preventDefault();const b=document.querySelector('#pmatches button');if(b)b.click()}">
    <div id="pmatches">${matches.map(p => `<button type="button" class="pchip" onclick="togglePsel('${p.id}')">${faceBox(p,'mini')}${esc(fullName(p))}${p.team?` <span class="grey">· ${esc(p.team)}</span>`:''}</button>`).join('')}
    ${q && !matches.length ? `<span class="grey" style="font-size:13px">No one called “${esc(ui.pq)}”. Add them as a person first.</span>` : ''}</div>`;
}
function refreshPicker(keepFocus){ $('#picker').innerHTML = pickerHTML(); if(keepFocus){ const i = $('#pq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length) } }
function togglePsel(id){ ui.psel.has(id) ? ui.psel.delete(id) : ui.psel.add(id); ui.pq = ''; refreshPicker(true) }
function openEntrySheet(id, pid, text){
  const e = id ? D.log.find(x => x.id === id) : null;
  ui.psel = new Set(e ? e.people||[] : pid ? [pid] : []); ui.pq = '';
  sheet(`<form onsubmit="saveEntry(event,${e?`'${e.id}'`:'null'})"><div class="title">${e?'Edit<br>entry':'New<br>entry'}</div>
    <label class="fld"><span class="mono grey">Date</span><input type="date" name="d" value="${dateInput(e ? e.t : now())}" max="${dateInput(now()+365*DAY)}"></label>
    <label class="fld"><span class="mono grey">What happened</span><textarea name="text" rows="4" placeholder="Coffee with Priya: she’s training for the marathon, offered to review my memo…" required>${esc(e ? e.text : text||'')}</textarea></label>
    <div class="fld"><span class="mono grey">Who was there</span><div class="picker" id="picker">${pickerHTML()}</div></div>
    ${e?`<button type="button" class="link mono danger" style="margin:14px 20px 0" onclick="deleteEntry('${e.id}')">Delete entry</button>`:''}
    <div class="sheetbtns"><button type="button" onclick="closeSheet()">Cancel</button><button type="submit">Save →</button></div></form>`);
  if(!e) setTimeout(() => $('#sheet [name=text]').focus(), 50);
}
function saveEntry(ev, id){
  ev.preventDefault(); const f = new FormData(ev.target), text = (f.get('text')||'').toString().trim(); if(!text) return;
  let e = id ? D.log.find(x => x.id === id) : null;
  if(!e){ e = {id:uid()}; D.log.push(e) }
  Object.assign(e, {text, people:[...ui.psel], t: fromDateInput(f.get('d'), e.t || now())}); touch(e);
  if(ui.fromPlan){ const x = D.plans.find(y => y.id === ui.fromPlan); if(x){ x.done = true; x.entry = e.id; touch(x) }
    (e.people||[]).map(P).filter(Boolean).forEach(p => { if(isProspect(p)) p.status = 'met'; p.catchup = false; touch(p) }); ui.fromPlan = null }
  closeSheet(); commit(); toast(id ? 'Entry saved' : 'Logged');
}
function deleteEntry(id){ D.log = D.log.filter(e => e.id !== id); D.deleted[id] = now(); closeSheet(); commit(); toast('Entry deleted') }
function openAdd(){
  sheet(`<div class="title">Add</div>
    <button class="set" style="width:100%" onclick="closeSheet();openPersonSheet()"><div><b>New person</b><small>Someone you’ve met: photo, role, team, where you met</small></div><span class="mono grey">→</span></button>
    <button class="set" style="width:100%" onclick="closeSheet();openEntrySheet(null, ui.view==='person'?ui.person:null)"><div><b>Log entry</b><small>A coffee, a meeting, an event, and who was there</small></div><span class="mono grey">→</span></button>
    <button class="set" style="width:100%" onclick="closeSheet();openPlanSheet(null, ui.view==='person'?ui.person:null)"><div><b>Schedule a coffee</b><small>Coffee, lunch, a call, with talking points ready</small></div><span class="mono grey">→</span></button>
    <button class="set" style="width:100%" onclick="closeSheet();openPersonSheet(null,null,'tomeet')"><div><b>Someone to meet</b><small>A person you’d like to get to know, and what to ask them</small></div><span class="mono grey">→</span></button>
    <button class="set" style="width:100%" onclick="closeSheet();ui.view==='person'?setCatchup(ui.person,true):openCatchupPicker()"><div><b>Someone to catch up with</b><small>A person you already know and want to see again</small></div><span class="mono grey">→</span></button>
    <button class="set" style="width:100%" onclick="closeSheet();openGroupSheet()"><div><b>New group</b><small>A cohort, a team, an event</small></div><span class="mono grey">→</span></button>
    <div class="sheetbtns" style="grid-template-columns:1fr"><button onclick="closeSheet()">Cancel</button></div>`);
}

function chipsHTML(){
  return D.groups.map(g => `<button type="button" class="opt ${ui.sel.has(g.id)?'on':''}" onclick="toggleSel('${g.id}')">${colourOn()?`<i class="sw" style="background:${gHex(g)}"></i>`:''}${esc(g.short||g.name)}</button>`).join('') +
    `<span class="newgrp"><input id="ng" placeholder="New group…" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();addGroupInline()}"><button type="button" class="opt" onclick="addGroupInline()">Add</button></span>`;
}
function toggleSel(id){ ui.sel.has(id) ? ui.sel.delete(id) : ui.sel.add(id); $('#chips').innerHTML = chipsHTML() }
function addGroupInline(){ const el = $('#ng'), v = el.value.trim(); if(!v) return el.focus(); const g = newGroup(v); ui.sel.add(g.id); $('#chips').innerHTML = chipsHTML(); idb.set('data',D); schedulePush(); renderNav() }
function newGroup(name, pc){
  const used = D.groups.map(g=>g.pc); pc = pc || (PALETTE.find(x=>!used.includes(x.id)) || PALETTE[D.groups.length % PALETTE.length]).id;
  const g = touch({id:uid(), name, short:name.split(/\s+/).slice(-1)[0].slice(0,12), pc}); if(name.length <= 12) g.short = name;
  D.groups.push(g); return g;
}
function pickOne(el){ el.parentNode.querySelectorAll('.opt').forEach(b => b.classList.remove('on')); el.classList.add('on') }

function openPersonSheet(id, focus, status){
  const p = id ? P(id) : null; ui.status = p ? (p.status||'met') : (status || 'met');
  ui.sel = new Set(p ? (p.groups||[]).filter(g=>G(g)) : (ui.filter!=='all' && G(ui.filter) ? [ui.filter] : []));
  ui.ring = p ? (inOrbit(p) ? (p.ring||3) : 0) : 0; ui.photo = undefined;
  const v = k => esc(p ? p[k]||'' : '');
  const d = p && photoOf(p);
  sheet(`<form onsubmit="savePerson(event,${p?`'${p.id}'`:'null'})">
    <div class="title">${p?'Edit':'New'}<br>person</div>
    <label class="photo" id="photoBox">${d?`<img src="${d}" alt="">`:`<span class="mono grey">+ Add photo${matchMedia('(min-width:900px)').matches?' · or paste one':''}</span>`}<input type="file" accept="image/*" hidden onchange="pickPhoto(this)"></label>
    ${d?`<button type="button" class="link mono" style="margin:0 20px 6px" onclick="ui.photo=null;document.getElementById('photoBox').innerHTML='<span class=&quot;mono grey&quot;>Photo removed · tap to add</span><input type=&quot;file&quot; accept=&quot;image/*&quot; hidden onchange=&quot;pickPhoto(this)&quot;>'">Remove photo</button>`:''}
    <div class="two"><label class="fld"><span class="mono grey">First name</span><input name="first" value="${v('first')}" required autocomplete="off" autocapitalize="words"></label>
    <label class="fld"><span class="mono grey">Last name</span><input name="last" value="${v('last')}" autocomplete="off" autocapitalize="words"></label></div>
    <div class="two"><label class="fld"><span class="mono grey">Role</span><input name="role" value="${v('role')}" placeholder="Associate" autocomplete="off"></label>
    <label class="fld"><span class="mono grey">Team</span><input name="team" value="${v('team')}" placeholder="Disputes" autocomplete="off"></label></div>
    <label class="fld"><span class="mono grey">Firm</span><input name="firm" value="${v('firm')}" placeholder="Allens" list="firms" autocomplete="off"><datalist id="firms">${[...new Set([...D.people.map(x=>x.firm).filter(Boolean), ...FIRMS])].map(f=>`<option value="${esc(f)}">`).join('')}</datalist></label>
    <div class="fld"><span class="mono grey">Status</span><div class="opts">${[['met','Met'],['tomeet','Want to meet']].map(([k,l]) => `<button type="button" class="opt ${ui.status===k?'on':''}" onclick="ui.status='${k}';pickOne(this)">${l}</button>`).join('')}</div></div>
    <div class="fld"><span class="mono grey">Groups</span><div class="opts" id="chips">${chipsHTML()}</div></div>
    <div class="fld"><span class="mono grey">Orbit · how close you are</span><div class="opts">${['Not in orbit',...RINGS].map((l,i)=>`<button type="button" class="opt ${ui.ring===i?'on':''}" onclick="ui.ring=${i};pickOne(this)">${l}</button>`).join('')}</div></div>
    <label class="fld"><span class="mono grey">Where you met · or how you know of them</span><input name="met" value="${v('met')}" placeholder="Clerkship welcome drinks" autocomplete="off"></label>
    <label class="fld"><span class="mono grey">Memory hook</span><input name="hook" value="${v('hook')}" placeholder="One detail to remember them by" autocomplete="off"></label>
    <label class="fld"><span class="mono grey">Follow-up</span><input name="follow" value="${v('follow')}" placeholder="Optional, e.g. send thank-you note" autocomplete="off"></label>
    <details class="more" ${p&&(p.email||p.phone||p.linkedin)?'open':''}><summary class="mono grey">Contact details</summary>
      <label class="fld"><span class="mono grey">Email</span><input name="email" type="email" value="${v('email')}" autocomplete="off"></label>
      <label class="fld"><span class="mono grey">Phone</span><input name="phone" type="tel" value="${v('phone')}" autocomplete="off"></label>
      <label class="fld"><span class="mono grey">LinkedIn</span><input name="linkedin" value="${v('linkedin')}" placeholder="linkedin.com/in/…" autocomplete="off"></label></details>
    ${p?`<button type="button" class="link mono danger" style="margin:14px 20px 0" onclick="confirmDelete('${p.id}')">Delete ${esc(p.first)}</button>`:''}
    <div class="sheetbtns"><button type="button" onclick="closeSheet()">Cancel</button><button type="submit">Save →</button></div></form>`);
  const f = focus === 'hook' ? $('#sheet [name=hook]') : (!p ? $('#sheet [name=first]') : null);
  if(f && matchMedia('(min-width:900px)').matches) f.focus(); else if(f && focus) f.focus();
}
// paste a copied image (e.g. a LinkedIn profile photo) straight into the person form
document.addEventListener('paste', async e => {
  if(!$('#scrim').classList.contains('on') || !$('#photoBox')) return;
  const item = [...(e.clipboardData?.items||[])].find(i => i.type.startsWith('image/')); if(!item) return;
  e.preventDefault(); await usePhotoFile(item.getAsFile()); toast('Photo pasted');
});
async function usePhotoFile(file){
  try{ ui.photo = await compress(file); $('#photoBox').innerHTML = `<img src="${ui.photo}" alt=""><input type="file" accept="image/*" hidden onchange="pickPhoto(this)">` }
  catch(e){ toast(e.message) }
}
async function pickPhoto(input){
  const file = input.files && input.files[0]; if(file) return usePhotoFile(file);
}
function savePerson(e, id){
  e.preventDefault(); const f = new FormData(e.target), val = k => (f.get(k)||'').toString().trim();
  let p = id ? P(id) : null;
  if(!p){ p = {id:uid(), n:Math.max(0,...D.people.map(x=>x.n||0))+1, created:now()}; D.people.push(p) }
  Object.assign(p, {first:val('first'), last:val('last'), role:val('role'), team:val('team'), firm:val('firm'), met:val('met'), hook:val('hook'), follow:val('follow'),
                    email:val('email'), phone:val('phone'), linkedin:val('linkedin'), groups:[...ui.sel], status:ui.status||'met'});
  if(ui.ring){ p.ring = ui.ring; p.orbit = true } else if(p.orbit === true || viaGroup(p)) p.orbit = false;
  delete p.sample; touch(p);
  if(ui.photo !== undefined) setPhoto(p.id, ui.photo);
  closeSheet(); ui.person = p.id; ui.view = 'person'; commit(); toast(id ? 'Saved' : `${p.first} added`);
}
function confirmDelete(id){
  const p = P(id);
  sheet(`<div class="title">Delete<br>${esc(p.first)}?</div><p class="intro" style="padding-top:0">This removes ${esc(fullName(p))}, their notes and photo from every device.</p>
    <div class="sheetbtns"><button onclick="closeSheet()">Cancel</button><button onclick="deletePerson('${id}')">Delete</button></div>`);
}
function deletePerson(id){
  D.people = D.people.filter(p => p.id !== id); D.deleted[id] = now();
  D.log.forEach(e => { if((e.people||[]).includes(id)){ e.people = e.people.filter(x => x !== id); touch(e) } });
  D.plans.forEach(x => { if((x.people||[]).includes(id)){ x.people = x.people.filter(y => y !== id); touch(x) } });
  if(PH[id]) setPhoto(id, null);
  closeSheet(); ui.view = 'people'; commit(); toast('Deleted');
}

/* ---------- group actions ---------- */
function openGroupSheet(id){
  const g = id ? G(id) : null; ui.gcolour = g ? g.pc : (PALETTE.find(x=>!D.groups.map(g=>g.pc).includes(x.id))||PALETTE[0]).id;
  sheet(`<form onsubmit="saveGroup(event,${g?`'${g.id}'`:'null'})"><div class="title">${g?'Edit':'New'}<br>group</div>
    <label class="fld"><span class="mono grey">Name</span><input name="name" value="${esc(g?g.name:'')}" placeholder="Summer clerkship 2026" required autocomplete="off"></label>
    <label class="fld"><span class="mono grey">Short label · for tabs and the orbit</span><input name="short" value="${esc(g?g.short:'')}" placeholder="Clerkship" maxlength="14" autocomplete="off"></label>
    <div class="fld"><span class="mono grey">Colour · used in colour mode</span><div class="swatches" style="justify-content:flex-start;max-width:none;margin-top:10px">${PALETTE.map(x=>`<button type="button" class="swb ${ui.gcolour===x.id?'on':''}" style="background:${x.hex}" title="${esc(x.firm+' · '+x.name)}" onclick="ui.gcolour='${x.id}';this.parentNode.querySelectorAll('.swb').forEach(b=>b.classList.remove('on'));this.classList.add('on')"></button>`).join('')}</div></div>
    <label class="fld" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer"><span><span class="mono grey">Show in orbit</span><br><small class="grey">Everyone in this group appears on your orbit</small></span><input type="checkbox" name="orbit" ${g&&g.orbit?'checked':''} style="width:22px;height:22px;accent-color:#111110"></label>
    ${g?`<button type="button" class="link mono danger" style="margin:14px 20px 0" onclick="deleteGroup('${g.id}')">Delete group (people stay)</button>`:''}
    <div class="sheetbtns"><button type="button" onclick="closeSheet()">Cancel</button><button type="submit">${g?'Save':'Create'} →</button></div></form>`);
  if(!g) $('#sheet [name=name]').focus();
}
function saveGroup(e, id){
  e.preventDefault(); const f = new FormData(e.target); const name = f.get('name').toString().trim(); if(!name) return;
  const short = f.get('short').toString().trim();
  let g = id ? G(id) : newGroup(name, ui.gcolour);
  g.name = name; g.short = short || (name.length <= 12 ? name : name.split(/\s+/)[0].slice(0,12)); g.pc = ui.gcolour; g.orbit = !!f.get('orbit'); touch(g);
  closeSheet(); commit(); toast(id ? 'Group saved' : 'Group created');
}
function deleteGroup(id){
  D.groups = D.groups.filter(g => g.id !== id); D.deleted[id] = now();
  D.people.forEach(p => { if((p.groups||[]).includes(id)){ p.groups = p.groups.filter(x => x !== id); touch(p) } });
  if(ui.filter === id) ui.filter = 'all';
  closeSheet(); commit(); toast('Group deleted');
}

/* ---------- data ---------- */
async function exportData(){
  const blob = new Blob([JSON.stringify({app:'rolo', v:1, exported:new Date().toISOString(), data:D, photos:PH})], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `network-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importData(input){
  const file = input.files && input.files[0]; if(!file) return;
  try{ const j = JSON.parse(await file.text()); if(j.app !== 'rolo' || !j.data) throw new Error();
    D = merge(D, j.data);
    for(const [id,l] of Object.entries(j.photos||{})) if(!PH[id] || PH[id].t < l.t){ PH[id] = l; await idb.set('ph:'+id, l) }
    commit(); toast('Backup imported');
  }catch(e){ toast('That isn’t a Network backup file') }
}
// Encrypted starter packs (kept encrypted because this repo and site are public)
const PACKS = [{file:'packs/allens-clerks.json', group:'slc26-allens', prefix:'slc26-', set:'set-slc26', owner:'ella', label:'Allens summer clerks 2026', count:33, code:'clerks-4322'}];
const pendingPack = () => null;
// Add starter packs automatically, once per device (never re-adds a group you've deleted)
const acctName = () => acct ? norm(acct.label.split(' · ')[0]) : '';
// one-off tidy-ups for Ella's account
function fixups(){
  if(clerksToSet()){ commit(); toast('Clerks moved to their own flashcard folder') }
  // anything labelled just "Sydney" becomes "Allens Sydney": group names and short labels, and people's team, firm and met fields
  const isSyd = v => typeof v === 'string' && norm(v).replace(/[^a-z]/g,'') === 'sydney';
  let n = 0;
  D.groups.forEach(g => { let c = false; if(isSyd(g.name)){ g.name = 'Allens Sydney'; c = true } if(isSyd(g.short)){ g.short = 'Allens Sydney'; c = true } if(c){ touch(g); n++ } });
  D.people.forEach(p => { let c = false; for(const k of ['team','firm','met','role']) if(isSyd(p[k])){ p[k] = 'Allens Sydney'; c = true } if(c){ touch(p); n++ } });
  if(n){ commit(); toast(`Updated ${n} “Sydney” label${n>1?'s':''} to “Allens Sydney”`) }
}
async function autoPacks(){
  for(const k of PACKS){
    // packs belong to one person's account only
    if(acctName() !== k.owner){
      if(localStorage.getItem('pack-done-'+k.group)){   // auto-added here earlier: take it back out (locally only, no sync tombstones)
        D.people = D.people.filter(p => !p.id.startsWith(k.prefix)); D.groups = D.groups.filter(g => g.id !== k.group); D.sets = (D.sets||[]).filter(x => x.id !== k.set);
        localStorage.removeItem('pack-done-'+k.group); if(ui.filter === k.group) ui.filter = 'all'; idb.set('data', D); render(); schedulePush();
      }
      continue;
    }
    if(SET(k.set) || D.deleted[k.set] || D.people.some(p => p.id.startsWith(k.prefix)) || localStorage.getItem('pack-done-'+k.group)) continue;
    try{ const pack = await decryptPack(k.file, k.code);
      D.sets = D.sets || []; D.sets.push(touch({id:k.set, name:'Allens summer clerks', pc:'allens', cards:pack.data.people.map(p => ({id:p.id, first:p.first, last:p.last, role:p.role, team:p.team, firm:p.firm, met:p.met, hook:p.hook, known:false}))}));
      localStorage.setItem('pack-done-'+k.group,'1'); commit(); toast(`Flashcard set added: ${k.count} clerks`) }
    catch(e){ console.warn('pack', e) }
  }
}
async function decryptPack(file, code){
  const j = await (await fetch(file, {cache:'no-store'})).json(), b = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({name:'PBKDF2', salt:b(j.salt), iterations:200000, hash:'SHA-256'}, base, {name:'AES-GCM', length:256}, false, ['decrypt']);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM', iv:b(j.iv)}, key, b(j.ct))));
}
function openPackSheet(file){
  const k = PACKS.find(x => x.file === file);
  sheet(`<form onsubmit="importPack(event,'${file}')"><div class="title">Add<br>${k.count} people</div>
    <p class="intro" style="padding-top:0">${esc(k.label)}. Enter the passcode Claude gave you.</p>
    <label class="fld"><span class="mono grey">Passcode</span><input name="code" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="clerks-0000" required></label>
    <p class="msg" id="packmsg" style="display:none"></p>
    <button type="button" class="link mono" style="margin:12px 20px 0" onclick="localStorage.setItem('pack-hide-${k.group}','1');closeSheet();render()">Don’t show this again</button>
    <div class="sheetbtns"><button type="button" onclick="closeSheet()">Cancel</button><button type="submit">Add them →</button></div></form>`);
  setTimeout(() => $('#sheet [name=code]').focus(), 50);
}
async function importPack(e, file){
  e.preventDefault(); const code = new FormData(e.target).get('code').toString().trim().toLowerCase(), msg = $('#packmsg');
  try{
    const j = await (await fetch(file, {cache:'no-store'})).json(), b = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({name:'PBKDF2', salt:b(j.salt), iterations:200000, hash:'SHA-256'}, base, {name:'AES-GCM', length:256}, false, ['decrypt']);
    const pack = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM', iv:b(j.iv)}, key, b(j.ct))));
    D = merge(D, pack.data); closeSheet(); ui.view = 'people'; commit(); toast(`${j.count} people added`);
  }catch(err){ msg.style.display = ''; msg.textContent = 'That passcode didn’t work. Check it and try again.' }
}
function loadSamples(){
  const mk = (name, pc) => D.groups.find(g => norm(g.name) === norm(name)) || newGroup(name, pc);
  const gC = mk('Clerkship cohort','kwm'), gP = mk('Partners','apc'), gD = mk('Disputes team','ash'), gM = mk('Mentors','allens');
  gC.short = 'Cohort'; gD.short = 'Disputes';
  const S = [['Priya','Nair','Senior Associate','Disputes',[gD,gM],1,'Clerkship wk 2, team lunch','Training for the Sydney marathon','Thank-you note'],
    ['Tom','Hargreaves','Partner','Banking',[gP],3,'Welcome drinks','Coaches junior cricket on Saturdays','Coffee in Dec'],
    ['Mei','Chen','Seasonal Clerk','Corporate',[gC],1,'Orientation day','Also Monash, law/commerce'],
    ['Jack','Osei','Seasonal Clerk','Disputes',[gC],2,'Orientation day','Plays bass in a band'],
    ['Sophie','Laurent','Special Counsel','Competition',[gM],2,'Women in Law breakfast','Did an LLM in Paris','Send ACCC article'],
    ['Ravi','Patel','Seasonal Clerk','Real Estate',[gC],2,'Orientation day','Huge F1 fan'],
    ['Grace','Kim','Graduate','Tax',[gM],1,'Law Society mixer','Gave me interview tips'],
    ['Liam',"O'Brien",'Partner','Disputes',[gP,gD],3,'Practice talk, wk 1','Ex-rower, Irish accent','Ask about secondment'],
    ['Hannah','Brooks','Seasonal Clerk','Banking',[gC],3,'Orientation day','Ran the uni debating society'],
    ['Daniel','Ng','Associate','Disputes',[gD],2,'Clerkship wk 2','Cat called Brief'],
    ['Amara','Okafor','Partner','Corporate',[gP],2,'Partner Q&A panel','Started as a paralegal']];
  let n = Math.max(0, ...D.people.map(x=>x.n||0));
  S.forEach(([first,last,role,team,gs,ring,met,hook,follow]) => D.people.push(touch({id:uid(), n:++n, first, last, role, team, groups:gs.map(g=>g.id), ring, met, hook, follow:follow||'', notes:[], sample:true,
    created: now() - Math.floor(Math.random()*40)*DAY})));
  const by = f => D.people.find(p => p.sample && p.first === f)?.id;
  [[1,'Priya','Coffee near the office. She offered to review my research memo once exams are done.'],
   [3,'Priya,Daniel','Disputes team lunch. Daniel’s cat is called Brief (!). Priya is training for the Sydney marathon.'],
   [6,'Tom','Welcome drinks. Grad program rotates every 6 months; banking team is hiring next year.'],
   [9,'Mei,Jack,Ravi,Hannah','Orientation day. Mei is also Monash; Jack plays bass in a band; Ravi is a huge F1 fan.'],
   [12,'Sophie,Grace','Women in Law breakfast. Sophie did an LLM in Paris and is happy to chat about competition law.'],
   [20,'Liam','Practice talk on class actions. Ask about the London secondment.']]
   .forEach(([d,names,text]) => D.log.push(touch({id:uid(), t:now()-d*DAY, people:names.split(',').map(by).filter(Boolean), text, sample:true})));
  const z = touch({id:uid(), n:++n, first:'Zara', last:'Ahmed', role:'Partner', team:'Energy & Infrastructure', groups:[gP.id], ring:3, met:'Spoke at the grad careers night', hook:'', follow:'', status:'tomeet', sample:true, created:now(),
    talk:[{id:uid(), text:'How she moved from in-house back to private practice', done:false},{id:uid(), text:'Is the renewables team taking seasonal clerks?', done:false}]});
  D.people.push(z);
  const pr = D.people.find(p => p.sample && p.first === 'Priya'); if(pr){ pr.talk = [{id:uid(), text:'Ask how the marathon training is going', done:false},{id:uid(), text:'Follow up on the research memo', done:false}]; touch(pr) }
  const at = (d,h) => { const x = new Date(now()+d*DAY); x.setHours(h,0,0,0); return x.getTime() };
  D.plans.push(touch({id:uid(), kind:'Coffee', people:[pr.id], t:at(2,9), place:'Cafe downstairs', notes:'She suggested it after the team lunch', done:false, sample:true}));
  D.plans.push(touch({id:uid(), kind:'Coffee', people:[z.id], t:at(8,15), place:'', notes:'Emailed her assistant to book', done:false, sample:true}));
  [gC,gP,gD,gM].forEach(g => { g.sample = true; g.orbit = true });
  commit(); toast('Sample people added');
}
function removeSamples(){
  const t = now();
  D.people.filter(p => p.sample).forEach(p => D.deleted[p.id] = t);
  D.groups.filter(g => g.sample && !D.people.some(p => !p.sample && (p.groups||[]).includes(g.id))).forEach(g => D.deleted[g.id] = t);
  D.log.filter(e => e.sample).forEach(e => D.deleted[e.id] = t); D.plans.filter(x => x.sample).forEach(x => D.deleted[x.id] = t); D.plans = D.plans.filter(x => !x.sample);
  D.people = D.people.filter(p => !p.sample); D.groups = D.groups.filter(g => !D.deleted[g.id]); D.log = D.log.filter(e => !e.sample);
  if(ui.filter !== 'all' && !G(ui.filter)) ui.filter = 'all';
  commit(); toast('Sample people removed');
}

/* ---------- sheet + toast ---------- */
function sheet(h){ $('#sheet').innerHTML = h; $('#scrim').classList.add('on'); document.body.style.overflow = 'hidden' }
function closeSheet(){ ui.fromPlan = null; $('#scrim').classList.remove('on'); document.body.style.overflow = '' }
let toastT;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200) }

/* ---------- render ---------- */
function render(){
  renderNav();
  const v = $('#view'); v.innerHTML = (views[ui.view] || views.people)();
  document.body.classList.toggle('colour', colourOn());
}
function softRender(){
  const a = document.activeElement;
  if(a && a.closest && a.closest('#view') && /INPUT|TEXTAREA/.test(a.tagName)){ paintSync(); return }
  render();
}

/* ---------- boot ---------- */
async function boot(){
  $('#scrim').addEventListener('click', e => { if(e.target.id === 'scrim') closeSheet() });
  document.addEventListener('keydown', e => { if(e.key === 'Escape') closeSheet() });
  try{
    const [data, a, keys] = await Promise.all([idb.get('data'), idb.get('acct'), idb.keys()]);
    if(data) D = {...blank(), ...data};
    let moved = false;   // older versions kept notes on each person: move them into the log
    for(const p of D.people){ for(const n of p.notes||[]) { D.log.push(touch({id:n.id, t:n.t, people:[p.id], text:n.text})); moved = true } if(p.notes){ delete p.notes; touch(p) } delete p.srs }
    for(const p of D.people) if(p.id.startsWith('slc26-') && p.team === 'Allens Sydney' && !p.firm){ p.firm = 'Allens'; p.team = ''; touch(p); moved = true }
    if(moved) idb.set('data', D);
    if(a) acct = a;
    for(const k of keys) if(String(k).startsWith('ph:')) PH[k.slice(3)] = await idb.get(k);
  }catch(e){ console.warn('storage', e); toast('This browser is blocking storage, so changes won’t be saved.') }
  if(!acct && !localStorage.getItem('rolo-skip-login') && SYNC_ON) ui.view = 'login';
  render();
  if(acct) await syncNow();
  autoPacks(); fixups();
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') syncNow() });
  window.addEventListener('online', () => syncNow());
  if('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(()=>{});
}
boot();
