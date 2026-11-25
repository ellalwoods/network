'use strict';
/* Rolo: a personal network app.
   Data is stored on the device (IndexedDB) and, when signed in, synced to Supabase
   through the rolo_* functions (see supabase/rolo.sql). The login itself is never sent:
   only a SHA-256 hash of "rolo:" + the normalised login leaves the device. */

const CFG = window.ROLO_CONFIG || {};
const SYNC_ON = !!(CFG.supabaseUrl && CFG.supabaseKey);

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
const INTERVALS = [0,1,3,7,14,30,60];   // days between reviews, by box
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
const blank = () => ({v:1, people:[], groups:[], deleted:{}, settings:{colour:false,u:0}});
let D = blank();          // synced document
let PH = {};              // person id -> {d: dataURL|null, t: updated ms}
let acct = null;          // {label, key}; label stays on this device only
const sync = {state: SYNC_ON ? 'idle' : 'off', last: 0, err: ''};
const ui = {view:'orbit', filter:'all', q:'', person:null, fc:null,
            login:{name:'', planet:null, con:null, mode:'signin', busy:false, msg:'', pending:null},
            sel:new Set(), ring:3, photo:undefined, gcolour:'kwm'};

const colourOn = () => !!D.settings.colour;
const G = id => D.groups.find(g => g.id === id);
const P = id => D.people.find(p => p.id === id);
const pal = id => PALETTE.find(x => x.id === id) || PALETTE[0];
const gHex = g => g ? pal(g.pc).hex : NOGROUP;
const pHex = p => gHex(G((p.groups||[]).find(id => G(id))));
const inG = gid => D.people.filter(p => (p.groups||[]).includes(gid));
const isDue = p => !p.srs || p.srs.due <= now();
const touch = x => { x.u = now(); return x };

function commit(){ idb.set('data', D); render(); schedulePush() }

/* ---------- photos ---------- */
function compress(file){
  return new Promise((res,rej) => { const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { const S=420, c=document.createElement('canvas'); c.width=c.height=S; const s=Math.min(img.width,img.height);
      c.getContext('2d').drawImage(img,(img.width-s)/2,(img.height-s)*.3,s,s,0,0,S,S); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg',.82)) };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read that image')) };
    img.src = url });
}
function setPhoto(id, d){ PH[id] = {d, t:now()}; idb.set('ph:'+id, PH[id]) }
const photoOf = p => PH[p.id] && PH[p.id].d;

/* ---------- sync ---------- */
async function rpc(fn, args){
  const r = await fetch(`${CFG.supabaseUrl.replace(/\/$/,'')}/rest/v1/rpc/${fn}`, {method:'POST',
    headers:{apikey:CFG.supabaseKey, Authorization:'Bearer '+CFG.supabaseKey, 'Content-Type':'application/json'}, body:JSON.stringify(args)});
  if(r.status === 404) throw new Error('NOT_SETUP');
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
  return {v:1, deleted:del, people:mergeList(L.people,R.people,del), groups:mergeList(L.groups,R.groups,del),
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
    sync.err = e.message === 'NOT_SETUP' ? 'The sync database isn’t set up yet. Your changes are safe on this device.' : 'Couldn’t reach the sync server. Your changes are safe on this device and will sync later.';
    console.warn('sync', e);
  }
  syncing = false; softRender();
  if(again){ again = false; syncNow() }
}
function paintSync(){ const el = $('#syncdot'); if(el) el.dataset.s = sync.state }

/* ---------- navigation ---------- */
const NAV = [['orbit','Orbit'],['index','Index'],['drill','Drill'],['groups','Groups']];
function go(v){ ui.view = v; if(v === 'drill') ui.fc = null; render(); window.scrollTo(0,0) }
function openPerson(id){ ui.person = id; go('person') }
function setFilter(f){ ui.filter = f; render() }

function renderNav(){
  const v = ui.view === 'person' ? 'index' : ui.view;
  const sw = g => colourOn() ? `<i class="sw" style="background:${gHex(g)}"></i>` : '';
  $('#side').innerHTML =
    `<div class="brand">Rolo<span id="syncdot" data-s="${sync.state}" title="Sync status"></span></div>` +
    NAV.map(([k,l],i) => `<button class="navbtn ${v===k?'on':''}" onclick="go('${k}')"><span>${l}</span><span>0${i+1}</span></button>`).join('') +
    `<div class="mono grey" style="padding:22px 20px 8px">Groups</div>` +
    D.groups.map(g => `<button class="grp" onclick="ui.filter='${g.id}';go('index')"><span>${sw(g)}${esc(g.name)}</span><span>${pad(inG(g.id).length)}</span></button>`).join('') +
    `<button class="grp grey" onclick="openGroupSheet()"><span>+ New group</span><span></span></button>` +
    `<button class="navbtn ${v==='settings'?'on':''}" style="margin-top:auto;border-top:1px solid var(--soft)" onclick="go('settings')"><span>Settings</span><span>05</span></button>` +
    `<button class="newbtn" onclick="openPersonSheet()">+ New person</button>`;
  $('#tabbar').innerHTML = NAV.map(([k,l]) => `<button class="${v===k?'on':''}" onclick="go('${k}')">${l}</button>`).join('') +
    `<button class="add" onclick="openPersonSheet()" aria-label="Add person">+</button>`;
  $('#tabbar').style.display = ui.view === 'login' ? 'none' : '';
}

/* ---------- shared fragments ---------- */
function faceBox(p, cls, extraStyle=''){
  const d = photoOf(p), t = tones(pHex(p));
  const style = colourOn() ? `background:${t.soft};color:${t.deep};` : '';
  return `<div class="${cls}" style="${style}${extraStyle}">${d ? `<img src="${d}" alt="">` : esc(ini(p))}</div>`;
}
const row = (p, n, right='') => `<button class="ent" onclick="openPerson('${p.id}')"><span class="n">${pad(n)}</span>${faceBox(p,'ph')}<div style="min-width:0"><b>${esc(fullName(p))}</b><small>${esc([p.role,p.team].filter(Boolean).join(' / ') || '—')}</small></div>${right}</button>`;
const groupFilters = (cur, fn, extra='') => `<div class="filters"><button class="${cur==='all'?'on':''}" onclick="${fn}('all')">All</button>${D.groups.map(g => `<button class="${cur===g.id?'on':''}" onclick="${fn}('${g.id}')">${colourOn()?`<i class="sw" style="background:${gHex(g)}"></i>`:''}${esc(g.short||g.name)}</button>`).join('')}${extra}</div>`;
const today = () => new Date().toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'});

/* ---------- orbit ---------- */
function sectors(){
  const s = [...D.groups];
  if(D.people.some(p => !(p.groups||[]).some(id => G(id)))) s.push({id:'_none', name:'No group', short:'Other', pc:null});
  return s;
}
function orbitSVG(){
  const C=210, R={1:78,2:132,3:186}, secs=sectors(), n=Math.max(secs.length,1), step=2*Math.PI/n, start=-Math.PI/2, col=colourOn();
  const secOf = p => { const g = (p.groups||[]).find(id => G(id)); return g || '_none' };
  const dimG = id => ui.filter !== 'all' && ui.filter !== id;
  let s = `<svg class="orbit" viewBox="-60 -6 540 432" font-family="JetBrains Mono, monospace" role="img" aria-label="Orbit map of your network"><defs>`, body = '';
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
    const m = n > 1 ? a+step/2 : start, cx = Math.cos(m), lx = C+203*cx, ly = C+(n>1?203:208)*Math.sin(m), anchor = cx > .35 ? 'start' : cx < -.35 ? 'end' : 'middle';
    const label = (g.short||g.name).toUpperCase().slice(0,16);
    body += `<text x="${lx}" y="${ly}" font-size="9" letter-spacing=".8" text-anchor="${anchor}" dominant-baseline="middle" fill="${col?tones(g.pc?gHex(g):NOGROUP).deep:'#111110'}" font-weight="${col?600:400}" opacity="${dimG(g.id)?.25:1}" style="cursor:pointer" onclick="setFilter(ui.filter==='${g.id}'?'all':'${g.id}')">${esc(label)}</text>`;
  });
  body += `<circle cx="${C}" cy="${C}" r="24" fill="#111110"/><text x="${C}" y="${C+1}" font-size="9" letter-spacing="1" text-anchor="middle" dominant-baseline="middle" fill="#FBFAF7">YOU</text>`;
  secs.forEach((g,gi) => [1,2,3].forEach(ring => {
    const ps = D.people.filter(p => secOf(p) === g.id && (p.ring||3) === ring).sort((a,b) => (a.n||0)-(b.n||0));
    const rr = Math.max(7, Math.min(15, (R[ring]*step)/(ps.length+1)/2.3));
    ps.forEach((p,k) => {
      const a = start+gi*step+step*(k+1)/(ps.length+1), x = +(C+R[ring]*Math.cos(a)).toFixed(1), y = +(C+R[ring]*Math.sin(a)).toFixed(1);
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
        ${isDue(p) ? `<circle cx="${x+rr*.72}" cy="${y-rr*.72}" r="3.6" fill="#111110" stroke="#F3F2EE" stroke-width="1.5"/>` : ''}
        ${rr >= 11 ? `<text x="${x}" y="${y+rr+11}" font-size="8" text-anchor="middle" fill="#8C8B86">${esc((p.first||'').toUpperCase().slice(0,12))}</text>` : ''}</g>`;
    });
  }));
  return s + `</defs>` + body + `</svg>`;
}

/* ---------- views ---------- */
const views = {};

views.orbit = () => {
  const due = D.people.filter(isDue), fol = D.people.filter(p => p.follow);
  const head = `<div class="bar mono"><span>${today()}</span><button class="grey" onclick="go('settings')">Settings</button></div>`;
  if(!D.people.length) return head + `
    <div class="title">Your<br>orbit</div>
    <div class="empty">
      <p>This is where everyone you meet will orbit around you, grouped by context and placed closer the better you know them.</p>
      <div class="btnrow"><button class="btn" onclick="openPersonSheet()">+ Add your first person</button><button class="btn ghost" onclick="openGroupSheet()">+ Create a group</button></div>
      <button class="link mono" onclick="loadSamples()">Or explore with sample people →</button>
    </div>`;
  const tag = p => colourOn() ? `style="background:${tones(pHex(p)).wash};border-color:${tones(pHex(p)).deep};color:${tones(pHex(p)).deep}"` : '';
  return head + `
  <div class="stats">
    <button onclick="go('index')"><b>${pad(D.people.length)}</b><span class="mono grey">People</span></button>
    <button onclick="go('drill')"><b>${pad(due.length)}</b><span class="mono grey">Due to drill</span></button>
    <button onclick="document.getElementById('fol')?.scrollIntoView({behavior:'smooth'})"><b>${pad(fol.length)}</b><span class="mono grey">Follow-ups</span></button>
  </div>
  <div class="orbitwrap">
    <div>
      ${groupFilters(ui.filter,'setFilter').replace('class="filters"','class="filters" style="border-top:0"')}
      ${orbitSVG()}
      <div class="legend mono grey"><span><i class="lg-due"></i>Due to drill</span><span><i class="lg-ring"></i>Inner ring = closer</span>${colourOn()?'<span><i class="lg-ring" style="border:0;background:linear-gradient(90deg,#AF005F,#F3D9E6)"></i>Brighter = closer</span>':''}</div>
    </div>
    <div>
      <div class="sect mono" style="border-top:1px solid var(--ink)"><span>Due to drill</span>${due.length?`<button class="grey" onclick="go('drill')">Start →</button>`:''}</div>
      ${due.slice(0,6).map((p,i) => row(p,i+1)).join('') || `<p class="emptyrow grey">All caught up.</p>`}
      ${due.length > 6 ? `<button class="sect mono grey" style="width:100%" onclick="go('drill')"><span>+ ${due.length-6} more</span><span>→</span></button>` : ''}
      <div id="fol" class="sect mono" style="border-top:1px solid var(--ink);margin-top:-1px"><span>Follow-ups</span><span class="grey">${pad(fol.length)}</span></div>
      ${fol.map((p,i) => row(p,i+1,`<span class="tagline" ${tag(p)}>${esc(p.follow)}</span>`)).join('') || `<p class="emptyrow grey">No follow-ups. Add one from someone’s page.</p>`}
    </div>
  </div>`;
};

function filteredPeople(){
  const q = norm(ui.q);
  return D.people.filter(p => (ui.filter==='all' || (p.groups||[]).includes(ui.filter)) &&
      (!q || norm([p.first,p.last,p.team,p.role,p.hook,p.met,p.follow,...(p.notes||[]).map(n=>n.text),...(p.groups||[]).map(id=>G(id)?.name)].join(' ')).includes(q)))
    .sort((a,b) => fullName(a).localeCompare(fullName(b)));
}
const listHTML = () => { const l = filteredPeople(); return l.map(p => row(p, p.n||0, p.follow?`<span class="tagline">Follow up</span>`:'')).join('') ||
  `<p class="emptyrow grey">${D.people.length ? 'No one matches.' : 'No one here yet.'}</p>` };
views.index = () => `
  <div class="bar mono"><span>Rolo / Index</span><span class="grey">${pad(filteredPeople().length)} entries</span></div>
  <div class="title">Index</div>
  ${groupFilters(ui.filter,'setFilter',`<button onclick="openGroupSheet()">+ Group</button>`)}
  <div class="search"><span class="mono grey">Search</span><input id="q" value="${esc(ui.q)}" placeholder="Name, team, or a detail" oninput="ui.q=this.value;document.getElementById('list').innerHTML=listHTML()" autocomplete="off"></div>
  <div id="list">${listHTML()}</div>`;

views.person = () => {
  const p = P(ui.person); if(!p){ ui.view='index'; return views.index() }
  const t = tones(pHex(p)), col = colourOn();
  const wash = col ? `style="background:${t.wash}"` : '';
  const fact = (k,v) => v ? `<div><span>${k}</span><span>${v}</span></div>` : '';
  const link = (u,l) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a>`;
  const li = p.linkedin ? (/^https?:\/\//.test(p.linkedin) ? p.linkedin : 'https://'+p.linkedin) : '';
  return `
  <div class="bar mono"><button onclick="go('index')">← Index</button><button class="grey" onclick="openPersonSheet('${p.id}')">Edit</button></div>
  <div class="profile" style="border-top:0">
    <div>
      ${faceBox(p,'portrait')}
      <div class="pname">${esc(p.first)}<br>${esc(p.last)}</div>
      <div class="facts">
        ${fact('Role',esc(p.role))}${fact('Team',esc(p.team))}${fact('Met',esc(p.met))}
        ${fact('Groups',(p.groups||[]).map(id=>G(id)).filter(Boolean).map(g=>`<button class="glink" onclick="ui.filter='${g.id}';go('index')">${esc(g.name)}</button>`).join(', '))}
        ${fact('Email',p.email?link('mailto:'+p.email,p.email):'')}${fact('Phone',p.phone?link('tel:'+p.phone,p.phone):'')}${fact('LinkedIn',li?link(li,'Profile ↗'):'')}
        <div><span>Orbit</span><span class="rings">${RINGS.map((l,i)=>`<button class="${(p.ring||3)===i+1?'on':''}" onclick="setRing('${p.id}',${i+1})">${l}</button>`).join('')}</span></div>
        <div><span>Recall</span><span class="mono">${p.srs ? `${'●'.repeat(Math.min(p.srs.box,6))}${'○'.repeat(6-Math.min(p.srs.box,6))} · ${isDue(p)?'due now':'next '+fmtDate(p.srs.due)}` : 'Not drilled yet'}</span></div>
      </div>
    </div>
    <div>
      <div class="hook" ${wash}><span class="mono grey">Memory hook</span><p>${p.hook ? esc(p.hook) : `<button class="grey" onclick="openPersonSheet('${p.id}','hook')">+ Add something to remember them by</button>`}</p></div>
      <div class="hook"><span class="mono grey">Follow-up</span>
        ${p.follow ? `<p>${esc(p.follow)}</p><button class="btn small" style="margin-top:12px" onclick="doneFollow('${p.id}')">✓ Done</button>`
          : `<form class="inline" onsubmit="setFollow(event,'${p.id}')"><input name="f" placeholder="e.g. Coffee in December" autocomplete="off"><button class="mono">Set</button></form>`}
      </div>
      <div class="sect mono"><span>Notes</span><span class="grey">${pad((p.notes||[]).length)}</span></div>
      <form class="inline note-add" onsubmit="addNote(event,'${p.id}')"><input name="t" placeholder="Add a note: something they mentioned…" autocomplete="off"><button class="mono">Add</button></form>
      ${(p.notes||[]).slice().sort((a,b)=>b.t-a.t).map(n => `<div class="note"><span class="mono grey">${fmtDate(n.t)}</span><span>${esc(n.text)}</span><button class="x" title="Delete note" onclick="delNote('${p.id}','${n.id}')">×</button></div>`).join('')}
    </div>
  </div>`;
};

views.groups = () => `
  <div class="bar mono"><span>Rolo / Groups</span><span class="grey">${pad(D.groups.length)} groups</span></div>
  <div class="title">Groups</div>
  <p class="intro grey">Make a group for any context: a cohort, a team, an event. One person can be in as many groups as you like.</p>
  <div style="border-top:1px solid var(--ink)">
  ${D.groups.map((g,i) => { const h = gHex(g); return `<div class="glrow" style="${colourOn()?`box-shadow:inset 6px 0 0 ${h};background:linear-gradient(90deg,${tones(h).wash},transparent 70%)`:''}">
      <button class="gl" onclick="ui.filter='${g.id}';go('index')"><span class="mono grey">${pad(i+1)}</span><b>${esc(g.name)}</b><span class="ct">${pad(inG(g.id).length)}</span></button>
      <button class="mono grey gedit" onclick="openGroupSheet('${g.id}')">Edit</button></div>` }).join('')}
  <button class="gl" onclick="openGroupSheet()"><span class="mono grey">+</span><b class="grey">New group</b><span></span></button></div>`;

/* ---------- drill (spaced repetition) ---------- */
function buildDeck(deck){
  let ps = deck === 'due' ? D.people.filter(isDue) : deck === 'all' ? [...D.people] : inG(deck);
  ps = ps.map(p => [Math.random(), p.id]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
  ui.fc = {deck, queue:ps, i:0, flipped:false, requeued:new Set(), got:0};
}
function setDeck(d){ buildDeck(d); render() }
function rate(r){
  const f = ui.fc, p = P(f.queue[f.i]); if(!p) return;
  const s = p.srs || {box:0, due:0};
  if(r === 0){ s.box = 1; s.due = now() + DAY; if(!f.requeued.has(p.id)){ f.queue.push(p.id); f.requeued.add(p.id) } }
  else if(r === 1){ s.box = Math.max(1, s.box); s.due = now() + INTERVALS[s.box]*DAY*.6 }
  else { s.box = Math.min(s.box+1, 6); s.due = now() + INTERVALS[s.box]*DAY; f.got++ }
  p.srs = s; touch(p);
  f.i++; f.flipped = false; idb.set('data', D); schedulePush(); render();
}
views.drill = () => {
  if(!ui.fc) buildDeck(D.people.some(isDue) ? 'due' : 'all');
  const f = ui.fc, q = f.queue;
  const head = `<div class="bar mono"><span>Rolo / Drill</span><span class="grey">${String(Math.min(f.i+1,q.length)).padStart(2,'0')}/${String(q.length).padStart(2,'0')}</span></div>
    <div class="filters" style="border-top:0"><button class="${f.deck==='due'?'on':''}" onclick="setDeck('due')">Due</button><button class="${f.deck==='all'?'on':''}" onclick="setDeck('all')">Everyone</button>${D.groups.map(g=>`<button class="${f.deck===g.id?'on':''}" onclick="setDeck('${g.id}')">${esc(g.short||g.name)}</button>`).join('')}</div>`;
  if(!D.people.length) return head + `<div class="drill"><div class="title" style="padding:40px 0 10px">Nobody<br>yet.</div><p class="grey" style="margin-bottom:24px">Add people with a photo and you can drill their faces here.</p><button class="btn" onclick="openPersonSheet()">+ Add person</button></div>`;
  if(!q.length) return head + `<div class="drill"><div class="title" style="padding:40px 0 10px">All<br>clear.</div><p class="grey" style="margin-bottom:24px">Nobody in this deck is due. Drill everyone anyway?</p><button class="btn" onclick="setDeck('all')">Drill everyone →</button></div>`;
  if(f.i >= q.length) return head + `<div class="drill"><div class="title" style="padding:40px 0 10px">Done.</div><p class="mono grey" style="margin-bottom:24px">${pad(f.got)} remembered · ${pad(new Set(q).size)} reviewed</p><button class="btn" onclick="setDeck('${f.deck}')">Again →</button></div>`;
  const p = P(q[f.i]); if(!p){ f.i++; return views.drill() }
  const t = tones(pHex(p)), col = colourOn(), d = photoOf(p);
  const g = G((p.groups||[]).find(id=>G(id)));
  const front = d ? `<div class="big photo-big"><img src="${d}" alt=""></div>` :
    `<div class="big clue"><span class="mono" style="opacity:.7">No photo · clues</span><p>${esc([p.role,p.team].filter(Boolean).join(', ')||'—')}</p>${p.met?`<p class="sm">Met: ${esc(p.met)}</p>`:''}${p.hook?`<p class="sm">“${esc(p.hook)}”</p>`:''}</div>`;
  return head + `<div class="drill">
    <div class="prog">${q.map((_,k)=>`<i class="${k<f.i?'done':''}"></i>`).join('')}</div>
    <div class="flip ${f.flipped?'on':''}" onclick="ui.fc.flipped=!ui.fc.flipped;this.classList.toggle('on')">
      <div class="flip-in">
        <div class="fa" style="${col?`background:${t.base};color:${onC(t.base)}`:''}"><div class="foot mono" style="border-top:0;border-bottom:1px solid currentColor;opacity:.85"><span>${pad(p.n||0)}: Who?</span><span>${esc(g?(g.short||g.name):'')}</span></div>${front}<div class="foot mono" style="opacity:.85"><span>Tap to reveal</span><span>↻</span></div></div>
        <div class="fb" ${col?`style="background:${t.wash}"`:''}><div class="pname">${esc(p.first)}<br>${esc(p.last)}</div>
          <div class="facts">${p.role?`<div><span>Role</span><span>${esc(p.role)}</span></div>`:''}${p.team?`<div><span>Team</span><span>${esc(p.team)}</span></div>`:''}${p.met?`<div><span>Met</span><span>${esc(p.met)}</span></div>`:''}</div>
          ${p.hook?`<div class="hk"><span class="mono grey" style="display:block;margin-bottom:4px">Memory hook</span>${esc(p.hook)}</div>`:''}</div>
      </div>
    </div>
    <div class="rate"><button onclick="rate(0)">Forgot</button><button onclick="rate(1)">Almost</button><button onclick="rate(2)">Got it</button></div>
  </div>`;
};

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
  <div class="bar mono"><span>Rolo / Settings</span><span class="grey">v1.0</span></div>
  <div class="title">Settings</div>
  <div class="sect mono" style="border-top:1px solid var(--ink)"><span>Appearance</span></div>
  <div class="set"><div><b>Colour mode</b><small>Give each group its own colour across the orbit, index and drill. Off = black and white.</small></div>${tog(col,'setColour('+!col+')')}</div>
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
  <button class="set" style="width:100%" onclick="exportData()"><div><b>Export backup</b><small>Download everyone, notes and photos as a file</small></div><span class="mono grey">↓</span></button>
  <label class="set" style="cursor:pointer"><div><b>Import backup</b><small>Merge a Rolo backup file into this orbit</small></div><span class="mono grey">↑</span><input type="file" accept="application/json,.json" hidden onchange="importData(this)"></label>
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
  return `<div class="bar mono"><span>Rolo / ${change?'Change login':'Sign in'}</span><button class="grey" onclick="skipLogin()">${change?'Cancel':'Not now'}</button></div>
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
function skipLogin(){ localStorage.setItem('rolo-skip-login','1'); go(ui.login.mode==='change'?'settings':'orbit') }
async function submitLogin(){
  const L = ui.login; if(!loginReady() || L.busy) return;
  if(!SYNC_ON){ L.msg = 'Sync isn’t set up in this copy of the app yet. Tap “Not now” to keep using Rolo on this device.'; return render() }
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
        L.busy = false; toast('Welcome back'); go('orbit'); syncNow(); return }
      L.pending = {label, key}; L.busy = false; render();
      return sheet(`<div class="title">New<br>orbit?</div>
        <p class="intro" style="padding-top:0">There’s no orbit for <b>${esc(label)}</b> yet.${D.people.length?` The ${D.people.length} ${D.people.length===1?'person':'people'} on this device will come with you.`:''}</p>
        <p class="intro grey" style="padding-top:0">If you already have an orbit, go back and check your name, planet and constellation.</p>
        <div class="sheetbtns"><button onclick="closeSheet()">Back</button><button onclick="confirmNewOrbit()">Start new orbit →</button></div>`);
    }
  }catch(e){
    console.warn(e);
    L.msg = e.message === 'NOT_SETUP' ? 'The sync database isn’t set up yet (run supabase/rolo.sql). Tap “Not now” to keep working on this device.'
      : 'Couldn’t reach the sync server. Check your connection, or tap “Not now” to keep working on this device.';
  }
  L.busy = false; render();
}
async function confirmNewOrbit(){
  closeSheet(); acct = ui.login.pending; ui.login.pending = null;
  await idb.set('acct', acct); toast('New orbit created'); go('orbit'); syncNow();
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

/* ---------- person actions ---------- */
function setRing(id, r){ const p = P(id); p.ring = r; touch(p); commit() }
function addNote(e, id){ e.preventDefault(); const v = e.target.t.value.trim(); if(!v) return; const p = P(id);
  (p.notes = p.notes || []).push({id:uid(), t:now(), text:v}); touch(p); commit(); }
function delNote(pid, nid){ const p = P(pid); p.notes = (p.notes||[]).filter(n => n.id !== nid); touch(p); commit() }
function setFollow(e, id){ e.preventDefault(); const v = e.target.f.value.trim(); if(!v) return; const p = P(id); p.follow = v; touch(p); commit() }
function doneFollow(id){ const p = P(id); (p.notes = p.notes||[]).push({id:uid(), t:now(), text:'✓ '+p.follow}); p.follow = ''; touch(p); commit(); toast('Follow-up done') }

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

function openPersonSheet(id, focus){
  const p = id ? P(id) : null;
  ui.sel = new Set(p ? (p.groups||[]).filter(g=>G(g)) : (ui.filter!=='all' && G(ui.filter) ? [ui.filter] : []));
  ui.ring = p ? (p.ring||3) : 3; ui.photo = undefined;
  const v = k => esc(p ? p[k]||'' : '');
  const d = p && photoOf(p);
  sheet(`<form onsubmit="savePerson(event,${p?`'${p.id}'`:'null'})">
    <div class="title">${p?'Edit':'New'}<br>person</div>
    <label class="photo" id="photoBox">${d?`<img src="${d}" alt="">`:'<span class="mono grey">+ Add photo</span>'}<input type="file" accept="image/*" hidden onchange="pickPhoto(this)"></label>
    ${d?`<button type="button" class="link mono" style="margin:0 20px 6px" onclick="ui.photo=null;document.getElementById('photoBox').innerHTML='<span class=&quot;mono grey&quot;>Photo removed · tap to add</span><input type=&quot;file&quot; accept=&quot;image/*&quot; hidden onchange=&quot;pickPhoto(this)&quot;>'">Remove photo</button>`:''}
    <div class="two"><label class="fld"><span class="mono grey">First name</span><input name="first" value="${v('first')}" required autocomplete="off" autocapitalize="words"></label>
    <label class="fld"><span class="mono grey">Last name</span><input name="last" value="${v('last')}" autocomplete="off" autocapitalize="words"></label></div>
    <div class="two"><label class="fld"><span class="mono grey">Role</span><input name="role" value="${v('role')}" placeholder="Associate" autocomplete="off"></label>
    <label class="fld"><span class="mono grey">Team</span><input name="team" value="${v('team')}" placeholder="Disputes" autocomplete="off"></label></div>
    <div class="fld"><span class="mono grey">Groups</span><div class="opts" id="chips">${chipsHTML()}</div></div>
    <div class="fld"><span class="mono grey">Orbit · how well you know them</span><div class="opts">${RINGS.map((l,i)=>`<button type="button" class="opt ${ui.ring===i+1?'on':''}" onclick="ui.ring=${i+1};pickOne(this)">${l}</button>`).join('')}</div></div>
    <label class="fld"><span class="mono grey">Where you met</span><input name="met" value="${v('met')}" placeholder="Clerkship welcome drinks" autocomplete="off"></label>
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
async function pickPhoto(input){
  const file = input.files && input.files[0]; if(!file) return;
  try{ ui.photo = await compress(file); $('#photoBox').innerHTML = `<img src="${ui.photo}" alt=""><input type="file" accept="image/*" hidden onchange="pickPhoto(this)">` }
  catch(e){ toast(e.message) }
}
function savePerson(e, id){
  e.preventDefault(); const f = new FormData(e.target), val = k => (f.get(k)||'').toString().trim();
  let p = id ? P(id) : null;
  if(!p){ p = {id:uid(), n:Math.max(0,...D.people.map(x=>x.n||0))+1, notes:[], created:now()}; D.people.push(p) }
  Object.assign(p, {first:val('first'), last:val('last'), role:val('role'), team:val('team'), met:val('met'), hook:val('hook'), follow:val('follow'),
                    email:val('email'), phone:val('phone'), linkedin:val('linkedin'), groups:[...ui.sel], ring:ui.ring});
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
  if(PH[id]) setPhoto(id, null);
  closeSheet(); ui.view = 'index'; commit(); toast('Deleted');
}

/* ---------- group actions ---------- */
function openGroupSheet(id){
  const g = id ? G(id) : null; ui.gcolour = g ? g.pc : (PALETTE.find(x=>!D.groups.map(g=>g.pc).includes(x.id))||PALETTE[0]).id;
  sheet(`<form onsubmit="saveGroup(event,${g?`'${g.id}'`:'null'})"><div class="title">${g?'Edit':'New'}<br>group</div>
    <label class="fld"><span class="mono grey">Name</span><input name="name" value="${esc(g?g.name:'')}" placeholder="Summer clerkship 2026" required autocomplete="off"></label>
    <label class="fld"><span class="mono grey">Short label · for tabs and the orbit</span><input name="short" value="${esc(g?g.short:'')}" placeholder="Clerkship" maxlength="14" autocomplete="off"></label>
    <div class="fld"><span class="mono grey">Colour · used in colour mode</span><div class="swatches" style="justify-content:flex-start;max-width:none;margin-top:10px">${PALETTE.map(x=>`<button type="button" class="swb ${ui.gcolour===x.id?'on':''}" style="background:${x.hex}" title="${esc(x.firm+' · '+x.name)}" onclick="ui.gcolour='${x.id}';this.parentNode.querySelectorAll('.swb').forEach(b=>b.classList.remove('on'));this.classList.add('on')"></button>`).join('')}</div></div>
    ${g?`<button type="button" class="link mono danger" style="margin:14px 20px 0" onclick="deleteGroup('${g.id}')">Delete group (people stay)</button>`:''}
    <div class="sheetbtns"><button type="button" onclick="closeSheet()">Cancel</button><button type="submit">${g?'Save':'Create'} →</button></div></form>`);
  if(!g) $('#sheet [name=name]').focus();
}
function saveGroup(e, id){
  e.preventDefault(); const f = new FormData(e.target); const name = f.get('name').toString().trim(); if(!name) return;
  const short = f.get('short').toString().trim();
  let g = id ? G(id) : newGroup(name, ui.gcolour);
  g.name = name; g.short = short || (name.length <= 12 ? name : name.split(/\s+/)[0].slice(0,12)); g.pc = ui.gcolour; touch(g);
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
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `rolo-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importData(input){
  const file = input.files && input.files[0]; if(!file) return;
  try{ const j = JSON.parse(await file.text()); if(j.app !== 'rolo' || !j.data) throw new Error();
    D = merge(D, j.data);
    for(const [id,l] of Object.entries(j.photos||{})) if(!PH[id] || PH[id].t < l.t){ PH[id] = l; await idb.set('ph:'+id, l) }
    commit(); toast('Backup imported');
  }catch(e){ toast('That isn’t a Rolo backup file') }
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
    srs: Math.random() < .6 ? {box:2, due:now()+3*DAY} : undefined})));
  [gC,gP,gD,gM].forEach(g => g.sample = true);
  commit(); toast('Sample people added');
}
function removeSamples(){
  const t = now();
  D.people.filter(p => p.sample).forEach(p => D.deleted[p.id] = t);
  D.groups.filter(g => g.sample && !D.people.some(p => !p.sample && (p.groups||[]).includes(g.id))).forEach(g => D.deleted[g.id] = t);
  D.people = D.people.filter(p => !p.sample); D.groups = D.groups.filter(g => !D.deleted[g.id]);
  if(ui.filter !== 'all' && !G(ui.filter)) ui.filter = 'all';
  commit(); toast('Sample people removed');
}

/* ---------- sheet + toast ---------- */
function sheet(h){ $('#sheet').innerHTML = h; $('#scrim').classList.add('on'); document.body.style.overflow = 'hidden' }
function closeSheet(){ $('#scrim').classList.remove('on'); document.body.style.overflow = '' }
let toastT;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200) }

/* ---------- render ---------- */
function render(){
  renderNav();
  const v = $('#view'); v.innerHTML = (views[ui.view] || views.orbit)();
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
    if(a) acct = a;
    for(const k of keys) if(String(k).startsWith('ph:')) PH[k.slice(3)] = await idb.get(k);
  }catch(e){ console.warn('storage', e); toast('This browser is blocking storage, so changes won’t be saved.') }
  if(!acct && !localStorage.getItem('rolo-skip-login') && SYNC_ON) ui.view = 'login';
  render();
  if(acct) syncNow();
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') syncNow() });
  window.addEventListener('online', () => syncNow());
  if('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(()=>{});
}
boot();
