"""Build a compact JSON overlay from the Chu Puh site-plan DXF.

Usage: python3 -I build_overlay.py input.dxf output.json
Coordinates are local metres, relative to the plan centre (no georeference in the source).
"""
import sys, json, math, re, unicodedata, collections
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from dxf_parse import parse, Extractor

PLAN = (360, 1030, 525, 1050)  # x0, x1, y0, y1 of the site plan inside the drawing sheet
DROP_LAYERS = {
    'BOLTS', 'BULONG', 'VATDUNG', 'NOITHAT', 'THIET-BI', 'THIETBI', 'FURNITURE', 'DIM', 'KICHTHUOC',
    'S_AXES', 'AXIS', 'HIDDEN', 'F-PAR', 'chu', '1', 'Defpoints', 'NOTES', 'NET3', 'TOILET', '洁具',
    'PLC-S-KY HIEU', 'Layer3', 'VATLIEU', 'FL1-CAB', 'S-DIM', 'KIHIEU', 'SEE LINE', 'S_MANG INOX',
    'S_CACHE', 'GF-CK CHINH', 'AM_0', 'AM_4', 'NET DUT', 'CHU VN', 'BKV 15 KEO THEP', '1. tem tem',
}
TREE_LAYERS = {'JARDIN', 'GREEN', 'Cay'}

# ---------- VNI-Windows -> Unicode ----------
CIRC, BREVE, HORN = '̂', '̆', '̛'
ACU, GRA, HOOK, TIL, DOT = '́', '̀', '̉', '̃', '̣'
VNI_MOD = {
    'Â': CIRC, 'â': CIRC, 'Ê': BREVE, 'ê': BREVE,
    'Á': CIRC + ACU, 'á': CIRC + ACU, 'À': CIRC + GRA, 'à': CIRC + GRA, 'Å': CIRC + HOOK, 'å': CIRC + HOOK,
    'Ã': CIRC + TIL, 'ã': CIRC + TIL, 'Ä': CIRC + DOT, 'ä': CIRC + DOT,
    'É': BREVE + ACU, 'é': BREVE + ACU, 'È': BREVE + GRA, 'è': BREVE + GRA, 'Ú': BREVE + HOOK, 'ú': BREVE + HOOK,
    'Ü': BREVE + TIL, 'ü': BREVE + TIL, 'Ë': BREVE + DOT, 'ë': BREVE + DOT,
    'Ù': ACU, 'ù': ACU, 'Ø': GRA, 'ø': GRA, 'Û': HOOK, 'û': HOOK, 'Õ': TIL, 'õ': TIL, 'Ï': DOT, 'ï': DOT,
}
VNI_CHR = {'Ö': 'Ư', 'ö': 'ư', 'Ô': 'Ơ', 'ô': 'ơ', 'Ñ': 'Đ', 'ñ': 'đ',
           'Í': 'Í', 'í': 'í', 'Ì': 'Ì', 'ì': 'ì', 'Æ': 'Ỉ', 'æ': 'ỉ', 'Ó': 'Ĩ', 'ó': 'ĩ', 'Ò': 'Ị', 'ò': 'ị'}


def looks_vni(s):
    # VNI strings only use Latin-1 code points; real Unicode Vietnamese almost always has chars above U+00FF
    if any(ord(c) > 255 for c in s):
        return False
    return bool(re.search(r'[ÑñÖöØøÏïÛûÆæ]|[AaEeOo][ÂâÁáÀàÅåÃãÄä]|[Aa][ÊêÉéÈèÚúÜüËë]', s))


def vni_to_unicode(s):
    if not looks_vni(s):
        return s
    out = []
    for ch in s:
        if ch in VNI_MOD and out and out[-1][:1].isalpha():
            mods = VNI_MOD[ch]
            base = out[-1]
            # circumflex/breve only apply to a/e/o; tone marks to any vowel
            if mods[0] in (CIRC, BREVE) and unicodedata.normalize('NFD', base)[0].lower() not in 'aeo':
                mods = mods[1:]
            out[-1] = base + mods
        elif ch in VNI_CHR:
            out.append(VNI_CHR[ch])
        else:
            out.append(ch)
    return unicodedata.normalize('NFC', ''.join(out))


# ---------- geometry helpers ----------
def dp(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [0, len(pts) - 1]
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x0, y0), (x1, y1) = pts[a], pts[b]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy) or 1e-12
        best, bi = -1, -1
        for i in range(a + 1, b):
            x, y = pts[i]
            d = abs(dy * (x - x0) - dx * (y - y0)) / L if L > 1e-9 else math.hypot(x - x0, y - y0)
            if d > best:
                best, bi = d, i
        if best > tol:
            keep.append(bi)
            stack += [(a, bi), (bi, b)]
    return [pts[i] for i in sorted(set(keep))]


def bbox(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def area(pts):
    return abs(sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts)))) / 2


def in_plan(pts):
    x0, y0, x1, y1 = bbox(pts)
    m = 5
    return PLAN[0] - m < x0 and x1 < PLAN[1] + m and PLAN[2] - m < y0 and y1 < PLAN[3] + m


def hexcol(c):
    if c is None:
        return 'fg'
    if c in ((255, 255, 255), (0, 0, 0)):
        return 'fg'
    return '#%02x%02x%02x' % c


LABEL_SKIP = re.compile(r"^(\d+[A-Z]?|[A-Z]\d?|D\d|N\d|UV|WC|CƠM|\d+''|QUẠT.*|.*\d{4}.*|KTS.*|.*\(T\)|\+\d.*|.*SLOPE.*|声光盒|30-.*|BAO PHÂN.*)$")


def main(src, dst):
    secs = parse(src)
    ex = Extractor(secs)
    ex.point_layers = TREE_LAYERS
    out = ex.run()

    groups = collections.defaultdict(list)  # (kind, color) -> list of flat coord arrays
    trees, labels = [], []
    seen_labels = collections.Counter()
    stats = collections.Counter()
    for o in out:
        pts = o['coords']
        if not pts:
            continue
        if o['kind'] == 'point':
            if in_plan(pts):
                trees.append(pts[0] + (o['closed'],))
            continue
        if o['kind'] == 'text':
            x, y = pts[0]
            if not (PLAN[0] < x < PLAN[1] and PLAN[2] < y < PLAN[3]):
                continue
            t = vni_to_unicode(o['text']).replace('%%%', '%').replace('\n', ' ').strip()
            t = re.sub(r'\s+', ' ', t)
            if len(t) < 3 or LABEL_SKIP.match(t) or o['layer'] in ('1. tem tem',):
                continue
            seen_labels[t] += 1
            if seen_labels[t] > 3:
                continue
            labels.append((x, y, t, o['closed'] or 1.0))
            continue
        if o['layer'] in DROP_LAYERS or o['layer'] in TREE_LAYERS:
            continue
        if not in_plan(pts):
            continue
        x0, y0, x1, y1 = bbox(pts)
        diag = math.hypot(x1 - x0, y1 - y0)
        if o['depth'] > 0:
            if o['kind'] == 'fill' and area(pts) < 3:
                continue
            if o['kind'] == 'line' and diag < 2.5:
                continue
        elif diag < 0.3:
            continue
        sp = dp(pts, 0.08)
        if o['kind'] == 'line' and o['closed'] and sp[0] != sp[-1]:
            sp = sp + [sp[0]]
        groups[(o['kind'], hexcol(o['color']))].append(sp)
        stats[o['layer']] += len(sp)

    # centre on plan bbox
    allpts = [p for g in groups.values() for path in g for p in path]
    bx0, by0, bx1, by1 = bbox(allpts)
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    r2 = lambda v: round(v, 2)
    data = {
        'source': src.rsplit('/', 1)[-1],
        'size_m': [r2(bx1 - bx0), r2(by1 - by0)],
        'groups': [],
        'trees': [[r2(x - cx), r2(y - cy), r2(r)] for x, y, r in trees],
        'labels': [[r2(x - cx), r2(y - cy), t, r2(h)] for x, y, t, h in labels],
    }
    for (kind, col), paths in sorted(groups.items(), key=lambda kv: (kv[0][0] != 'fill', kv[0][1])):
        data['groups'].append({'k': kind, 'c': col,
                               'p': [[v for (x, y) in path for v in (r2(x - cx), r2(y - cy))] for path in paths]})
    js = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    open(dst, 'w', encoding='utf-8').write(js)
    print('size', len(js) / 1e6, 'MB; plan', data['size_m'], 'm; groups', len(data['groups']),
          'paths', sum(len(g['p']) for g in data['groups']), 'trees', len(trees), 'labels', len(labels))
    for k, v in stats.most_common(25):
        print('  ', v, k)
    print(sorted(set(l[2] for l in labels)))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
