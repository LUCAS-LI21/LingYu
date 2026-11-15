import json, re, os, collections

tmp = os.environ.get('TEMP')
with open(os.path.join(tmp, 'osm-sz-residential.json'), encoding='utf-8') as f:
    osm = json.load(f)

feats = []
for el in osm['elements']:
    t = el.get('tags', {})
    name = t.get('name')
    if not name:
        continue
    if el['type'] == 'node':
        lat, lon = el.get('lat'), el.get('lon')
    else:
        c = el.get('center') or {}
        lat, lon = c.get('lat'), c.get('lon')
    feats.append({'name': name, 'lat': lat, 'lon': lon,
                  'street': t.get('addr:street', ''), 'hn': t.get('addr:housenumber', ''),
                  'landuse': t.get('landuse', ''), 'place': t.get('place', '')})
print('OSM named residential/neighbourhood features:', len(feats))
print('  with addr:street:', sum(1 for x in feats if x['street']))

sql = open('data/community-pending.sql', encoding='utf-8').read()
rows = []
for line in sql.splitlines():
    line = line.strip()
    if not line.startswith("('"):
        continue
    # ('id', 'name', 'addr', 'district', 'street', 'village', 'attr'),
    m = re.match(r"^\('([^']*)', '((?:[^']|'')*)', '((?:[^']|'')*)', '([^']*)', '([^']*)', '([^']*)', '([^']*)'\)", line)
    if m:
        rows.append({'id': m.group(1), 'name': m.group(2).replace("''", "'"),
                     'address': m.group(3).replace("''", "'"), 'district': m.group(4),
                     'street': m.group(5), 'attr': m.group(7)})
print('communities parsed:', len(rows))

def norm(s):
    s = s.replace('\u3000', '').replace(' ', '')
    s = s.replace('（', '(').replace('）', ')')
    s = s.replace('深圳市', '')
    s = re.sub(r'\([^)]*\)', '', s)      # drop paren content
    s = re.sub(r'[（(].*$', '', s)
    return s.strip()

def variants(s):
    v = {norm(s)}
    base = norm(s)
    v.add(re.sub(r'(一期|二期|三期|四期|五期|六期|首期|第一期|第二期|第三期)$', '', base))
    v.add(re.sub(r'[0-9一二三四五六七八九十]+期$', '', base))
    v.add(re.sub(r'[A-Za-z]?[0-9]+[栋座区]$', '', base))
    v.add(re.sub(r'(小区|住宅区|生活区)$', '', base))
    return {x for x in v if len(x) >= 3}

osm_index = collections.defaultdict(list)
for f in feats:
    for v in variants(f['name']):
        osm_index[v].append(f)

exact = {}
for r in rows:
    hits = set()
    for v in variants(r['name']):
        for f in osm_index.get(v, []):
            hits.add((f['name'], f['lat'], f['lon'], f['street']))
    if hits:
        exact[r['id']] = hits

# containment (unique best): osm name contains ours or vice versa, len>=4
fuzzy = {}
osm_names = [(f['name'], f) for f in feats]
for r in rows:
    if r['id'] in exact:
        continue
    cand = []
    for v in variants(r['name']):
        if len(v) < 4:
            continue
        for on, f in osm_names:
            onv = norm(on)
            if len(onv) < 4:
                continue
            if v in onv or onv in v:
                cand.append((on, f['lat'], f['lon'], f['street']))
    if len(cand) == 1:
        fuzzy[r['id']] = set(cand)

allm = set(exact) | set(fuzzy)
print('exact match:', len(exact), f'({len(exact)/len(rows):.1%})')
print('unique containment match:', len(fuzzy), f'({len(fuzzy)/len(rows):.1%})')
print('union:', len(allm), f'({len(allm)/len(rows):.1%})')

by_district = collections.Counter(r['district'] for r in rows)
m_district = collections.Counter(r['district'] for r in rows if r['id'] in allm)
print('\nby district:')
for d, n in by_district.most_common():
    print(f'  {d}: {m_district.get(d,0)}/{n} = {m_district.get(d,0)/n:.0%}')

print('\nsample exact matches:')
for i, (rid, hits) in enumerate(list(exact.items())[:12]):
    r = next(x for x in rows if x['id'] == rid)
    h = list(hits)[0]
    print(f"  {r['name']} [{r['district']}] -> OSM:{h[0]} ({h[1]:.5f},{h[2]:.5f}) street={h[3]}")

print('\nsample unmatched:')
un = [r for r in rows if r['id'] not in allm]
for r in un[:20]:
    print(f"  {r['name']} | {r['district']} | {r['address'][:40]}")
