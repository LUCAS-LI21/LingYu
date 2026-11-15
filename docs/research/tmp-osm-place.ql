[out:json][timeout:600];
area["name:en"="Shenzhen"]->.sz;
(
  nwr["place"~"village|hamlet|neighbourhood|quarter|suburb|town"]["name"](area.sz);
  way["landuse"~"residential|village"]["name"](area.sz);
  nwr["building"="residential"]["name"](area.sz);
);
out center tags;
