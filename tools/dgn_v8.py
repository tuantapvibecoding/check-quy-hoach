"""Minimal MicroStation V8 (.dgn) reader for 2D cadastral drawings — no external libraries.

Reads the OLE2 container, inflates the graphic-element streams and decodes:
  type 3  LINE, type 4  LINE_STRING, type 6  SHAPE, type 17 TEXT.
Coordinates are returned in master units (metres) using the model's global origin and
UOR resolution read from the model header (fallbacks: origin 5e9/1e10 UOR, 10000 UOR/m).
"""
import sys, struct, zlib, re
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from cfb import CFB


def inflate(b):
    for off in (0, 16):
        if b[off:off + 1] == b'x':
            try:
                return zlib.decompressobj().decompress(b[off:])
            except zlib.error:
                pass
    return None


def model_units(mh):
    """Return (origin_x, origin_y, uor_per_m) from the model header stream, with sane fallbacks."""
    ox, oy, upm = 5e9, 1e10, 10000.0
    if mh:
        d = [struct.unpack_from('<d', mh, i)[0] for i in range(0, len(mh) - 7, 4)]
        for i in range(len(d) - 2):
            if d[i] == 5e9 and d[i + 2] == 1e10:      # global origin pair, as written by MicroStation seed files
                ox, oy = d[i], d[i + 2]
                break
    return ox, oy, upm


def decode_text(el, i_fffe, nbytes):
    raw = el[i_fffe:i_fffe + nbytes]
    if raw[2:4] == b'\x01\x00':                            # 8-bit string (legacy code page, e.g. VNI-Times)
        return raw[4:].split(b'\x00')[0].decode('cp1252', 'replace'), 'vni'
    body = raw[2:]
    return body[:len(body) // 2 * 2].decode('utf-16le', 'replace').split('\x00')[0], 'utf16'


def read_dgn(path):
    c = CFB(path)
    streams = {p: c.read(e) for p, e in c.tree() if e['type'] == 2}
    mh = next((inflate(b) for p, b in streams.items() if p.endswith('Dgn~Mh')), None)
    ox, oy, upm = model_units(mh)
    tx = lambda x, y: ((x - ox) / upm, (y - oy) / upm)
    elems = []
    for p in sorted(streams):
        if '/Dgn^G/' not in p:
            continue
        g = inflate(streams[p])
        if not g:
            continue
        i = 0
        while i + 16 <= len(g):
            typ, flags, words = struct.unpack_from('<HHI', g, i + 4)
            L = 4 + words * 2
            if words == 0 or i + L > len(g):
                break
            el = g[i:i + L]
            level = struct.unpack_from('<I', el, 0x10)[0]
            if typ in (4, 6):
                n = struct.unpack_from('<I', el, 0x6c)[0]
                if 0 < n < 100000 and 0x74 + 16 * n <= L:
                    pts = [tx(*struct.unpack_from('<dd', el, 0x74 + 16 * k)) for k in range(n)]
                    elems.append({'type': 'shape' if typ == 6 else 'line', 'pts': pts, 'level': level, 'stream': p})
            elif typ == 3:
                vals = struct.unpack_from('<4d', el, 0x6c)
                elems.append({'type': 'line', 'pts': [tx(vals[0], vals[1]), tx(vals[2], vals[3])], 'level': level, 'stream': p})
            elif typ == 17:
                k = el.find(b'\xff\xfe', 0x70)
                if k > 0:
                    x, y = struct.unpack_from('<dd', el, k - 18)
                    nbytes = struct.unpack_from('<H', el, 0x72)[0]
                    h = struct.unpack_from('<d', el, 0x74)[0] / 1e7      # text size is stored at 1e7 per metre
                    s, enc = decode_text(el, k, nbytes)
                    elems.append({'type': 'text', 'pts': [tx(x, y)], 'text': s, 'enc': enc, 'h': h, 'level': level, 'stream': p})
            i += L
    return elems, (ox, oy, upm)


if __name__ == '__main__':
    els, units = read_dgn(sys.argv[1])
    print('units', units)
    for e in els:
        if e['type'] == 'text':
            print('TEXT', e['level'], e['enc'], round(e['h'], 2), [round(v, 2) for v in e['pts'][0]], repr(e['text']))
        else:
            print(e['type'].upper(), e['level'], e['stream'][-2:], len(e['pts']), [(round(x, 2), round(y, 2)) for x, y in e['pts'][:8]])
