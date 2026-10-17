"""Pure-Python DXF -> geometry extractor (no external libs).

Handles LWPOLYLINE, POLYLINE/VERTEX, LINE, ARC, CIRCLE, HATCH (polyline + line/arc edges),
TEXT, MTEXT, ATTRIB and INSERT (recursive block expansion with scale/rotation).
Output geometry is in drawing units (local coordinates).
"""
import math, re


def read_pairs(path):
    raw = open(path, 'rb').read()
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        text = raw.decode('cp1252', errors='replace')
    lines = text.split('\n')
    for i in range(0, len(lines) - 1, 2):
        try:
            code = int(lines[i].strip())
        except ValueError:
            continue
        yield code, lines[i + 1].rstrip('\r')


def parse(path):
    secs = {}
    cur_sec = None
    cur = None
    expect_name = False
    for code, val in read_pairs(path):
        if code == 0:
            if cur is not None and cur_sec:
                secs.setdefault(cur_sec, []).append(cur)
            cur = None
            if val == 'SECTION':
                expect_name = True
                continue
            if val == 'ENDSEC':
                cur_sec = None
                continue
            if val == 'EOF':
                break
            cur = (val, [])
            continue
        if expect_name and code == 2:
            cur_sec = val
            expect_name = False
            continue
        if cur is not None:
            cur[1].append((code, val))
    return secs


def g(p, code, default=None, cast=str):
    for c, v in p:
        if c == code:
            try:
                return cast(v)
            except ValueError:
                return default
    return default


def build_blocks(block_ents):
    blocks = {}
    name = None
    base = (0.0, 0.0)
    items = []
    for t, p in block_ents:
        if t == 'BLOCK':
            name = g(p, 2)
            base = (g(p, 10, 0.0, float), g(p, 20, 0.0, float))
            items = []
        elif t == 'ENDBLK':
            if name is not None:
                blocks[name] = (base, items)
            name = None
        elif name is not None:
            items.append((t, p))
    return blocks


def arc_pts(cx, cy, r, a0, a1, ccw=True, seg_deg=8):
    a0, a1 = math.radians(a0), math.radians(a1)
    if ccw:
        while a1 <= a0:
            a1 += 2 * math.pi
    else:
        while a1 >= a0:
            a1 -= 2 * math.pi
    n = max(2, int(abs(a1 - a0) / math.radians(seg_deg)) + 1)
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def bulge_seg(p0, p1, b):
    if abs(b) < 1e-9:
        return [p1]
    (x0, y0), (x1, y1) = p0, p1
    theta = 4 * math.atan(b)
    d = math.hypot(x1 - x0, y1 - y0)
    if d == 0:
        return [p1]
    r = d / (2 * math.sin(theta / 2))
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    h = r * math.cos(theta / 2)
    ux, uy = (x1 - x0) / d, (y1 - y0) / d
    cx, cy = mx - uy * h, my + ux * h
    a0 = math.degrees(math.atan2(y0 - cy, x0 - cx))
    a1 = math.degrees(math.atan2(y1 - cy, x1 - cx))
    pts = arc_pts(cx, cy, abs(r), a0, a1, ccw=b > 0)
    return pts[1:]


def lwpoly(p):
    verts = []
    bul = []
    for c, v in p:
        if c == 10:
            verts.append([float(v), 0.0])
            bul.append(0.0)
        elif c == 20 and verts:
            verts[-1][1] = float(v)
        elif c == 42 and verts:
            bul[-1] = float(v)
    closed = (g(p, 70, 0, int) or 0) & 1
    if not verts:
        return [], closed
    out = [tuple(verts[0])]
    n = len(verts)
    rng = n if closed else n - 1
    for i in range(rng):
        a, b = tuple(verts[i]), tuple(verts[(i + 1) % n])
        out.extend(bulge_seg(a, b, bul[i]))
    return out, closed


def hatch_paths(p):
    """Return list of rings from HATCH boundary paths."""
    rings = []
    i = 0
    n = len(p)
    # skip to boundary path count (code 91)
    while i < n and p[i][0] != 91:
        i += 1
    if i >= n:
        return rings
    npaths = int(p[i][1]); i += 1
    for _ in range(npaths):
        while i < n and p[i][0] != 92:
            i += 1
        if i >= n:
            break
        flag = int(p[i][1]); i += 1
        ring = []
        if flag & 2:  # polyline
            has_bulge = closed = 0
            while i < n and p[i][0] in (72, 73):
                if p[i][0] == 72: has_bulge = int(p[i][1])
                if p[i][0] == 73: closed = int(p[i][1])
                i += 1
            nv = int(p[i][1]) if p[i][0] == 93 else 0; i += 1
            verts, buls = [], []
            while len(verts) < nv and i < n:
                c, v = p[i]
                if c == 10: verts.append([float(v), 0.0]); buls.append(0.0)
                elif c == 20: verts[-1][1] = float(v)
                elif c == 42: buls[-1] = float(v)
                else: break
                i += 1
            # consume trailing y/bulge of last vertex
            while i < n and p[i][0] in (20, 42):
                c, v = p[i]
                if c == 20: verts[-1][1] = float(v)
                else: buls[-1] = float(v)
                i += 1
            if verts:
                ring = [tuple(verts[0])]
                for k in range(len(verts)):
                    ring.extend(bulge_seg(tuple(verts[k]), tuple(verts[(k + 1) % len(verts)]), buls[k]))
        else:
            ne = int(p[i][1]) if p[i][0] == 93 else 0; i += 1
            for _e in range(ne):
                if i >= n or p[i][0] != 72: break
                et = int(p[i][1]); i += 1
                vals = {}
                while i < n and p[i][0] not in (72, 97):
                    vals.setdefault(p[i][0], []).append(float(p[i][1]) if p[i][0] not in (95, 96, 94, 97) else 0)
                    i += 1
                    if et == 1 and 21 in vals: break
                    if et == 2 and 73 in vals: break
                    if et == 3 and 73 in vals: break
                    if et == 4 and 97 in vals: break
                if et == 1:
                    ring += [(vals[10][0], vals[20][0]), (vals[11][0], vals[21][0])]
                elif et == 2:
                    ccw = int(vals.get(73, [1])[0]) == 1
                    a0, a1 = vals[50][0], vals[51][0]
                    if not ccw: a0, a1 = -a0, -a1
                    ring += arc_pts(vals[10][0], vals[20][0], vals[40][0], a0, a1, ccw=ccw)
        if len(ring) >= 3:
            rings.append(ring)
        while i < n and p[i][0] != 97:
            i += 1
        if i < n:
            cnt = int(p[i][1]); i += 1 + cnt
    return rings


def clean_mtext(s):
    s = s.replace('\\P', '\n')
    s = re.sub(r'\\[A-Za-z][^;\\]*;', '', s)
    s = re.sub(r'%%[UuOoDdCcPp]', '', s)
    s = s.replace('{', '').replace('}', '')
    return s.strip()


def aci_rgb(i):
    base = {1: (255, 0, 0), 2: (255, 255, 0), 3: (0, 255, 0), 4: (0, 255, 255), 5: (0, 0, 255),
            6: (255, 0, 255), 7: None, 8: (128, 128, 128), 9: (192, 192, 192)}
    if i in base:
        return base[i]
    if 250 <= i <= 255:
        v = [51, 91, 132, 173, 214, 255][i - 250]
        return (v, v, v)
    if 10 <= i <= 249:
        import colorsys
        h = ((i // 10) - 1) * 15 / 360.0
        k = i % 10
        val = [1.0, 1.0, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][k]
        sat = 1.0 if k % 2 == 0 else 0.5
        r, gg, b = colorsys.hsv_to_rgb(h, sat, val)
        return (round(r * 255), round(gg * 255), round(b * 255))
    return None


def layer_colors(secs):
    out = {}
    for t, p in secs.get('TABLES', []):
        if t == 'LAYER':
            tc = g(p, 420, None, int)
            aci = abs(g(p, 62, 7, int) or 7)
            out[g(p, 2)] = ((tc >> 16) & 255, (tc >> 8) & 255, tc & 255) if tc is not None else aci_rgb(aci)
    return out


class Extractor:
    def __init__(self, secs):
        self.blocks = build_blocks(secs.get('BLOCKS', []))
        self.ents = secs.get('ENTITIES', [])
        self.lcol = layer_colors(secs)
        self.out = []  # dicts: kind, layer, coords / text, color, depth
        self.point_layers = set()

    def emit(self, kind, layer, coords=None, text=None, closed=False, color=None, depth=0):
        self.out.append({'kind': kind, 'layer': layer, 'coords': coords, 'text': text,
                         'closed': closed, 'color': color, 'depth': depth})

    def run(self):
        self.walk(self.ents, lambda x, y: (x, y), None, 0, None)
        return self.out

    def color_of(self, p, layer, parent_color):
        tc = g(p, 420, None, int)
        if tc is not None:
            return ((tc >> 16) & 255, (tc >> 8) & 255, tc & 255)
        aci = g(p, 62, 256, int)
        if aci == 0:
            return parent_color
        if aci is None or aci == 256:
            return self.lcol.get(layer)
        return aci_rgb(abs(aci))

    def walk(self, ents, T, parent_layer, depth, parent_color):
        for t, p in ents:
            layer = g(p, 8, '0')
            if layer == '0' and parent_layer:
                layer = parent_layer
            color = self.color_of(p, layer, parent_color)
            n0 = len(self.out)
            self._walk_one(t, p, T, layer, depth, color)
            for o in self.out[n0:]:
                if o['color'] is None and o['depth'] == depth:
                    o['color'] = color

    def _walk_one(self, t, p, T, layer, depth, color):
        if True:
            E = lambda *a, **k: self.emit(*a, depth=depth, **k)
            if t == 'LWPOLYLINE':
                pts, closed = lwpoly(p)
                if len(pts) >= 2:
                    E('line', layer, [T(*q) for q in pts], closed=closed)
            elif t == 'LINE':
                a = (g(p, 10, 0.0, float), g(p, 20, 0.0, float)); b = (g(p, 11, 0.0, float), g(p, 21, 0.0, float))
                E('line', layer, [T(*a), T(*b)])
            elif t == 'ARC':
                pts = arc_pts(g(p, 10, 0.0, float), g(p, 20, 0.0, float), g(p, 40, 0.0, float), g(p, 50, 0.0, float), g(p, 51, 0.0, float))
                E('line', layer, [T(*q) for q in pts])
            elif t == 'CIRCLE':
                pts = arc_pts(g(p, 10, 0.0, float), g(p, 20, 0.0, float), g(p, 40, 0.0, float), 0, 360)
                E('line', layer, [T(*q) for q in pts], closed=True)
            elif t == 'HATCH':
                for ring in hatch_paths(p):
                    E('fill', layer, [T(*q) for q in ring], closed=True)
            elif t in ('TEXT', 'MTEXT', 'ATTRIB'):
                txt = ''.join(v for c, v in p if c in (3,)) + (g(p, 1, '') or '')
                txt = clean_mtext(txt)
                if txt:
                    h = g(p, 40, 1.0, float) or 1.0
                    (x0, y0), (x1, y1) = T(0, 0), T(h, 0)
                    E('text', layer, [T(g(p, 10, 0.0, float), g(p, 20, 0.0, float))], text=txt,
                      closed=math.hypot(x1 - x0, y1 - y0))
            elif t == 'INSERT' and depth < 8:
                name = g(p, 2)
                if name not in self.blocks:
                    return
                (bx, by), items = self.blocks[name]
                ix, iy = g(p, 10, 0.0, float), g(p, 20, 0.0, float)
                sx, sy = g(p, 41, 1.0, float), g(p, 42, 1.0, float)
                rot = math.radians(g(p, 50, 0.0, float))
                cr, sr = math.cos(rot), math.sin(rot)

                def T2(x, y, T=T, bx=bx, by=by, sx=sx, sy=sy, cr=cr, sr=sr, ix=ix, iy=iy):
                    x, y = (x - bx) * sx, (y - by) * sy
                    return T(ix + x * cr - y * sr, iy + x * sr + y * cr)
                n0 = len(self.out)
                self.walk(items, T2, layer, depth + 1, color)
                if depth == 0 and layer in self.point_layers:
                    pts = [q for o in self.out[n0:] if o['kind'] != 'text' for q in o['coords']]
                    del self.out[n0:]
                    if pts:
                        xs = [q[0] for q in pts]; ys = [q[1] for q in pts]
                        r = max(max(xs) - min(xs), max(ys) - min(ys)) / 2
                        E('point', layer, [((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2)], closed=r)
