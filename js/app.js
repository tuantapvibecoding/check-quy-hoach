/* Check Quy Hoạch — map viewer for VN-2000 cadastral / planning layers (no external libraries). */
(() => {
'use strict';
const APP_VERSION = self.APP_VERSION || '0.0.0';
const TILE = 256, MAX_Z = 21.5, MIN_Z = 3, R_EARTH = 6378137;
const BASEMAPS = {
  sat: { maxZ: 18, url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
         labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
         fg: '#f6f3ea', halo: 'rgba(0,0,0,.85)', text: '#ffffff', attrib: 'Ảnh nền © Esri, Maxar, Earthstar Geographics' },
  street: { maxZ: 19, url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
         fg: '#23302a', halo: 'rgba(255,255,255,.9)', text: '#1b2420', attrib: 'Bản đồ © Esri, HERE, Garmin, OpenStreetMap' },
};
const $ = id => document.getElementById(id);
const canvas = $('map'), ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;

// ---------- state ----------
const layers = [];
let activeId = null, selectedParcelLayer = null;
let basemap = 'sat', opacity = 0.85, moveMode = false, tapPoint = null;
const show = { fill: true, line: true, tree: true, text: true };
const view = { x: 0, y: 0, z: 15 };
let gps = null, gpsWatch = null, gpsMode = 'off', compassHeading = null, wakeLock = null, gpsInside = undefined;
const gpsAnim = { from: [0, 0], to: [0, 0], t0: 0, dur: 1 };

// ---------- helpers ----------
const fmt = (v, d) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/,/g, ' ').replace('.', ',');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
let toastTimer = 0;
function toast(msg, ms = 2400) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms); }
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

// ---------- projection ----------
function project(lat, lon) {
  const s = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180);
  return [(lon + 180) / 360 * TILE, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE];
}
function unproject(x, y) {
  const n = Math.PI - 2 * Math.PI * y / TILE;
  return [180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), x / TILE * 360 - 180];
}
const scale = () => Math.pow(2, view.z);
const toScreen = (wx, wy) => { const s = scale(); return [(wx - view.x) * s + W / 2, (wy - view.y) * s + H / 2]; };
const toWorld = (sx, sy) => { const s = scale(); return [(sx - W / 2) / s + view.x, (sy - H / 2) / s + view.y]; };
const pxPerMeterWorld = lat => TILE / (2 * Math.PI * R_EARTH * Math.cos(lat * Math.PI / 180));

// ---------- layers ----------
function prepareLayer(meta, data) {
  const L = { id: meta.id, meta, data, visible: true, georef: data.crs === 'VN2000_108_30' };
  if (L.georef) {                          // VN-2000 metres -> WGS84 -> local ground metres (exact Mercator affine)
    let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
    data.groups.forEach(g => g.p.forEach(p => { for (let i = 0; i < p.length; i += 2) { e0 = Math.min(e0, p[i]); e1 = Math.max(e1, p[i]); n0 = Math.min(n0, p[i + 1]); n1 = Math.max(n1, p[i + 1]); } }));
    const [lat0, lon0] = VN2000.vn2000ToWgs((n0 + n1) / 2, (e0 + e1) / 2);
    const mx = lon => lon * Math.PI / 180 * R_EARTH;
    const my = lat => { const t = Math.sin(lat * Math.PI / 180); return R_EARTH / 2 * Math.log((1 + t) / (1 - t)); };
    const kx = Math.cos(lat0 * Math.PI / 180), X0 = mx(lon0), Y0 = my(lat0);
    const local = (E, N) => { const [la, lo] = VN2000.vn2000ToWgs(N, E); return [(mx(lo) - X0) * kx, (my(la) - Y0) * kx]; };
    const conv = arr => { const out = []; for (let i = 0; i < arr.length; i += 2) { const [x, y] = local(arr[i], arr[i + 1]); out.push(x, y); } return out; };
    data.groups.forEach(g => { g.p = g.p.map(conv); });
    data.labels = data.labels.map(l => { const [x, y] = local(l[0], l[1]); return [x, y, ...l.slice(2)]; });
    if (data.parcel) data.parcel.local = conv(data.parcel.ring);
    L.pos = { lat: lat0, lon: lon0, rot: 0 };
  } else {
    L.pos = store.get('pos:' + meta.id) || { ...(meta.placeholder || { lat: 13.5, lon: 108.1, rot: 0 }) };
    L.placeholderPos = { ...(meta.placeholder || L.pos) };
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  data.groups.forEach(g => g.p.forEach(p => { for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); } }));
  L.bbox = [x0, y0, x1, y1];
  L.groups = data.groups.map(g => {
    const path = new Path2D();
    for (const p of g.p) {
      path.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) path.lineTo(p[i], p[i + 1]);
      if (g.k === 'fill') path.closePath();
    }
    return { kind: g.k, color: g.c, path, w: g.w || 0, parcel: !!g.parcel };
  });
  L.treePath = new Path2D();
  for (const [x, y, r] of data.trees || []) { L.treePath.moveTo(x + r, y); L.treePath.arc(x, y, r, 0, Math.PI * 2); }
  return L;
}
const layerById = id => layers.find(l => l.id === id);

function layerMatrix(L) {     // local metres -> CSS px
  const [owx, owy] = project(L.pos.lat, L.pos.lon);
  const k = pxPerMeterWorld(L.pos.lat) * scale();
  const th = -L.pos.rot * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  const [ex, ey] = toScreen(owx, owy);
  return { a: k * c, b: -k * s, c: -k * s, d: -k * c, e: ex, f: ey, k };
}
function localToWorld(L, x, y) {
  const [owx, owy] = project(L.pos.lat, L.pos.lon), k = pxPerMeterWorld(L.pos.lat);
  const th = -L.pos.rot * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  return [owx + k * (x * c - y * s), owy - k * (x * s + y * c)];
}
function screenToLocal(m, sx, sy) {
  const det = m.a * m.d - m.b * m.c, dx = sx - m.e, dy = sy - m.f;
  return [(m.d * dx - m.c * dy) / det, (-m.b * dx + m.a * dy) / det];
}
const apply = (m, x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
function pointInRing(x, y, r) {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// ---------- tiles ----------
const tileCache = new Map();
let tileErrors = 0, tileOk = 0;
function getTile(tpl, z, x, y, request) {
  const key = tpl + '|' + z + '|' + x + '|' + y;
  let t = tileCache.get(key);
  if (!t && request) {
    const img = new Image();
    t = { img, ok: false };
    img.onload = () => { t.ok = true; tileOk++; schedule(); };
    img.onerror = () => { tileErrors++; t.failed = true; schedule(); };
    img.src = tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    tileCache.set(key, t);
    if (tileCache.size > 1200) tileCache.delete(tileCache.keys().next().value);
  }
  return t;
}
function drawTileLayer(tpl, maxZ) {
  const tz = Math.max(0, Math.min(maxZ, Math.round(view.z)));
  const n = Math.pow(2, tz), ts = TILE * scale() / n, f = n / TILE;
  const [wx0, wy0] = toWorld(0, 0), [wx1, wy1] = toWorld(W, H);
  const x0 = Math.floor(wx0 * f), x1 = Math.floor(wx1 * f), y0 = Math.max(0, Math.floor(wy0 * f)), y1 = Math.min(n - 1, Math.floor(wy1 * f));
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const wxT = ((tx % n) + n) % n;
    const [sx, sy] = toScreen(tx / f, ty / f);
    const t = getTile(tpl, tz, wxT, ty, true);
    if (t && t.ok) { ctx.drawImage(t.img, sx, sy, ts + 0.5, ts + 0.5); continue; }
    let childFailed = t && t.failed;
    for (let up = 1; up <= 6 && tz - up >= 0; up++) {
      const d = Math.pow(2, up), pt = getTile(tpl, tz - up, Math.floor(wxT / d), Math.floor(ty / d), childFailed);
      childFailed = pt && pt.failed;
      if (pt && pt.ok) { const sub = TILE / d; ctx.drawImage(pt.img, (wxT % d) * sub, (ty % d) * sub, sub, sub, sx, sy, ts + 0.5, ts + 0.5); break; }
    }
  }
}

// ---------- render ----------
let raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(render); }
function render() {
  raf = 0;
  if (gps && gpsMode === 'follow') {        // keep the live dot in view while following
    const [wx, wy] = gpsDrawPos(), ins = sheetInset(), sc = scale();
    view.x = wx + (ins.right / 2) / sc; view.y = wy + ((ins.bottom - ins.top) / 2) / sc;
  }
  const bm = BASEMAPS[basemap];
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ddd';
  ctx.fillRect(0, 0, W, H);
  drawTileLayer(bm.url, bm.maxZ);

  const mats = new Map();
  for (const L of layers) {
    if (!L.visible) continue;
    const m = layerMatrix(L); mats.set(L.id, m);
    ctx.save();
    ctx.setTransform(m.a * DPR, m.b * DPR, m.c * DPR, m.d * DPR, m.e * DPR, m.f * DPR);
    const lw = 1 / m.k;
    if (show.fill) for (const g of L.groups) if (g.kind === 'fill') {
      ctx.globalAlpha = (g.parcel ? (selectedParcelLayer === L.id ? 0.5 : 0.22) : 0.55) * opacity;
      ctx.fillStyle = g.color === 'fg' ? bm.fg : g.color; ctx.fill(g.path);
    }
    if (show.tree && L.data.trees && L.data.trees.length) {
      ctx.globalAlpha = 0.75 * opacity; ctx.fillStyle = '#2f8f46'; ctx.fill(L.treePath);
      ctx.lineWidth = lw; ctx.strokeStyle = '#bfe6c4'; ctx.stroke(L.treePath);
    }
    if (show.line) {
      ctx.globalAlpha = Math.min(1, 1.05 * opacity); ctx.lineJoin = 'round';
      const base = Math.max(lw * (view.z >= 18 ? 1.1 : 0.9), 0.04);
      for (const g of L.groups) if (g.kind === 'line') {
        ctx.lineWidth = g.w ? g.w * lw : base;
        ctx.strokeStyle = g.color === 'fg' ? bm.fg : g.color; ctx.stroke(g.path);
      }
    }
    if (moveMode && L.id === activeId && !L.georef) {
      const [x0, y0, x1, y1] = L.bbox;
      ctx.globalAlpha = 1; ctx.setLineDash([8 * lw, 6 * lw]); ctx.lineWidth = 2 * lw; ctx.strokeStyle = '#ffd34d';
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]);
    }
    ctx.restore();
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (basemap === 'sat' && view.z < 17.5) drawTileLayer(bm.labels, 18);
  if (show.text) drawLabels(mats, bm);
  if (moveMode) { const L = layerById(activeId); if (L && mats.get(L.id)) { const [cx, cy] = apply(mats.get(L.id), 0, 0); drawCross(cx, cy); } }
  if (gps) drawGps();
  if (tapPoint) { const [sx, sy] = toScreen(...project(tapPoint[0], tapPoint[1])); drawPin(sx, sy); }
  updateScale();
}
function drawLabels(mats, bm) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const placed = [];
  const hits = b => placed.some(p => !(b[2] < p[0] || b[0] > p[2] || b[3] < p[1] || b[1] > p[3]));
  for (const L of layers) {
    const m = mats.get(L.id); if (!m) continue;
    const order = L.data.labels.slice().sort((a, b) => 'pnvt'.indexOf(a[4] || 't') - 'pnvt'.indexOf(b[4] || 't'));
    for (const [x, y, t, h, st] of order) {
      const px = h * m.k;
      if (px < (st ? 1.2 : 3.2)) continue;
      let size = Math.max(10, Math.min(15, px * 1.15)), weight = 500;
      if (st === 'n') { size = Math.max(12, Math.min(17, px * 2)); weight = 600; }
      if (st === 'v') { size = 11; weight = 600; }
      ctx.font = `${weight} ${size}px "Be Vietnam Pro", system-ui, sans-serif`;
      let [sx, sy] = apply(m, x, y);
      if (sx < -120 || sy < -30 || sx > W + 120 || sy > H + 30) continue;
      if (st === 'v') {
        const v = L.data.parcel && L.data.parcel.local, i = parseInt(t, 10) - 1;
        if (v && v.length >= i * 2 + 2) [sx, sy] = apply(m, v[i * 2], v[i * 2 + 1]);
        if (view.z < 18.5) continue;
        ctx.globalAlpha = 1; ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#3b2f00'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, 8.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#2b2200'; ctx.fillText(t, sx, sy + 0.5);
        placed.push([sx - 9, sy - 9, sx + 9, sy + 9]);
        continue;
      }
      const w = ctx.measureText(t).width, box = [sx - w / 2 - 2, sy - size / 2 - 1, sx + w / 2 + 2, sy + size / 2 + 1];
      if (hits(box)) continue;
      placed.push(box);
      ctx.globalAlpha = Math.min(1, 0.4 + opacity);
      ctx.lineWidth = 3; ctx.strokeStyle = bm.halo; ctx.strokeText(t, sx, sy);
      ctx.fillStyle = bm.text; ctx.fillText(t, sx, sy);
    }
  }
  ctx.globalAlpha = 1;
}
function drawCross(x, y) {
  ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.moveTo(x - 15, y); ctx.lineTo(x + 15, y); ctx.moveTo(x, y - 15); ctx.lineTo(x, y + 15); ctx.stroke();
}
function drawPin(x, y) {
  ctx.fillStyle = '#e8453c'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y - 16, 7, Math.PI, 0); ctx.lineTo(x, y); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y - 16, 2.6, 0, Math.PI * 2); ctx.fill();
}
function gpsDrawPos() {                    // smoothly glide the dot between GPS fixes
  const a = gpsAnim, t = Math.min(1, (performance.now() - a.t0) / a.dur);
  const e = t < 1 ? 1 - Math.pow(1 - t, 3) : 1;
  if (t < 1) schedule();
  return [a.from[0] + (a.to[0] - a.from[0]) * e, a.from[1] + (a.to[1] - a.from[1]) * e];
}
function drawGps() {
  const [sx, sy] = toScreen(...gpsDrawPos());
  const r = Math.max(9, gps.acc * pxPerMeterWorld(gps.lat) * scale());
  ctx.globalAlpha = 0.16; ctx.fillStyle = '#2f7cf6'; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.5; ctx.strokeStyle = '#2f7cf6'; ctx.lineWidth = 1; ctx.stroke();
  const hd = compassHeading != null ? compassHeading : (gps.heading != null && gps.speed > 0.6 ? gps.heading : null);
  if (hd != null) {                        // direction cone: compass when available, else GPS course while moving
    const a = (hd - 90) * Math.PI / 180, spread = 0.5;
    const g = ctx.createRadialGradient(sx, sy, 4, sx, sy, 46);
    g.addColorStop(0, 'rgba(47,124,246,0.55)'); g.addColorStop(1, 'rgba(47,124,246,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.arc(sx, sy, 46, a - spread, a + spread); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(sx, sy, 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2f7cf6'; ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.fill();
  const pulse = (performance.now() % 2000) / 2000;          // gentle "live" pulse
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    ctx.globalAlpha = 0.35 * (1 - pulse); ctx.strokeStyle = '#2f7cf6'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, 10 + pulse * 14, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1; schedule();
  }
}
function updateScale() {
  const lat = unproject(view.x, view.y)[0];
  const mPerPx = 1 / (pxPerMeterWorld(lat) * scale());
  const target = mPerPx * 90, pow = Math.pow(10, Math.floor(Math.log10(target)));
  const nice = [1, 2, 5, 10].map(v => v * pow).filter(v => v <= target).pop() || pow;
  $('scaleBar').style.width = Math.round(nice / mPerPx) + 'px';
  $('scaleTxt').textContent = nice >= 1000 ? (nice / 1000) + ' km' : nice + ' m';
}

// ---------- view ----------
function sheetInset() {
  const wide = window.innerWidth >= 760;
  return { right: wide ? 380 : 0, bottom: wide ? 0 : ($('sheet').classList.contains('collapsed') ? 90 : H * 0.55), top: 70 };
}
function flyTo(wx, wy, z) {
  const ins = sheetInset();
  view.z = Math.max(MIN_Z, Math.min(MAX_Z, z));
  const s = scale();
  view.x = wx + (ins.right / 2) / s; view.y = wy + ((ins.bottom - ins.top) / 2) / s;
  schedule();
}
function fitLayer(L) {
  const [x0, y0, x1, y1] = L.bbox, ins = sheetInset();
  const [cx, cy] = localToWorld(L, (x0 + x1) / 2, (y0 + y1) / 2);
  const ext = Math.hypot(x1 - x0, y1 - y0) * pxPerMeterWorld(L.pos.lat);
  const avail = Math.max(160, Math.min(W - ins.right - 40, H - ins.bottom - ins.top - 40));
  flyTo(cx, cy, Math.log2(avail / ext));
}
function zoomAt(sx, sy, dz) {
  const [wx, wy] = toWorld(sx, sy);
  view.z = Math.max(MIN_Z, Math.min(MAX_Z, view.z + dz));
  const s = scale(); view.x = wx - (sx - W / 2) / s; view.y = wy - (sy - H / 2) / s;
  schedule();
}

// ---------- sheet & details ----------
function setSheet(open) {
  const sh = $('sheet');
  sh.classList.toggle('collapsed', !open);
  $('sheetGrip').setAttribute('aria-expanded', String(open));
  schedule();
}
function renderLayerList() {
  $('layerList').innerHTML = layers.map(L => `
    <li class="layer${L.id === activeId ? ' active' : ''}">
      <input type="checkbox" data-vis="${esc(L.id)}" ${L.visible ? 'checked' : ''} aria-label="Hiện lớp ${esc(L.meta.title)}">
      <div><div class="name">${esc(L.meta.title)}</div><div class="note">${esc(L.meta.note || '')}</div>
        <span class="badge ${L.georef ? 'ok' : 'warn'}">${L.georef ? 'Đúng vị trí VN-2000' : (store.get('pos:' + L.id) ? 'Đã căn chỉnh tay' : 'Chưa có tọa độ gốc')}</span></div>
      <button class="btn go" data-go="${esc(L.id)}">Xem</button>
    </li>`).join('');
  $('sheetSub').textContent = `${layers.length} lớp dữ liệu`;
}
function selectLayer(id, { fit = false, parcel = false } = {}) {
  activeId = id;
  const L = layerById(id);
  selectedParcelLayer = parcel && L && L.data.parcel ? id : null;
  renderLayerList();
  $('sheetTitle').textContent = L ? L.meta.title : 'Lớp dữ liệu';
  const P = L && L.data.parcel;
  $('parcelSec').hidden = !P;
  if (P) {
    $('parcelHead').textContent = P.no && P.no !== '?' ? `Thửa số ${P.no}` : 'Thông tin thửa đất';
    $('pArea').innerHTML = `${fmt(P.area, 1)} <small>m²</small>`;
    $('pPerim').innerHTML = `${fmt(P.perimeter, 2)} <small>m</small>`;
    $('pNo').textContent = P.no && P.no !== '?' ? '' : 'Bản vẽ không ghi số hiệu của chính thửa này; các số 85, 82… là thửa liền kề.';
    $('pVerify').textContent = P.table_check && P.table_check.rows
      ? `✓ Khớp bảng tọa độ đỉnh in trong bản vẽ (${P.table_check.rows - 1} đỉnh), sai lệch lớn nhất ${fmt(P.table_check.max_dev_m * 100, 0)} cm.`
      : 'Không có bảng tọa độ trong bản vẽ để đối chiếu.';
    $('pTable').querySelector('tbody').innerHTML = P.vertices.map(v =>
      `<tr><td>${v.n}</td><td>${fmt(v.X, 2)}</td><td>${fmt(v.Y, 2)}</td><td>${fmt(v.len, 2)}</td></tr>`).join('');
    $('pNeigh').innerHTML = P.neighbours.map(n => `<span class="tag">${esc(/^\d/.test(n) ? 'Thửa ' + n : n)}</span>`).join('');
    $('sheetSub').textContent = `${fmt(P.area, 1)} m² · ${P.vertices.length} đỉnh`;
  }
  const plan = L && !L.georef;
  $('alignSec').hidden = !plan;
  if (plan) { $('alignName').textContent = L.meta.title; $('rot').value = L.pos.rot; $('rotNum').value = L.pos.rot; }
  if (!plan && moveMode) toggleMove(false);
  if (fit && L) fitLayer(L);
  schedule();
}

// ---------- search ----------
let searchIndex = [];
function buildIndex() {
  searchIndex = [];
  for (const L of layers) {
    searchIndex.push({ label: L.meta.title, sub: 'Lớp dữ liệu', layer: L, fit: true, key: fold(L.meta.title + ' ' + (L.data.source || '')) });
    if (L.data.parcel) {
      const c = L.data.parcel.local, n = c.length / 2;
      let sx = 0, sy = 0; for (let i = 0; i < c.length; i += 2) { sx += c[i]; sy += c[i + 1]; }
      searchIndex.push({ label: L.meta.title, sub: `Thửa đất · ${fmt(L.data.parcel.area, 1)} m²`, layer: L, x: sx / n, y: sy / n, parcel: true, key: fold(L.meta.title + ' thua ' + (L.data.parcel.no || '')) });
    }
    const seen = new Set();
    for (const [x, y, t, h, st] of L.data.labels) {
      if (st === 'v' || seen.has(t)) continue;
      seen.add(t);
      const isNo = /^\d+(\(\d+\))?$/.test(t);
      searchIndex.push({ label: isNo ? `Thửa ${t}` : t, sub: L.meta.title, layer: L, x, y, key: fold((isNo ? 'thua ' : '') + t) });
    }
  }
}
function runSearch(q) {
  const f = fold(q.trim());
  const box = $('results');
  if (!f) { box.hidden = true; return; }
  const terms = f.split(/\s+/);
  const exactNo = /^\d+$/.test(f);
  let hits = searchIndex.filter(it => terms.every(t => it.key.includes(t)));
  if (exactNo) hits.sort((a, b) => (b.key.endsWith(' ' + f) || b.key === 'thua ' + f) - (a.key.endsWith(' ' + f) || a.key === 'thua ' + f));
  hits = hits.slice(0, 12);
  box.innerHTML = hits.length ? hits.map((h, i) => `<li><button data-hit="${i}">${esc(h.label)}<small>${esc(h.sub)}</small></button></li>`).join('')
    : `<li class="empty">Không tìm thấy "${esc(q)}". Dữ liệu hiện chỉ có các lớp đã tải lên.</li>`;
  box.hidden = false;
  box._hits = hits;
}
function openHit(h) {
  $('results').hidden = true; $('q').blur();
  if (!h.layer.visible) { h.layer.visible = true; }
  if (h.fit) { selectLayer(h.layer.id, { fit: true }); return; }
  selectLayer(h.layer.id, { parcel: !!h.parcel });
  if (!h.parcel && /^Thửa /.test(h.label)) {             // neighbour number: no boundary of its own in the data yet
    $('sheetTitle').textContent = h.label + ' (giáp ranh)';
    $('sheetSub').textContent = 'Chưa có ranh giới thửa này trong dữ liệu';
  }
  const [wx, wy] = localToWorld(h.layer, h.x, h.y);
  flyTo(wx, wy, Math.max(view.z, 19));
  toast(h.label);
}

// ---------- coordinates ----------
function writeTap(lat, lon) {
  const vn = VN2000.wgsToVn2000(lat, lon);
  $('tWgs').textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  $('tX').textContent = fmt(vn.X, 2);
  $('tY').textContent = fmt(vn.Y, 2);
}

// ---------- gestures ----------
const pointers = new Map();
let gesture = null;
function startGesture() {
  const pts = [...pointers.values()];
  const L = layerById(activeId);
  if (pts.length === 1) gesture = { n: 1, p0: pts[0], view0: [view.x, view.y], plan0: L ? project(L.pos.lat, L.pos.lon) : null, moved: false };
  else {
    const [a, b] = pts, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    gesture = { n: 2, d0: Math.max(10, Math.hypot(a[0] - b[0], a[1] - b[1])), z0: view.z, w0: toWorld(...mid),
                a0: Math.atan2(b[1] - a[1], b[0] - a[0]), rot0: L ? L.pos.rot : 0, moved: true };
  }
}
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
  canvas.classList.add('dragging'); startGesture();
  $('results').hidden = true;
});
canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId) || !gesture) return;
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  const pts = [...pointers.values()], L = layerById(activeId), canMove = moveMode && L && !L.georef;
  if (pts.length === 1 && gesture.n === 1) {
    const dx = pts[0][0] - gesture.p0[0], dy = pts[0][1] - gesture.p0[1];
    if (Math.hypot(dx, dy) > 4) { gesture.moved = true; if (gpsMode === 'follow' && !canMove) setGpsMode('free'); }
    const s = scale();
    if (canMove) { [L.pos.lat, L.pos.lon] = unproject(gesture.plan0[0] + dx / s, gesture.plan0[1] + dy / s); }
    else { view.x = gesture.view0[0] - dx / s; view.y = gesture.view0[1] - dy / s; }
    schedule();
  } else if (pts.length >= 2 && gesture.n >= 2) {
    const [a, b] = pts, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    view.z = Math.max(MIN_Z, Math.min(MAX_Z, gesture.z0 + Math.log2(Math.hypot(a[0] - b[0], a[1] - b[1]) / gesture.d0)));
    const s = scale(); view.x = gesture.w0[0] - (mid[0] - W / 2) / s; view.y = gesture.w0[1] - (mid[1] - H / 2) / s;
    if (canMove) setRot(gesture.rot0 + (Math.atan2(b[1] - a[1], b[0] - a[0]) - gesture.a0) * 180 / Math.PI);
    schedule();
  }
});
function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  const wasTap = gesture && gesture.n === 1 && !gesture.moved && pointers.size === 1;
  pointers.delete(e.pointerId);
  if (wasTap) onTap(e.clientX, e.clientY);
  if (gesture && gesture.moved && moveMode) savePos();
  if (pointers.size === 0) { canvas.classList.remove('dragging'); gesture = null; } else startGesture();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, -e.deltaY * (e.deltaMode ? 0.05 : 0.0022)); }, { passive: false });
canvas.addEventListener('dblclick', e => zoomAt(e.clientX, e.clientY, 1));

function onTap(sx, sy) {
  tapPoint = unproject(...toWorld(sx, sy));
  writeTap(tapPoint[0], tapPoint[1]);
  if (moveMode) { schedule(); return; }
  for (const L of layers) {
    if (!L.visible || !L.data.parcel) continue;
    const [lx, ly] = screenToLocal(layerMatrix(L), sx, sy);
    if (pointInRing(lx, ly, L.data.parcel.local)) {
      selectLayer(L.id, { parcel: true });
      toast(`${L.meta.title} · ${fmt(L.data.parcel.area, 1)} m²`);
      setSheet(true);
      return;
    }
  }
  if (selectedParcelLayer) { selectedParcelLayer = null; }
  schedule();
}

// ---------- alignment (plan layers) ----------
function savePos() { const L = layerById(activeId); if (L && !L.georef) { store.set('pos:' + L.id, L.pos); renderLayerList(); } }
function setRot(v) {
  const L = layerById(activeId); if (!L || L.georef) return;
  v = ((v + 540) % 360) - 180; L.pos.rot = Math.round(v * 10) / 10;
  $('rot').value = L.pos.rot; $('rotNum').value = L.pos.rot; schedule();
}
function toggleMove(on) {
  moveMode = on; $('moveMode').setAttribute('aria-pressed', String(on));
  document.body.classList.toggle('move-mode', on);
  if (on) { toast('Kéo để di chuyển bản vẽ · hai ngón để xoay'); if (window.innerWidth < 760) setSheet(false); }
  else savePos();
  schedule();
}
$('moveMode').addEventListener('click', () => toggleMove(!moveMode));
$('resetPos').addEventListener('click', () => {
  const L = layerById(activeId); if (!L || L.georef) return;
  L.pos = { ...L.placeholderPos }; try { localStorage.removeItem('pos:' + L.id); } catch (e) {}
  setRot(L.pos.rot); renderLayerList(); fitLayer(L); toast('Đã đặt lại vị trí tạm');
});
$('rot').addEventListener('input', e => setRot(+e.target.value));
$('rot').addEventListener('change', savePos);
$('rotNum').addEventListener('change', e => { const v = parseFloat(e.target.value); if (isFinite(v)) { setRot(v); savePos(); } });
const parseNum = s => parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
$('gotoForm').addEventListener('submit', e => {
  e.preventDefault();
  const X = parseNum($('inX').value), Y = parseNum($('inY').value), err = $('gotoErr');
  let msg = '';
  if (!isFinite(X) || !isFinite(Y)) msg = 'Nhập đủ cả X và Y (đơn vị mét).';
  else if (X < 1300000 || X > 1700000) msg = 'X là tọa độ Bắc, khoảng 1 300 000 – 1 700 000 m. Kiểm tra có đảo X và Y không.';
  else if (Y < 300000 || Y > 700000) msg = 'Y là tọa độ Đông, khoảng 300 000 – 700 000 m.';
  if (msg) { err.textContent = msg; err.hidden = false; return; }
  err.hidden = true;
  const L = layerById(activeId); if (!L || L.georef) return;
  [L.pos.lat, L.pos.lon] = VN2000.vn2000ToWgs(X, Y);
  savePos(); fitLayer(L); toast('Đã đặt tâm bản vẽ theo VN-2000');
});
['inX', 'inY'].forEach(id => $(id).addEventListener('input', () => { $('gotoErr').hidden = true; }));

// ---------- controls ----------
$('sheetGrip').addEventListener('click', () => { if (window.innerWidth < 760) setSheet($('sheet').classList.contains('collapsed')); });
$('layerList').addEventListener('change', e => {
  const id = e.target.dataset.vis; if (!id) return;
  layerById(id).visible = e.target.checked; schedule();
});
$('layerList').addEventListener('click', e => {
  const id = e.target.closest('[data-go]')?.dataset.go; if (!id) return;
  const L = layerById(id); L.visible = true; selectLayer(id, { fit: true });
  if (window.innerWidth < 760) setSheet(false);
});
$('opacity').addEventListener('input', e => { opacity = e.target.value / 100; $('opacityOut').textContent = e.target.value + '%'; schedule(); });
[['lyFill', 'fill'], ['lyLine', 'line'], ['lyTree', 'tree'], ['lyText', 'text']].forEach(([id, k]) =>
  $(id).addEventListener('change', e => { show[k] = e.target.checked; schedule(); }));
function setBasemap(b) {
  basemap = b; store.set('basemap', b);
  $('bmSat').setAttribute('aria-pressed', String(b === 'sat')); $('bmStreet').setAttribute('aria-pressed', String(b === 'street'));
  $('attrib').textContent = BASEMAPS[b].attrib; schedule();
}
$('bmSat').addEventListener('click', () => setBasemap('sat'));
$('bmStreet').addEventListener('click', () => setBasemap('street'));
$('zoomIn').addEventListener('click', () => zoomAt(W / 2, H / 2, 1));
$('zoomOut').addEventListener('click', () => zoomAt(W / 2, H / 2, -1));
// ---------- live GPS: off -> follow (map tracks you) -> free (you panned away) ----------
function setGpsMode(m) {
  gpsMode = m;
  const b = $('locate');
  b.classList.toggle('on', m !== 'off'); b.classList.toggle('follow', m === 'follow');
  b.setAttribute('aria-label', m === 'follow' ? 'Đang bám theo vị trí · chạm để tắt' : m === 'free' ? 'Về vị trí của tôi' : 'Vị trí của tôi');
  $('gpsBar').hidden = m === 'off';
  if (m === 'follow') requestWake(); else releaseWake();
  schedule();
}
async function requestWake() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) {} }
function releaseWake() { try { wakeLock && wakeLock.release(); } catch (e) {} wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && gpsMode === 'follow') requestWake(); });
function onCompass(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;            // iOS: degrees from north
  else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;
  if (h != null) { compassHeading = h; if (gpsMode !== 'off') schedule(); }
}
async function startCompass() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      if (await DeviceOrientationEvent.requestPermission() !== 'granted') return;
    }
    window.addEventListener('deviceorientationabsolute', onCompass);
    window.addEventListener('deviceorientation', onCompass);
  } catch (e) {}
}
function stopGps() {
  if (gpsWatch !== null) navigator.geolocation.clearWatch(gpsWatch);
  gpsWatch = null; gps = null; gpsInside = undefined; compassHeading = null;
  window.removeEventListener('deviceorientationabsolute', onCompass); window.removeEventListener('deviceorientation', onCompass);
  setGpsMode('off');
}
function parcelAt(lat, lon) {
  const [wx, wy] = project(lat, lon);
  for (const L of layers) {
    if (!L.visible || !L.data.parcel) continue;
    const [sx, sy] = toScreen(wx, wy);
    const [lx, ly] = screenToLocal(layerMatrix(L), sx, sy);
    if (pointInRing(lx, ly, L.data.parcel.local)) return L;
  }
  return null;
}
function onFix(p) {
  const c = p.coords, first = !gps;
  gps = { lat: c.latitude, lon: c.longitude, acc: c.accuracy || 20, heading: c.heading, speed: c.speed || 0, t: p.timestamp };
  const to = project(gps.lat, gps.lon);
  gpsAnim.from = first ? to : gpsDrawPos(); gpsAnim.to = to; gpsAnim.t0 = performance.now(); gpsAnim.dur = first ? 1 : 900;
  if (first) { view.z = Math.max(view.z, 18); toast(`Đã định vị · sai số khoảng ${Math.round(gps.acc)} m`); }
  const L = parcelAt(gps.lat, gps.lon), id = L ? L.id : null;
  if (id !== gpsInside) {
    if (gpsInside !== undefined || id) toast(L ? `Bạn đang đứng trong: ${L.meta.title}` : 'Bạn đã ra ngoài các thửa đã tải', 3000);
    gpsInside = id;
    if (L) selectLayer(L.id, { parcel: true });
  }
  const vn = VN2000.wgsToVn2000(gps.lat, gps.lon);
  $('gpsAcc').textContent = `±${Math.round(gps.acc)} m` + (gps.speed > 0.6 ? ` · ${(gps.speed * 3.6).toFixed(0)} km/h` : '');
  $('gpsWhere').textContent = L ? `Trong thửa: ${L.meta.title}` : 'Ngoài các thửa đã tải';
  $('gpsXY').textContent = `X ${fmt(vn.X, 1)} · Y ${fmt(vn.Y, 1)}`;
  schedule();
}
$('locate').addEventListener('click', () => {
  if (gpsMode === 'follow') { stopGps(); toast('Đã tắt định vị'); return; }
  if (gpsMode === 'free') { setGpsMode('follow'); return; }
  if (!('geolocation' in navigator)) { toast('Thiết bị không hỗ trợ định vị'); return; }
  startCompass();                                    // must be called inside the tap on iOS
  setGpsMode('follow'); toast('Đang lấy vị trí…');
  $('gpsAcc').textContent = 'Đang tìm…'; $('gpsWhere').textContent = ''; $('gpsXY').textContent = '';
  gpsWatch = navigator.geolocation.watchPosition(onFix, err => {
    toast(err.code === 1 ? 'Chưa cho phép vị trí: Cài đặt › Quyền riêng tư › Dịch vụ định vị › Safari › Khi dùng ứng dụng.' : 'Không lấy được vị trí, thử ra chỗ thoáng.', 4500);
    if (err.code === 1 || !gps) stopGps();
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
});
$('gpsBar').addEventListener('click', () => { if (gpsMode === 'free') setGpsMode('follow'); });
$('searchForm').addEventListener('submit', e => { e.preventDefault(); const h = $('results')._hits; if (h && h.length) openHit(h[0]); });
$('q').addEventListener('input', e => { $('clearQ').hidden = !e.target.value; runSearch(e.target.value); });
$('q').addEventListener('focus', e => { if (e.target.value) runSearch(e.target.value); });
$('clearQ').addEventListener('click', () => { $('q').value = ''; $('clearQ').hidden = true; $('results').hidden = true; $('q').focus(); });
$('results').addEventListener('click', e => { const b = e.target.closest('[data-hit]'); if (b) openHit($('results')._hits[+b.dataset.hit]); });

// ---------- boot ----------
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  schedule();
}
window.addEventListener('resize', resize);
if (window.matchMedia) { const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener && mq.addEventListener('change', schedule); }

// ---------- version & updates ----------
let swReg = null, lastCheck = 0, latestSeen = null;
const cmpVer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
function renderVersion() {
  $('verPill').textContent = 'v' + APP_VERSION;
  $('verNow').textContent = 'v' + APP_VERSION;
  $('verDate').textContent = 'Phát hành ' + (self.APP_BUILD_DATE || '').split('-').reverse().join('/');
  $('changelog').innerHTML = (self.CHANGELOG || []).map(c => `
    <li class="${c.v === APP_VERSION ? 'current' : ''}">
      <div class="cv">v${esc(c.v)}${c.v === APP_VERSION ? ' · đang dùng' : ''}<span>${esc(c.d.split('-').reverse().join('/'))}</span></div>
      <ul>${c.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
    </li>`).join('');
}
async function checkUpdate(manual = false) {
  if (!manual && Date.now() - lastCheck < 5 * 60 * 1000) return;
  lastCheck = Date.now();
  if (manual) $('updStatus').textContent = 'Đang kiểm tra…';
  try {
    const txt = await (await fetch('js/version.js?t=' + Date.now(), { cache: 'no-store' })).text();
    const m = txt.match(/APP_VERSION\s*=\s*'([\d.]+)'/);
    if (!m) throw new Error('no version');
    latestSeen = m[1];
    if (cmpVer(latestSeen, APP_VERSION) > 0) {
      $('updateText').textContent = `Có bản mới v${latestSeen}`;
      $('updateSub').textContent = `Đang dùng v${APP_VERSION}`;
      $('updateBar').hidden = false;
      $('verPill').classList.add('new'); $('verPill').textContent = `v${APP_VERSION} ↑`;
      $('updStatus').textContent = `Có bản mới v${latestSeen}. Bấm "Cập nhật" ở đầu màn hình.`;
    } else if (manual) {
      $('updStatus').textContent = `Bạn đang dùng bản mới nhất (v${APP_VERSION}).`;
    }
  } catch (e) {
    if (manual) $('updStatus').textContent = 'Không kiểm tra được, cần có mạng.';
  }
}
async function applyUpdate() {
  $('updateNow').disabled = true; $('updateText').textContent = 'Đang cập nhật…'; $('updateSub').textContent = '';
  try {
    if (swReg) {
      await swReg.update();
      const w = swReg.waiting || swReg.installing;
      if (w) w.postMessage('skipWaiting');
    }
  } catch (e) {}
  setTimeout(() => location.reload(), 600);
}
$('checkUpdate').addEventListener('click', () => checkUpdate(true));
$('updateNow').addEventListener('click', applyUpdate);
$('updateLater').addEventListener('click', () => { $('updateBar').hidden = true; });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });

async function boot() {
  renderVersion();
  resize();
  setSheet(window.innerWidth >= 760);
  const bm = store.get('basemap'); if (bm && BASEMAPS[bm]) setBasemap(bm);
  try {
    const cat = await (await fetch('data/catalog.json', { cache: 'no-cache' })).json();
    for (const meta of cat.layers) {
      try { layers.push(prepareLayer(meta, await (await fetch(meta.file)).json())); }
      catch (e) { console.error('layer failed', meta.id, e); }
    }
  } catch (e) { toast('Không tải được danh sách lớp dữ liệu', 4000); console.error(e); }
  buildIndex();
  renderLayerList();
  if (layers.length) selectLayer(layers[0].id, { fit: true });
  setTimeout(() => { if (tileErrors > 4 && !tileOk) toast('Không tải được ảnh nền · kiểm tra kết nối mạng', 4000); }, 7000);
  setTimeout(() => checkUpdate(), 2500);
}
boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').then(reg => { swReg = reg; }).catch(() => {});
}
})();
