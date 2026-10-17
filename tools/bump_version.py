"""Bump the app version in js/version.js and sw.js, and prepend a changelog entry.

Usage: python3 tools/bump_version.py 0.3.0 "Ghi chú 1" "Ghi chú 2" ...
"""
import sys, re, json, datetime, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
ver, notes = sys.argv[1], sys.argv[2:]
assert re.fullmatch(r'\d+\.\d+\.\d+', ver), 'version must look like 1.2.3'
today = datetime.date.today().isoformat()

vf = root / 'js' / 'version.js'
s = vf.read_text(encoding='utf-8')
s = re.sub(r"self\.APP_VERSION = '[^']+';", f"self.APP_VERSION = '{ver}';", s)
s = re.sub(r"self\.APP_BUILD_DATE = '[^']+';", f"self.APP_BUILD_DATE = '{today}';", s)
if notes and f"v: '{ver}'" not in s:
    items = ''.join(f"\n    {json.dumps(n, ensure_ascii=False)}," for n in notes)
    s = s.replace('self.CHANGELOG = [', f"self.CHANGELOG = [\n  {{ v: '{ver}', d: '{today}', items: [{items}\n  ] }},", 1)
vf.write_text(s, encoding='utf-8')

sw = root / 'sw.js'
t = sw.read_text(encoding='utf-8')
t = re.sub(r"const VERSION = 'cqh-v[^']+';", f"const VERSION = 'cqh-v{ver}';", t)
sw.write_text(t, encoding='utf-8')
print('version ->', ver)
