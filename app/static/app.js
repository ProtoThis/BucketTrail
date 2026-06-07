// ════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════
const STORE = 'buckettrail_v1';
let state = { places: [], trips: [] };
let editCtx = null;      // { kind:'place'|'trip', id:string|null }
let editorMap = null, editorMapInited = false;
let tripsMap = null, tripsMapInited = false;
let pinMode = false;
let pendingLat = null, pendingLng = null;
const markers = {};       // placeId → L.Marker on main map
let edMarkers = [];       // markers on editor map
let tmMarkers = [];       // markers on trips map
let pSearchTimer = null, addrTimer = null;

// ════════════════════════════════════════════
// PERSIST
// ════════════════════════════════════════════
async function save() {
  try {
    const response = await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    });
    if (!response.ok) throw new Error(`Save failed with status ${response.status}`);
    localStorage.setItem(STORE, JSON.stringify(state)); // browser fallback/cache
  } catch(e) {
    console.warn('Saving to API failed; falling back to localStorage only.', e);
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch(_) {}
  }
}

function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return { places: [], trips: [] };
  return {
    places: Array.isArray(raw.places) ? raw.places : [],
    trips: Array.isArray(raw.trips) ? raw.trips : [],
  };
}

async function load() {
  try {
    const r = await fetch('/api/state');
    if (r.ok) {
      state = normalizeState(await r.json());
    } else {
      throw new Error(`Load failed with status ${r.status}`);
    }
  } catch(e) {
    console.warn('Loading from API failed; falling back to localStorage.', e);
    try {
      const s = localStorage.getItem(STORE);
      if (s) state = normalizeState(JSON.parse(s));
    } catch(_) {}
  }
  if (!state.places.length && !state.trips.length) seed();
}
function seed() {
  state.places = [
    { id:uid(), name:'Efteling',            cat:'do',    emoji:'🎢', lat:51.6497, lng:5.0453, addr:'Efteling, Kaatsheuvel, NL',        notes:'Magical theme park — book online!', url:'https://efteling.com' },
    { id:uid(), name:'Beekse Bergen Safari', cat:'see',   emoji:'🦁', lat:51.5342, lng:5.1102, addr:'Beekse Bergen, Hilvarenbeek, NL',  notes:'Safari by car and on foot. Arrive early.', url:'' },
    { id:uid(), name:'Bruges city centre',   cat:'see',   emoji:'🏰', lat:51.2093, lng:3.2247, addr:'Markt, Bruges, Belgium',            notes:'Medieval fairytale city. Canal boats!', url:'' },
    { id:uid(), name:'Chocolate Workshop',   cat:'do',    emoji:'🍫', lat:51.2078, lng:3.2241, addr:'Bruges, Belgium',                   notes:'Kids make their own chocolate. Pre-book!', url:'' },
    { id:uid(), name:'Frituur Dulle Griet',  cat:'eat',   emoji:'🍟', lat:51.2102, lng:3.2258, addr:'Bruges, Belgium',                   notes:'Best frites in Bruges.', url:'' },
    { id:uid(), name:'Hotel Dukes Palace',   cat:'hotel', emoji:'🏨', lat:51.2111, lng:3.2228, addr:'Prinsenhof 8, Bruges',              notes:'Stunning hotel, great breakfast.', url:'' },
  ];
  state.trips = [{
    id:uid(), name:'Bruges weekend', type:'overnight', date:'2025-09-06',
    notes:'Stay 2 nights, bring rain gear!',
    placeIds:[state.places[2].id, state.places[3].id, state.places[4].id],
    hotelIds:[state.places[5].id],
    done:true, doneDate:'2025-09-08', visited:{}
  }];
  save();
}

// ════════════════════════════════════════════
// MAIN MAP
// ════════════════════════════════════════════
const map = L.map('map', { zoomControl:false }).setView([51.5,5.0], 7);
L.control.zoom({ position:'bottomright' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution:'© OpenStreetMap © CARTO', maxZoom:19 }).addTo(map);
map.on('click', e => {
  if (!pinMode) return;
  pendingLat = e.latlng.lat; pendingLng = e.latlng.lng;
  togglePinMode();
  openPlaceEditor(null, pendingLat, pendingLng);
});

// ════════════════════════════════════════════
// TRIPS MAP (lazy)
// ════════════════════════════════════════════
function initTripsMap() {
  if (tripsMapInited) return;
  tripsMapInited = true;
  tripsMap = L.map('trips-map', { zoomControl:false, attributionControl:false }).setView([51.5,5.0], 6);
  L.control.zoom({ position:'bottomright' }).addTo(tripsMap);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom:19 }).addTo(tripsMap);
  refreshTripsMapMarkers();
}
function refreshTripsMapMarkers() {
  if (!tripsMapInited || !tripsMap) return;
  tmMarkers.forEach(m => tripsMap.removeLayer(m)); tmMarkers = [];
  state.places.forEach(p => {
    const m = L.marker([p.lat,p.lng], { icon:makeIcon(p.emoji, p.cat, 26) })
      .bindPopup(`<b>${p.emoji} ${esc(p.name)}</b><br><span style="font-size:12px;color:#888">${esc(p.addr||'')}</span>`)
      .addTo(tripsMap);
    tmMarkers.push(m);
  });
  if (state.places.length) { const b = L.latLngBounds(state.places.map(p=>[p.lat,p.lng])); tripsMap.fitBounds(b.pad(0.2)); }
}

// ════════════════════════════════════════════
// EDITOR MAP (lazy)
// ════════════════════════════════════════════
function initEditorMap() {
  if (editorMapInited) return;
  editorMapInited = true;
  editorMap = L.map('editor-map', { zoomControl:false, attributionControl:false }).setView([51.5,5.0], 6);
  L.control.zoom({ position:'bottomright' }).addTo(editorMap);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom:19 }).addTo(editorMap);
}
function editorMapShow(places) {
  initEditorMap();
  setTimeout(() => editorMap.invalidateSize(), 60);
  edMarkers.forEach(m => editorMap.removeLayer(m)); edMarkers = [];
  places.forEach(p => {
    const m = L.marker([p.lat,p.lng], { icon:makeIcon(p.emoji, p.cat, 26) })
      .bindPopup(`<b>${p.emoji} ${esc(p.name)}</b>`)
      .addTo(editorMap);
    edMarkers.push(m);
  });
  if (places.length === 1) { editorMap.setView([places[0].lat, places[0].lng], 13); }
  else if (places.length > 1) { editorMap.fitBounds(L.latLngBounds(places.map(p=>[p.lat,p.lng])).pad(0.3)); }
}

// ════════════════════════════════════════════
// ICON HELPER
// ════════════════════════════════════════════
const mCls = { see:'m-see', do:'m-do', eat:'m-eat', hotel:'m-hotel' };
const markerIcons = {
  see: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 18s5-4.9 5-9a5 5 0 1 0-10 0c0 4.1 5 9 5 9Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="9" r="1.9" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  do: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 15.5h12M6.5 15.5V7.3l3.5 2.2V7.3l3.5 2.2v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 5.5V4h9v1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  eat: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5v5M8 3.5v5M7 3.5v12M12.5 3.5v6c0 1 .8 1.8 1.8 1.8h.2v4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  hotel: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 15.5v-7h13v7M3.5 11.5h13M6 8.5V6.7c0-.7.6-1.2 1.2-1.2h1.6c.7 0 1.2.5 1.2 1.2v1.8M11 8.5V6.7c0-.7.6-1.2 1.2-1.2h1.6c.7 0 1.2.5 1.2 1.2v1.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
function makeIcon(emoji, cat, size=32) {
  const cls = mCls[cat] || 'm-do';
  const icon = markerIcons[cat] || markerIcons.do;
  const s = size, a = Math.round(s*1.37);
  return L.divIcon({ html:`<div class="cm"><div class="mp ${cls}" style="width:${s}px;height:${s}px"><span class="em">${icon}</span></div></div>`, className:'', iconSize:[s,a], iconAnchor:[s/2,a], popupAnchor:[0,-a] });
}

// ════════════════════════════════════════════
// MAIN MARKERS
// ════════════════════════════════════════════
function addMainMarker(p) {
  if (markers[p.id]) map.removeLayer(markers[p.id]);
  const m = L.marker([p.lat,p.lng], { icon:makeIcon(p.emoji,p.cat) }).addTo(map);
  const trips = state.trips.filter(t=>[...(t.placeIds||[]),...(t.hotelIds||[])].includes(p.id));
  const notesPreview = p.notes ? `${esc(p.notes.substring(0,80))}${p.notes.length>80?'…':''}` : '';
  const safeAddr = esc(p.addr || '');
  const tripNames = trips.map(t => esc(t.name)).join(', ');
  m.bindPopup(`<div class="pp-title">${p.emoji} ${esc(p.name)}</div>
    <div class="pp-sub">${safeAddr}${notesPreview?`<br>${notesPreview}`:''}</div>
    ${trips.length?`<div class="pp-tripline">🧳 ${tripNames}</div>`:''}
    <div class="pp-btns">
      <button class="pp-btn pri" onclick="map.closePopup();openPlaceEditor('${p.id}')">Edit</button>
      <button class="pp-btn" onclick="deletePlace('${p.id}')">Remove</button>
    </div>`);
  markers[p.id] = m;
}
function refreshMainMarkers() {
  Object.keys(markers).forEach(id => { if (!state.places.find(p=>p.id===id)) { map.removeLayer(markers[id]); delete markers[id]; } });
  state.places.forEach(p => addMainMarker(p));
}

// ════════════════════════════════════════════
// VIEW SWITCHING
// ════════════════════════════════════════════
let lastMainView = 'places';
function showView(v) {
  if (v !== 'editor') lastMainView = v;
  ['places','trips','editor'].forEach(x => {
    document.getElementById('v-'+x).classList.toggle('active', x===v);
  });
  document.getElementById('nb-places').classList.toggle('active', v==='places');
  document.getElementById('nb-trips').classList.toggle('active', v==='trips');
  if (v==='trips') { initTripsMap(); setTimeout(()=>tripsMap&&tripsMap.invalidateSize(),60); }
  if (v==='places') setTimeout(()=>map.invalidateSize(),60);
}

// ════════════════════════════════════════════
// PIN MODE
// ════════════════════════════════════════════
function togglePinMode() {
  pinMode = !pinMode;
  const btn = document.getElementById('pin-btn');
  const hint = document.getElementById('map-hint');
  btn.classList.toggle('active', pinMode);
  btn.textContent = pinMode ? '✕' : '📍';
  btn.title = pinMode ? 'Cancel pin' : 'Drop a pin';
  btn.setAttribute('aria-label', pinMode ? 'Cancel pin' : 'Drop a pin');
  hint.style.display = pinMode ? 'flex' : 'none';
  map.getContainer().style.cursor = pinMode ? 'crosshair' : '';
}

// ════════════════════════════════════════════
// NOMINATIM
// ════════════════════════════════════════════
async function nominatim(q) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&addressdetails=1`, { headers:{'Accept-Language':'en'} });
  return r.json();
}
function buildDrop(results, onPick) {
  if (!results.length) return '<div class="spin">No results found.</div>';
  const wrap = document.createElement('div');
  results.forEach(r => {
    const name = r.namedetails?.name || r.display_name.split(',')[0];
    const div = document.createElement('div');
    div.className = 'sri';
    div.innerHTML = `<span>📍</span><div><div class="sri-name">${esc(name)}</div><div class="sri-addr">${esc(r.display_name)}</div></div>`;
    div.onclick = () => onPick(r, name);
    wrap.appendChild(div);
  });
  return wrap;
}
function hideDrop(id) { const el=document.getElementById(id); if(el) el.style.display='none'; }

// sidebar search
function onPSearch() {
  clearTimeout(pSearchTimer);
  if (document.getElementById('p-search').value.trim().length < 3) { hideDrop('places-drop'); return; }
  pSearchTimer = setTimeout(doPSearch, 500);
}
async function doPSearch() {
  const q = document.getElementById('p-search').value.trim(); if (!q) return;
  const box = document.getElementById('places-drop');
  box.style.display = 'block'; box.innerHTML = '<div class="spin">Searching…</div>';
  try {
    const res = await nominatim(q); box.innerHTML = '';
    const items = buildDrop(res, (r, name) => {
      hideDrop('places-drop');
      document.getElementById('p-search').value = '';
      pendingLat = parseFloat(r.lat); pendingLng = parseFloat(r.lon);
      map.flyTo([pendingLat, pendingLng], 14, { duration:.7 });
      openPlaceEditor(null, pendingLat, pendingLng, name, r.display_name);
    });
    if (typeof items === 'string') box.innerHTML = items; else box.appendChild(items);
  } catch(e) { box.innerHTML = '<div class="spin">Search failed.</div>'; }
}

// editor address search
function onAddrInput() {
  clearTimeout(addrTimer);
  if (document.getElementById('ed-addr').value.trim().length < 3) { hideDrop('addr-drop'); return; }
  addrTimer = setTimeout(doAddrSearch, 500);
}
async function doAddrSearch() {
  const q = document.getElementById('ed-addr').value.trim(); if (!q) return;
  const box = document.getElementById('addr-drop');
  box.style.display = 'block'; box.innerHTML = '<div class="spin">Searching…</div>';
  try {
    const res = await nominatim(q); box.innerHTML = '';
    const items = buildDrop(res, (r, name) => {
      pendingLat = parseFloat(r.lat); pendingLng = parseFloat(r.lon);
      document.getElementById('ed-addr').value = r.display_name;
      document.getElementById('ed-loc-pill').style.display = 'inline-flex';
      document.getElementById('ed-loc-text').textContent = r.display_name.substring(0,60)+(r.display_name.length>60?'…':'');
      hideDrop('addr-drop');
      editorMapShow([{ lat:pendingLat, lng:pendingLng, emoji:document.getElementById('ed-emoji').value, cat:document.getElementById('ed-cat').value }]);
    });
    if (typeof items === 'string') box.innerHTML = items; else box.appendChild(items);
  } catch(e) { box.innerHTML = '<div class="spin">Search failed.</div>'; }
}

// outside-click closes dropdowns
document.addEventListener('click', e => {
  if (!document.getElementById('places-sw').contains(e.target)) hideDrop('places-drop');
  const aw = document.getElementById('addr-drop');
  if (aw && !aw.parentElement.contains(e.target)) hideDrop('addr-drop');
});

// ════════════════════════════════════════════
// EMOJI OPTIONS
// ════════════════════════════════════════════
const catEmojis = {
  see:   ['🏰','🦁','🌿','🏔️','🌅','🏛️','⛪','🗼','📸','🎡','⛵','🛶','🌊'],
  do:    ['🎢','🎠','🎭','🎨','🏊','⛷️','🚂','🎪','🤸','🧗','🎯','🥾','🏄','🍫'],
  eat:   ['🍕','🍟','🍦','🍫','🥞','🍺','🥗','🍔','🥐','☕','🍨','🧇','🥘'],
  hotel: ['🏨','🏩','🏡','🛏️','⛺','🏕️'],
};
function fillEmojiSel(cat, current) {
  const sel = document.getElementById('ed-emoji');
  const list = catEmojis[cat] || catEmojis.do;
  sel.innerHTML = list.map(e=>`<option ${e===current?'selected':''}>${e}</option>`).join('');
}

// ════════════════════════════════════════════
// EDITOR — open / close
// ════════════════════════════════════════════
function closeEditor() {
  showView(lastMainView);
  editCtx = null; pendingLat = null; pendingLng = null;
}

function editorSave() {
  if (!editCtx) return;
  if (editCtx.kind === 'place') savePlaceFromEditor();
  else saveTripFromEditor();
}

// ════════════════════════════════════════════
// PLACE EDITOR
// ════════════════════════════════════════════
function openPlaceEditor(id, lat, lng, prefillName, prefillAddr) {
  editCtx = { kind:'place', id };
  const p = id ? state.places.find(x=>x.id===id) : null;

  if (p) { pendingLat = p.lat; pendingLng = p.lng; }
  else if (lat != null) { pendingLat = lat; pendingLng = lng; }

  const cat   = p ? p.cat   : 'do';
  const emoji = p ? p.emoji : catEmojis.do[0];
  const name  = p ? p.name  : (prefillName||'');
  const addr  = p ? (p.addr||'') : (prefillAddr||'');
  const notes = p ? (p.notes||'') : '';
  const url   = p ? (p.url||'')   : '';

  document.getElementById('editor-title').textContent = p ? 'Edit place' : 'Add a place';
  document.getElementById('editor-back').textContent  = `← ${lastMainView === 'trips' ? 'Trips' : 'Places'}`;

  document.getElementById('editor-scroll').innerHTML = `
    <div class="field">
      <label class="fl">Name</label>
      <input type="text" id="ed-name" value="${esc(name)}" placeholder="e.g. Efteling, Canal boat ride…">
    </div>
    <div class="row2 field">
      <div>
        <label class="fl">Category</label>
        <select id="ed-cat" onchange="fillEmojiSel(this.value); editorCatChanged()">
          <option value="see"  ${cat==='see'  ?'selected':''}>👁 See</option>
          <option value="do"   ${cat==='do'   ?'selected':''}>🎠 Do</option>
          <option value="eat"  ${cat==='eat'  ?'selected':''}>🍕 Eat &amp; drink</option>
          <option value="hotel"${cat==='hotel'?'selected':''}>🏨 Hotel / sleep</option>
        </select>
      </div>
      <div>
        <label class="fl">Emoji</label>
        <select id="ed-emoji"></select>
      </div>
    </div>
    <div class="field">
      <label class="fl">Location</label>
      <div class="addr-wrap">
        <input type="text" id="ed-addr" value="${esc(addr)}" placeholder="Search address…" autocomplete="off"
          oninput="onAddrInput()" onkeydown="if(event.key==='Escape')hideDrop('addr-drop');">
        <div class="drop addr-drop" id="addr-drop" style="display:none"></div>
      </div>
      <div class="loc-pill" id="ed-loc-pill" style="${pendingLat != null ? '' : 'display:none'}">
        📌 <span id="ed-loc-text">${addr ? esc(addr.substring(0,60)+(addr.length>60?'…':'')) : (pendingLat != null ? `${pendingLat.toFixed(4)}, ${pendingLng.toFixed(4)}` : '' )}</span>
      </div>
    </div>
    <div class="field">
      <label class="fl">Notes / tips</label>
      <textarea id="ed-notes" placeholder="Opening hours, booking tips, what the kids loved…">${esc(notes)}</textarea>
    </div>
    <div class="field">
      <label class="fl">Website</label>
      <input type="text" id="ed-url" value="${esc(url)}" placeholder="https://…">
    </div>
    ${p ? `<hr class="divider"><button class="btn btn-danger btn-sm" onclick="deletePlace('${p.id}')">🗑 Delete this place</button>` : ''}
  `;

  fillEmojiSel(cat, emoji);
  showView('editor');

  if (pendingLat != null) {
    editorMapShow([{ lat:pendingLat, lng:pendingLng, emoji, cat }]);
  } else {
    initEditorMap(); setTimeout(()=>editorMap.invalidateSize(),60);
  }
}

function editorCatChanged() {
  const cat = document.getElementById('ed-cat').value;
  fillEmojiSel(cat);
}

function savePlaceFromEditor() {
  const name = document.getElementById('ed-name').value.trim();
  if (!name) { document.getElementById('ed-name').focus(); return; }
  if (pendingLat == null || pendingLng == null) { alert('Please set a location — search an address or drop a pin on the map.'); return; }

  const data = {
    name, cat:document.getElementById('ed-cat').value,
    emoji:document.getElementById('ed-emoji').value,
    addr:document.getElementById('ed-addr').value.trim(),
    notes:document.getElementById('ed-notes').value.trim(),
    url:document.getElementById('ed-url').value.trim(),
    lat:pendingLat, lng:pendingLng,
  };

  if (editCtx.id) { Object.assign(state.places.find(x=>x.id===editCtx.id), data); }
  else { state.places.push({ id:uid(), done:false, ...data }); }

  save(); renderPlaces(); renderTrips(); refreshMainMarkers(); refreshTripsMapMarkers();
  closeEditor();
}

function deletePlace(id) {
  if (!confirm('Remove this place? It will also be unlinked from any trips.')) return;
  state.places = state.places.filter(x=>x.id!==id);
  state.trips.forEach(t => {
    t.placeIds = (t.placeIds||[]).filter(p=>p!==id);
    t.hotelIds = (t.hotelIds||[]).filter(p=>p!==id);
  });
  if (markers[id]) { map.removeLayer(markers[id]); delete markers[id]; }
  save(); renderPlaces(); renderTrips(); refreshMainMarkers(); refreshTripsMapMarkers();
  if (editCtx && editCtx.id === id) closeEditor(); else map.closePopup();
}

function flyToPlace(id) {
  const p = state.places.find(x=>x.id===id); if(!p) return;
  map.flyTo([p.lat,p.lng], 15, { duration:.8 });
  if (markers[id]) setTimeout(()=>markers[id].openPopup(), 850);
}

// ════════════════════════════════════════════
// TRIP EDITOR
// ════════════════════════════════════════════
function openTripEditor(id) {
  editCtx = { kind:'trip', id };
  const t = id ? state.trips.find(x=>x.id===id) : null;

  document.getElementById('editor-title').textContent = t ? 'Edit trip' : 'Plan a trip';
  document.getElementById('editor-back').textContent = '← Trips';

  const name  = t ? t.name : '';
  const type  = t ? t.type : 'day';
  const date  = t ? (t.date||'') : '';
  const notes = t ? (t.notes||'') : '';
  const selPlaceIds = t ? (t.placeIds||[]) : [];
  const selHotelIds = t ? (t.hotelIds||[]) : [];

  // build place picker — split by hotels vs visit places
  const visitPlaces = state.places.filter(p=>p.cat!=='hotel');
  const hotelPlaces = state.places.filter(p=>p.cat==='hotel');

  function pickerSection(label, places, selIds, nameAttr) {
    if (!places.length) return `<div class="picker-empty">No ${label.toLowerCase()} pinned yet.</div>`;
    return `<div class="picker-grid">
      <div class="picker-cat-hd">${label}</div>
      ${places.map(p=>`
        <label class="picker-item">
          <input type="checkbox" name="${nameAttr}" value="${p.id}" ${selIds.includes(p.id)?'checked':''}>
          <span class="pi-emoji">${p.emoji}</span>
          <span class="pi-name">${esc(p.name)}</span>
          <span class="pi-sub">${esc(p.addr||'')}</span>
        </label>`).join('')}
    </div>`;
  }

  document.getElementById('editor-scroll').innerHTML = `
    <div class="field">
      <label class="fl">Trip name</label>
      <input type="text" id="ed-tname" value="${esc(name)}" placeholder="e.g. Efteling day, Bruges weekend…">
    </div>
    <div class="row2 field">
      <div>
        <label class="fl">Type</label>
        <select id="ed-ttype">
          <option value="day"      ${type==='day'      ?'selected':''}>☀️ Day trip</option>
          <option value="overnight"${type==='overnight'?'selected':''}>🌙 Overnight / multi-day</option>
        </select>
      </div>
      <div>
        <label class="fl">Target date</label>
        <input type="date" id="ed-tdate" value="${date}">
      </div>
    </div>
    <div class="field">
      <label class="fl">Notes</label>
      <textarea id="ed-tnotes" placeholder="Packing list, budget, who's joining…">${esc(notes)}</textarea>
    </div>
    <div class="field">
      <label class="fl">Places to visit</label>
      ${pickerSection('See & Do & Eat', visitPlaces, selPlaceIds, 'pp')}
    </div>
    <div class="field">
      <label class="fl">Where to sleep</label>
      ${pickerSection('Hotels & stays', hotelPlaces, selHotelIds, 'hp')}
      <div class="field-hint">Pin hotels under Places → Hotel / sleep to make them appear here.</div>
    </div>
    ${t ? `<hr class="divider">
      <div class="trip-editor-actions">
        <button class="btn btn-done btn-sm" onclick="toggleTripDone('${t.id}')">${t.done?'↩ Mark as planned':'✓ Mark trip as done!'}</button>
        ${t.done&&t.doneDate?`<span class="trip-done-date">Done ${formatDate(t.doneDate)}</span>`:''}
      </div>
      <hr class="divider">
      <button class="btn btn-danger btn-sm" onclick="deleteTrip('${t.id}')">🗑 Delete this trip</button>` : ''}
  `;

  showView('editor');

  // show linked places on editor map
  const allLinked = [...selPlaceIds,...selHotelIds].map(pid=>state.places.find(p=>p.id===pid)).filter(Boolean);
  if (allLinked.length) editorMapShow(allLinked);
  else { initEditorMap(); setTimeout(()=>editorMap.invalidateSize(),60); if(state.places.length) { const b=L.latLngBounds(state.places.map(p=>[p.lat,p.lng])); editorMap.fitBounds(b.pad(0.2)); } }
}

function saveTripFromEditor() {
  const name = document.getElementById('ed-tname').value.trim();
  if (!name) { document.getElementById('ed-tname').focus(); return; }
  const placeIds = [...document.querySelectorAll('#editor-scroll input[name=pp]:checked')].map(c=>c.value);
  const hotelIds = [...document.querySelectorAll('#editor-scroll input[name=hp]:checked')].map(c=>c.value);

  // update editor map to show selected
  const allLinked = [...placeIds,...hotelIds].map(pid=>state.places.find(p=>p.id===pid)).filter(Boolean);
  if (allLinked.length) editorMapShow(allLinked);

  const data = { name, type:document.getElementById('ed-ttype').value, date:document.getElementById('ed-tdate').value, notes:document.getElementById('ed-tnotes').value.trim(), placeIds, hotelIds };
  if (editCtx.id) { const t=state.trips.find(x=>x.id===editCtx.id); if(t) Object.assign(t,data); }
  else { state.trips.push({ id:uid(), done:false, doneDate:'', visited:{}, ...data }); }
  save(); renderTrips(); refreshMainMarkers(); refreshTripsMapMarkers(); closeEditor();
}

function deleteTrip(id) {
  if (!confirm('Delete this trip?')) return;
  state.trips = state.trips.filter(x=>x.id!==id);
  save(); renderTrips();
  if (editCtx && editCtx.id===id) closeEditor();
}

function toggleTripDone(id) {
  const t=state.trips.find(x=>x.id===id); if(!t) return;
  t.done=!t.done; t.doneDate=t.done?new Date().toISOString().slice(0,10):'';
  save(); renderTrips();
  // refresh done button in editor if open
  if (editCtx && editCtx.kind==='trip' && editCtx.id===id) openTripEditor(id);
}

function focusTripOnMap(id) {
  const t=state.trips.find(x=>x.id===id); if(!t||!tripsMap) return;
  const ps=[...(t.placeIds||[]),...(t.hotelIds||[])].map(pid=>state.places.find(p=>p.id===pid)).filter(Boolean);
  if (!ps.length) return;
  tripsMap.flyToBounds(L.latLngBounds(ps.map(p=>[p.lat,p.lng])).pad(0.3),{duration:.8});
}

// ════════════════════════════════════════════
// RENDER PLACES
// ════════════════════════════════════════════
const catInfo = {
  see:   { chip:'c-see',   label:'See', countLabel:'Places' },
  do:    { chip:'c-do',    label:'Visit', countLabel:'Places' },
  eat:   { chip:'c-eat',   label:'Eat', countLabel:'Places' },
  hotel: { chip:'c-hotel', label:'Stay', countLabel:'Places' },
};
const placeListIcons = {
  see: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 18s5-4.9 5-9a5 5 0 1 0-10 0c0 4.1 5 9 5 9Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="9" r="1.9" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  do: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 15.5h12M6.5 15.5V7.3l3.5 2.2V7.3l3.5 2.2v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 5.5V4h9v1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  eat: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5v5M8 3.5v5M7 3.5v12M12.5 3.5v6c0 1 .8 1.8 1.8 1.8h.2v4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  hotel: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 15.5v-7h13v7M3.5 11.5h13M6 8.5V6.7c0-.7.6-1.2 1.2-1.2h1.6c.7 0 1.2.5 1.2 1.2v1.8M11 8.5V6.7c0-.7.6-1.2 1.2-1.2h1.6c.7 0 1.2.5 1.2 1.2v1.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
function renderPlaces() {
  const list = document.getElementById('places-list');
  if (!state.places.length) {
    list.innerHTML = '<div class="empty"><div class="empty-i">🌍</div><p>No places yet.<br>Search above or drop a pin on the map!</p></div>'; return;
  }
  const groups = { see:[], do:[], eat:[], hotel:[] };
  state.places.forEach(p => (groups[p.cat]||groups.do).push(p));
  list.innerHTML = Object.entries(groups).map(([cat,ps]) => {
    if (!ps.length) return '';
    const ci = catInfo[cat] || catInfo.do;
    return `<div class="cat-sec">
      <div class="cat-hd ${ci.chip}" onclick="toggleCat(this)">
        <span class="cat-title">${ci.label}</span>
        <span class="cat-count ${ci.chip}">${ps.length} ${ci.countLabel}</span>
        <span class="chev open">▾</span>
      </div>
      <div class="cat-items open">${ps.map(placeRowHTML).join('')}</div>
    </div>`;
  }).join('');
}
function placeRowHTML(p) {
  const icon = placeListIcons[p.cat] || placeListIcons.do;
  const location = formatPlaceLocation(p.addr);
  return `<div class="p-row" onclick="flyToPlace('${p.id}')">
    <span class="p-icon ${p.cat}" aria-hidden="true">${icon}</span>
    <div class="p-info">
      <div class="p-name">${esc(p.name)}</div>
      ${p.notes?`<div class="p-desc">${esc(p.notes)}</div>`:''}
      ${location?`<div class="p-addr">${esc(location)}</div>`:''}
    </div>
    <div class="p-acts" onclick="event.stopPropagation()">
      <button class="ic-btn" onclick="openPlaceEditor('${p.id}')" title="Edit" aria-label="Edit">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 13.8V16h2.2l7.1-7.1-2.2-2.2L4 13.8Zm8.2-8.2 2.2 2.2 1-1a1 1 0 0 0 0-1.4l-.8-.8a1 1 0 0 0-1.4 0l-1 1Z" fill="currentColor"/></svg>
      </button>
      <button class="ic-btn del" onclick="deletePlace('${p.id}')" title="Remove" aria-label="Remove">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 6.5V15a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V6.5M4 5.5h12M7.5 5.5V4.4c0-.5.4-.9.9-.9h3.2c.5 0 .9.4.9.9v1.1M8 8.5V14M12 8.5V14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  </div>`;
}
function toggleCat(h) {
  const i=h.nextElementSibling, c=h.querySelector('.chev');
  i.classList.toggle('open'); c.classList.toggle('open');
}

// ════════════════════════════════════════════
// RENDER TRIPS
// ════════════════════════════════════════════
function renderTrips() {
  const list = document.getElementById('trips-list');
  if (!state.trips.length) {
    list.innerHTML='<div class="empty"><div class="empty-i">✈️</div><p>No trips planned yet.<br>Pin some places first, then build your first adventure!</p></div>'; return;
  }
  refreshTripsMapMarkers();

  list.innerHTML = state.trips.map(t => {
    const visitPlaces = (t.placeIds||[]).map(pid=>state.places.find(p=>p.id===pid)).filter(Boolean);
    const hotelPlaces = (t.hotelIds||[]).map(pid=>state.places.find(p=>p.id===pid)).filter(Boolean);
    const visited = t.visited||{};
    const vcount = visitPlaces.filter(p=>visited[p.id]).length;
    const prog = visitPlaces.length ? Math.round(vcount/visitPlaces.length*100) : 0;
    const allCount = visitPlaces.length + hotelPlaces.length;
    const icon = t.type==='overnight' ? '🌙' : '☀️';

    return `<div class="t-card ${t.done?'done':''}" onclick="openTripEditor('${t.id}')">
      <div class="t-hd">
        <div class="t-icon">${icon}</div>
        <div class="t-meta">
          <div class="t-name">${esc(t.name)}</div>
          <div class="t-badges">
            ${t.type==='overnight'?'<span class="badge b-night">🌙 Overnight</span>':'<span class="badge b-day">☀️ Day trip</span>'}
            ${t.done?'<span class="badge b-done">✓ Done</span>':''}
            ${t.date?`<span class="badge b-cnt">📅 ${formatDate(t.date)}</span>`:''}
            ${allCount?`<span class="badge b-cnt">📍 ${allCount} place${allCount!==1?'s':''}</span>`:''}
          </div>
          ${visitPlaces.length&&!t.done?`<div class="prog-bar"><div class="prog-fill" style="width:${prog}%"></div></div>`:''}
        </div>
        <div class="t-acts" onclick="event.stopPropagation()">
          <button class="ic-btn" onclick="focusTripOnMap('${t.id}')" title="Show on map">🗺</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════
function uid() { return Math.random().toString(36).slice(2,10)+Date.now().toString(36); }
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function formatDate(d) { if(!d) return ''; try { return new Date(d+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); } catch(e){ return d; } }
function formatPlaceLocation(addr) {
  if (!addr) return '';
  const parts = addr.split(',').map(x => x.trim()).filter(Boolean);
  if (!parts.length) return '';
  const country = cleanupLocationPart(parts[parts.length - 1]);
  if (parts.length === 1) return country;
  const locality = cleanupLocationPart(parts[parts.length - 2]);
  return locality && locality !== country ? `${locality}, ${country}` : country;
}
function cleanupLocationPart(part) {
  return (part || '')
    .replace(/^\d+[A-Za-z-]*\s+/, '')
    .replace(/\s+[A-Z]{1,3}\d[A-Z\d\s-]*$/i, '')
    .replace(/\s+\d{3,}[A-Za-z-]*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════
async function initApp() {
  await load();
  renderPlaces();
  renderTrips();
  refreshMainMarkers();
  if (state.places.length) map.fitBounds(L.latLngBounds(state.places.map(p=>[p.lat,p.lng])).pad(0.25));
}
initApp();
