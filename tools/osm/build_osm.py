"""Build the offline basemap for old Gia Lai from an OpenStreetMap GeoJSONSeq export.

Input : GeoJSONSeq from `osmium export -f geojsonseq` (one feature per line, tags as properties).
Output: data/osm/index.json + data/osm/z0.json (overview) + data/osm/c_<i>_<j>.json (detail chunks).

Each output file holds features with coordinates in local metres (Web-Mercator-scaled, like the app's
layers) relative to the file's own origin, quantised to 0.1 m, so the canvas renderer can draw them
with one affine transform per file.
Feature classes (k): road classes r0..r4, water lines w1/w2, water areas wa, admin boundaries b6/b8,
place labels p (with name and rank).
Usage: python3 build_osm.py features.geojsonseq out_dir
"""
import sys, json, math, os

R = 6378137.0
BBOX = (107.40, 12.90, 108.95, 14.65)       # old Gia Lai province, with margin
CHUNK = 0.1                                   # degrees per detail chunk

ROAD = {'motorway': 'r0', 'trunk': 'r0', 'motorway_link': 'r1', 'trunk_link': 'r1', 'primary': 'r1', 'primary_link': 'r1',
        'secondary': 'r2', 'secondary_link': 'r2', 'tertiary': 'r2', 'tertiary_link': 'r2',
        'unclassified': 'r3', 'residential': 'r3', 'living_street': 'r3', 'service': 'r4', 'track': 'r4',
        'path': 'r4', 'footway': 'r4', 'road': 'r3'}
PLACE_RANK = {'city': 0, 'town': 1, 'suburb': 2, 'village': 2, 'hamlet': 3, 'isolated_dwelling': 4, 'locality': 4}
OVERVIEW = {'r0', 'r1', 'r2', 'w1', 'wa', 'b6'}   # classes also drawn when zoomed out
TOL = {'r0': 8, 'r1': 6, 'r2': 4, 'r3': 2.5, 'r4': 2, 'w1': 4, 'w2': 3, 'wa': 3, 'b6': 10, 'b8': 5}
OV_TOL = 40


def merc(lon, lat):
    s = math.sin(math.radians(max(-85, min(85, lat))))
    return math.radians(lon) * R, R / 2 * math.log((1 + s) / (1 - s))


def dp(pts, tol):
    if len(pts) < 3:
        return pts
    keep, stack = {0, len(pts) - 1}, [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x0, y0), (x1, y1) = pts[a], pts[b]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            x, y = pts[i]
            d = abs(dy * (x - x0) - dx * (y - y0)) / L if L > 1e-9 else math.hypot(x - x0, y - y0)
            if d > best:
                best, bi = d, i
        if best > tol:
            keep.add(bi)
            stack += [(a, bi), (bi, b)]
    return [pts[i] for i in sorted(keep)]


def classify(props, gtype):
    hw, ww, nat, land, wtr, adm, plc = (props.get(k) for k in ('highway', 'waterway', 'natural', 'landuse', 'water', 'admin_level', 'place'))
    if plc in PLACE_RANK and gtype == 'Point' and props.get('name'):
        return 'p'
    if hw in ROAD and gtype in ('LineString', 'MultiLineString'):
        return ROAD[hw]
    if ww in ('river', 'canal') and 'Line' in gtype:
        return 'w1'
    if ww in ('stream', 'drain', 'ditch') and 'Line' in gtype:
        return 'w2'
    if (nat == 'water' or land in ('reservoir', 'basin') or ww == 'riverbank' or wtr) and 'Polygon' in gtype:
        return 'wa'
    if props.get('boundary') == 'administrative' and adm in ('4', '6') and gtype != 'Point':
        return 'b6'                      # province / old district (relations arrive as polygons: outer ring drawn as line)
    if props.get('boundary') == 'administrative' and adm == '8' and gtype != 'Point':
        return 'b8'
    return None


def parts(geom):
    t, c = geom['type'], geom['coordinates']
    if t == 'Point':
        return [[c]]
    if t == 'LineString':
        return [c]
    if t == 'MultiLineString':
        return c
    if t == 'Polygon':
        return c[:1]
    if t == 'MultiPolygon':
        return [p[0] for p in c]
    return []


class Bucket:
    def __init__(self, lon0, lat0):
        self.lon0, self.lat0 = lon0, lat0
        self.X0, self.Y0 = merc(lon0, lat0)
        self.k = math.cos(math.radians(lat0))
        self.f = []

    def local(self, lon, lat):
        X, Y = merc(lon, lat)
        return (X - self.X0) * self.k, (Y - self.Y0) * self.k

    def add(self, cls, coords, tol, name=None, rank=None):
        pts = [self.local(lo, la) for lo, la in coords]
        if cls == 'p':
            x, y = pts[0]
            self.f.append({'k': 'p', 'n': name, 'r': rank, 'c': [round(x, 1), round(y, 1)]})
            return
        pts = dp(pts, tol)
        if len(pts) < 2:
            return
        flat = [v for x, y in pts for v in (round(x, 1), round(y, 1))]
        feat = {'k': cls, 'c': flat}
        if name and cls in ('r0', 'r1', 'r2', 'w1'):
            feat['n'] = name
        self.f.append(feat)

    def dump(self, path):
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump({'lat': self.lat0, 'lon': self.lon0, 'f': self.f}, fh, ensure_ascii=False, separators=(',', ':'))


def main(src, out):
    os.makedirs(out, exist_ok=True)
    lon_a, lat_a, lon_b, lat_b = BBOX
    nx, ny = math.ceil((lon_b - lon_a) / CHUNK), math.ceil((lat_b - lat_a) / CHUNK)
    chunks = {}
    ov = Bucket((lon_a + lon_b) / 2, (lat_a + lat_b) / 2)
    n_in = n_kept = 0
    with open(src, encoding='utf-8') as fh:
        for line in fh:
            line = line.strip().lstrip('\x1e')
            if not line:
                continue
            n_in += 1
            try:
                feat = json.loads(line)
            except ValueError:
                continue
            g, props = feat.get('geometry'), feat.get('properties') or {}
            if not g:
                continue
            cls = classify(props, g['type'])
            if not cls:
                continue
            name = props.get('name:vi') or props.get('name')
            for coords in parts(g):
                if not coords:
                    continue
                if cls == 'p':
                    lo, la = coords[0]
                    if not (lon_a <= lo <= lon_b and lat_a <= la <= lat_b):
                        continue
                    rank = PLACE_RANK[props['place']]
                    i, j = int((lo - lon_a) / CHUNK), int((la - lat_a) / CHUNK)
                    chunks.setdefault((i, j), Bucket(lon_a + (i + .5) * CHUNK, lat_a + (j + .5) * CHUNK)).add('p', coords, 0, name, rank)
                    if rank <= 2:
                        ov.add('p', coords, 0, name, rank)
                    n_kept += 1
                    continue
                if cls == 'wa':                  # areas stay whole, in the chunk of their first vertex
                    lo, la = coords[0]
                    key = (min(nx - 1, max(0, int((lo - lon_a) / CHUNK))), min(ny - 1, max(0, int((la - lat_a) / CHUNK))))
                    chunks.setdefault(key, Bucket(lon_a + (key[0] + .5) * CHUNK, lat_a + (key[1] + .5) * CHUNK)).add(cls, coords, TOL[cls], name)
                    if cls in OVERVIEW:
                        ov.add(cls, coords, OV_TOL, name)
                    n_kept += 1
                    continue
                # split long lines across chunks by the chunk of each vertex run
                run, cur = [], None
                for lo, la in coords:
                    key = (min(nx - 1, max(0, int((lo - lon_a) / CHUNK))), min(ny - 1, max(0, int((la - lat_a) / CHUNK))))
                    if cur is None:
                        cur = key
                    if key != cur:
                        run.append([lo, la])
                        b = chunks.setdefault(cur, Bucket(lon_a + (cur[0] + .5) * CHUNK, lat_a + (cur[1] + .5) * CHUNK))
                        b.add(cls, run, TOL[cls])
                        run, cur = [run[-1]], key
                    run.append([lo, la])
                if len(run) >= 2:
                    b = chunks.setdefault(cur, Bucket(lon_a + (cur[0] + .5) * CHUNK, lat_a + (cur[1] + .5) * CHUNK))
                    b.add(cls, run, TOL[cls], name)
                if cls in OVERVIEW:
                    ov.add(cls, coords, OV_TOL, name)
                n_kept += 1
    files = []
    for (i, j), b in sorted(chunks.items()):
        fn = f'c_{i}_{j}.json'
        b.dump(os.path.join(out, fn))
        files.append({'f': fn, 'i': i, 'j': j, 'n': len(b.f), 'bytes': os.path.getsize(os.path.join(out, fn))})
    ov.dump(os.path.join(out, 'z0.json'))
    total = sum(x['bytes'] for x in files) + os.path.getsize(os.path.join(out, 'z0.json'))
    idx = {'bbox': BBOX, 'chunk_deg': CHUNK, 'overview': 'z0.json', 'chunks': files, 'total_bytes': total,
           'attribution': '© OpenStreetMap contributors (ODbL)', 'built': os.environ.get('BUILD_DATE', '')}
    with open(os.path.join(out, 'index.json'), 'w', encoding='utf-8') as fh:
        json.dump(idx, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'features read {n_in}, kept {n_kept}, chunks {len(files)}, total {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
