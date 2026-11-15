import re, collections
sql = open('data/community-pending.sql', encoding='utf-8').read()
c = collections.Counter(); n = 0
pat = re.compile(r"^\('([^']*)', '((?:[^']|'')*)', '((?:[^']|'')*)', '([^']*)', '([^']*)', '([^']*)', '([^']*)'\)")
for line in sql.splitlines():
    m = pat.match(line.strip())
    if m:
        n += 1
        c[m.group(7)] += 1
print('rows', n)
for k, v in c.most_common():
    print(v, k)
