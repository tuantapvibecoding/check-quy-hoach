"""Minimal OLE2 / Compound File Binary reader (MicroStation V8 DGN container)."""
import struct


class CFB:
    def __init__(self, path):
        self.d = d = open(path, 'rb').read()
        assert d[:8] == bytes.fromhex('D0CF11E0A1B11AE1'), 'not an OLE2 file'
        self.ssz = 1 << struct.unpack_from('<H', d, 30)[0]
        self.mssz = 1 << struct.unpack_from('<H', d, 32)[0]
        nfat, self.dir_start, _, self.mini_cutoff, mfat_start, nmfat, difat_start, ndifat = struct.unpack_from('<IIIIIIII', d, 44)
        difat = list(struct.unpack_from('<109I', d, 76))
        s = difat_start
        for _ in range(ndifat):
            sec = self.sector(s)
            vals = struct.unpack('<%dI' % (self.ssz // 4), sec)
            difat += vals[:-1]
            s = vals[-1]
        difat = [x for x in difat[:nfat] if x < 0xFFFFFFFA]
        self.fat = []
        for s in difat:
            self.fat += struct.unpack('<%dI' % (self.ssz // 4), self.sector(s))
        self.dirs = []
        raw = self.chain(self.dir_start)
        for i in range(0, len(raw), 128):
            e = raw[i:i + 128]
            nlen = struct.unpack_from('<H', e, 64)[0]
            name = e[:max(0, nlen - 2)].decode('utf-16le', 'replace')
            typ = e[66]
            left, right, child = struct.unpack_from('<III', e, 68)
            start, size = struct.unpack_from('<IQ', e, 116)
            self.dirs.append(dict(name=name, type=typ, left=left, right=right, child=child, start=start, size=size, idx=i // 128))
        root = self.dirs[0]
        self.ministream = self.chain(root['start'])[:root['size']] if root['start'] < 0xFFFFFFFA else b''
        self.minifat = []
        if nmfat:
            m = self.chain(mfat_start)
            self.minifat = list(struct.unpack('<%dI' % (len(m) // 4), m))

    def sector(self, s):
        o = (s + 1) * self.ssz
        return self.d[o:o + self.ssz]

    def chain(self, s):
        out = []
        seen = 0
        while s < 0xFFFFFFFA and seen < 1_000_000:
            out.append(self.sector(s))
            s = self.fat[s]
            seen += 1
        return b''.join(out)

    def minichain(self, s):
        out = []
        while s < 0xFFFFFFFA:
            o = s * self.mssz
            out.append(self.ministream[o:o + self.mssz])
            s = self.minifat[s]
        return b''.join(out)

    def read(self, e):
        if e['size'] < self.mini_cutoff and e['type'] == 2:
            return self.minichain(e['start'])[:e['size']]
        return self.chain(e['start'])[:e['size']]

    def tree(self):
        """Yield (path, entry) for every stream, walking the red-black tree."""
        def walk(idx, prefix):
            if idx >= 0xFFFFFFFA or idx >= len(self.dirs):
                return
            e = self.dirs[idx]
            yield from walk(e['left'], prefix)
            path = prefix + '/' + e['name']
            yield path, e
            if e['type'] in (1, 5):
                yield from walk(e['child'], path)
            yield from walk(e['right'], prefix)
        yield from walk(self.dirs[0]['child'], '')
