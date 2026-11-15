[out:json][timeout:300];
area["name:en"="Shenzhen"]->.sz;
way["landuse"="residential"]["name"](area.sz)->.resn;
.resn out tags 40;
way["landuse"="residential"]["addr:street"](area.sz)->.resa;
.resa out count;
way["landuse"="residential"]["name"]["addr:street"](area.sz)->.resna;
.resna out count;
