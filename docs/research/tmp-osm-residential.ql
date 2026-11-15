[out:json][timeout:600];
area["name:en"="Shenzhen"]->.sz;
(
  way["landuse"="residential"]["name"](area.sz);
  nwr["place"~"neighbourhood|quarter"]["name"](area.sz);
);
out center tags;
