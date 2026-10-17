"""Build viewer data for a cadastral-extract DGN (VN-2000, central meridian 108°30').

Usage: python3 -I build_parcel.py input.dgn output.json
Keeps coordinates in VN-2000 metres (E = Y, N = X); the viewer converts them to WGS84 at load time.
"""
import sys, json, math, re, unicodedata
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from dgn_v8 import read_dgn
from build_overlay import vni_to_unicode

MAP_LEVELS = {1, 2}          # level 1 = parcel boundaries, level 2 = labels; 3/6/8 = printed coordinate table


def area(pts):
    return abs(sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts)))) / 2


def num(s):
    return float(s.replace(' ', '').replace(',', '.'))


def main(src, dst):
    els, units = read_dgn(src)
    shapes = [e for e in els if e['type'] == 'shape' and e['level'] in MAP_LEVELS]
    lines = [e for e in els if e['type'] == 'line' and e['level'] in MAP_LEVELS]
    texts = [dict(e, text=vni_to_unicode(e['text']) if e['enc'] == 'vni' else e['text']) for e in els if e['type'] == 'text']
    parcel = max(shapes, key=lambda e: area(e['pts']))
    ring = parcel['pts'][:-1] if parcel['pts'][0] == parcel['pts'][-1] else parcel['pts']

    def inside(x, y, poly):
        c = False
        for i in range(len(poly)):
            (x1, y1), (x2, y2) = poly[i - 1], poly[i]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                c = not c
        return c

    map_texts = [t for t in texts if t['level'] in MAP_LEVELS and t['text'].strip()]
    num_labels = [t for t in map_texts if re.fullmatch(r'\d+(\(\d+\))?', t['text'])]
    own = [t for t in num_labels if inside(*t['pts'][0], ring) and t['h'] >= 0.9]
    parcel_no = own[0]['text'] if own else '?'
    vertex_labels = [t for t in num_labels if t['h'] < 0.9]
    neighbours = [t['text'] for t in map_texts if t not in own and t not in vertex_labels]

    # printed coordinate table (levels 6/8): rows of X, Y strings -> compare with geometry
    tbl_x = sorted([t for t in texts if re.fullmatch(r'1\d{6},\d+', t['text'])], key=lambda t: -t['pts'][0][1])
    tbl_y = sorted([t for t in texts if re.fullmatch(r'[3-6]\d{5},\d+', t['text'])], key=lambda t: -t['pts'][0][1])
    printed = [(num(a['text']), num(b['text'])) for a, b in zip(tbl_x, tbl_y)]
    verts = []
    max_dev = 0.0
    for i, (E, N) in enumerate(ring):
        E2, N2 = ring[(i + 1) % len(ring)]
        d = math.hypot(E2 - E, N2 - N)
        if i < len(printed):
            max_dev = max(max_dev, abs(printed[i][0] - N), abs(printed[i][1] - E))
        verts.append({'n': i + 1, 'X': round(N, 2), 'Y': round(E, 2), 'len': round(d, 2)})

    r2 = lambda v: round(v, 3)
    flat = lambda pts: [r2(v) for (x, y) in pts for v in (x, y)]
    style = lambda t: 'p' if t in own else ('v' if t in vertex_labels else ('n' if re.fullmatch(r'\d+(\(\d+\))?', t['text']) else 't'))
    data = {
        'crs': 'VN2000_108_30',
        'source': src.rsplit('/', 1)[-1],
        'title': f'Thửa đất số {parcel_no}' if parcel_no != '?' else
                 'Thửa đất · hồ sơ ' + (re.search(r'\d+-\d+', src.rsplit('/', 1)[-1]) or re.search(r'.+', 'không tên')).group(),
        'eyebrow': 'Demo · Trích lục bản đồ địa chính (DGN)',
        'groups': [
            {'k': 'fill', 'c': '#ffd23f', 'p': [flat(parcel['pts'])], 'parcel': True},
            {'k': 'line', 'c': 'fg', 'w': 1.4, 'p': [flat(e['pts']) for e in lines]},
            {'k': 'line', 'c': '#ffd23f', 'w': 3, 'p': [flat(parcel['pts'])]},
        ],
        'trees': [],
        'labels': [[r2(t['pts'][0][0]), r2(t['pts'][0][1]), t['text'], round(t['h'], 2), style(t)] for t in map_texts],
        'parcel': {
            'no': parcel_no,
            'area': round(area(ring), 1),
            'perimeter': round(sum(v['len'] for v in verts), 2),
            'vertices': verts,
            'neighbours': neighbours,
            'table_check': {'rows': len(printed), 'max_dev_m': round(max_dev, 3)},
            'ring': flat(ring),
        },
    }
    open(dst, 'w', encoding='utf-8').write(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    print(json.dumps(data['parcel'], ensure_ascii=False, indent=1)[:1500])
    print('labels', [(l[2], l[4]) for l in data['labels']])


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
