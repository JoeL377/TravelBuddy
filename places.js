// Turns coordinates into a place name + nearby landmarks using free, keyless APIs:
// OpenStreetMap Nominatim (reverse geocoding) and Wikipedia GeoSearch.
// Results are cached by ~100 m grid cell so many users in one spot cost one lookup.

// OpenStreetMap asks apps to identify themselves with a way to reach the operator.
const UA = `TravelBuddy/0.1 (virtual tour guide${process.env.CONTACT_EMAIL ? `; ${process.env.CONTACT_EMAIL}` : ""})`;
const cache = new Map();
const TTL_MS = 6 * 60 * 60 * 1000;

const MOCK_PLACES = process.env.MOCK_PLACES === "1";

export async function describePlace(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { ...hit.value, lat, lon };

  const value = MOCK_PLACES ? mockPlace() : await lookup(lat, lon);
  cache.set(key, { at: Date.now(), value });
  return { ...value, lat, lon };
}

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

async function lookup(lat, lon) {
  const [geo, landmarks] = await Promise.all([
    reverseGeocode(lat, lon).catch(() => null),
    nearbyLandmarks(lat, lon).catch(() => []),
  ]);
  const [areaImage, areaPhotos] = await Promise.all([
    geo?.area ? cityImage(geo.area, geo.state).catch(() => null) : null,
    commonsPhotos(lat, lon, { radius: 1500, limit: 40, prefer: geo?.area }).catch(() => []),
    // Landmarks whose article has no free lead photo: borrow a Commons photo
    // taken right at the landmark, preferring one whose file name mentions it.
    ...landmarks.filter((l) => !l.thumbnail && l.lat != null).map(async (l) => {
      const [hit] = await commonsPhotos(l.lat, l.lon, { radius: 150, limit: 10, prefer: l.title, strict: true }).catch(() => []);
      if (hit) l.thumbnail = hit;
    }),
  ]);
  return {
    label: geo?.label || landmarks[0]?.title || "Somewhere interesting",
    // Lead photo of the town's own Wikipedia article, for the tour cover.
    areaImage,
    // More photos taken around here (Wikimedia Commons), for tour story cards.
    areaPhotos: areaPhotos.filter((u) => u !== areaImage && !landmarks.some((l) => l.thumbnail === u)).slice(0, 8),
    area: geo?.area || null,
    // Everyone in the same neighborhood shares one generated tour.
    areaKey: geo?.areaKey || gridKey(lat, lon),
    areaName: geo?.areaName || geo?.label || null,
    landmarks,
  };
}

// ~1.1 km grid square, used when OpenStreetMap has no neighborhood name.
export function gridKey(lat, lon) {
  return `grid:${(Math.floor(lat * 100) / 100).toFixed(2)},${(Math.floor(lon * 100) / 100).toFixed(2)}`;
}

const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lon}`;
  const d = await getJson(url);
  const a = d.address || {};
  const local = a.neighbourhood || a.suburb || a.quarter || a.city_district;
  const city = a.city || a.town || a.village || a.municipality || a.county;
  const parts = [local, city, a.state, a.country].filter(Boolean);
  const areaKey = local && city ? `osm:${a.country_code || "xx"}/${slug(city)}/${slug(local)}` : null;
  return {
    label: [...new Set(parts)].join(", ") || d.display_name,
    area: city || null,
    state: a.state || null,
    areaKey,
    areaName: local && city ? `${local}, ${city}` : null,
  };
}

// How we pick landmarks:
// 1. Pull up to 50 geotagged Wikipedia articles within 10 km (the API maximum), so
//    sparse suburbs still reach real sights instead of stopping at the nearest 15.
// 2. Drop things a tour guide wouldn't point at, using each article's short
//    description: companies, schools, transit stops, roads, and the town or
//    neighborhood articles themselves (the area tour already covers those).
// 3. Rank by how notable the article is (Wikipedia page views over 30 days),
//    nudged up for sightseeing types (museums, parks, historic sites) and
//    discounted by walking distance, then keep the best 10.
const MAX_LANDMARKS = 10;
const SEARCH_RADIUS_M = 10000;

// Matched against the Wikipedia short description, e.g. "American video game company".
const SKIP = [
  /\b(company|corporation|conglomerate|manufacturer|developer|subsidiary|startup|brand|retailer|chain|franchise|bank|firm|publisher|software|website|newspaper|magazine|record label)\b/i,
  /\b(school district|school|elementary|kindergarten|preschool|academy)\b/i,
  /\b(station|stop|bus route|bus line|transit|interchange|exit|freeway|highway|expressway|road|street|avenue|boulevard|route)\b/i,
  /\b(radio|television|tv) (station|channel|network)\b/i,
  /\b(hospital|clinic|medical center|fire department|police department|post office|water district|sanitary district|school board)\b/i,
  /^(city|town|village|hamlet|borough|neighbou?rhood|suburb|census[- ]designated place|unincorporated community|human settlement|county|district|area|region|locality|community|place|municipality|ward|quarter)\b/i,
  /\b(neighbou?rhood|census[- ]designated place|unincorporated community) (in|of)\b/i,
  /\b(person|politician|businessman|businesswoman|athlete|footballer|actor|actress|singer|american (man|woman))\b/i,
];
// A historic building can still be a school or station; keep those.
const HISTORIC = /\b(historic|national register|landmark|heritage|former|ruins?|monument)\b/i;
const SIGHTS = /\b(museum|gallery|park|garden|arboretum|zoo|aquarium|beach|lake|lagoon|marsh|wetland|preserve|trail|hill|mountain|peak|island|bridge|pier|lighthouse|tower|castle|palace|fort|mission|church|cathedral|basilica|chapel|temple|shrine|mosque|synagogue|monastery|abbey|monument|memorial|statue|plaza|square|theat(er|re)|opera|concert hall|stadium|racetrack|arena|library|university|college|observatory|mansion|estate|house|historic|landmark|national register|heritage|ruins?|cemetery|market|waterfront)\b/i;
const MEH = /\b(shopping (mall|center|centre)|mall|office|building|apartment|hotel|restaurant|store|supermarket|golf course|sports? (facility|complex))\b/i;

export function landmarkScore({ description = "", views = null, distance = null }) {
  const desc = description || "";
  if (SKIP.some((re) => re.test(desc)) && !HISTORIC.test(desc)) return null;
  // Page views per day on a log scale: 1/day ~0.3, 10/day 1, 100/day 2, 1000/day 3.
  // Missing view data counts as a modest 10/day rather than zero.
  let score = Math.log10((views ?? 300) / 30 + 1);
  if (SIGHTS.test(desc)) score += 0.8;
  else if (MEH.test(desc)) score -= 0.4;
  // Halve the appeal at ~2.5 km; nearby still wins between equally famous places.
  const km = (distance ?? 2500) / 1000;
  return score / (1 + (km / 2.5) ** 2);
}

async function nearbyLandmarks(lat, lon) {
  // Call 1: candidates with short descriptions, page views and coordinates.
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    generator: "geosearch",
    ggscoord: `${lat}|${lon}`,
    ggsradius: String(SEARCH_RADIUS_M),
    ggslimit: "50",
    prop: "coordinates|description|pageviews",
    colimit: "max",
    pvipdays: "30",
  });
  const d = await getJson(`https://en.wikipedia.org/w/api.php?${params}`);
  const ranked = (d.query?.pages || [])
    .map((p) => {
      const c = p.coordinates?.[0];
      const daily = p.pageviews ? Object.values(p.pageviews).filter((v) => v != null) : [];
      const distance = c ? Math.round(dist(lat, lon, c.lat, c.lon)) : null;
      const cand = {
        pageid: p.pageid,
        title: p.title,
        description: p.description || "",
        lat: c?.lat ?? null,
        lon: c?.lon ?? null,
        distance,
        views: daily.length ? daily.reduce((a, b) => a + b, 0) : null,
      };
      return { ...cand, score: landmarkScore(cand) };
    })
    .filter((c) => c.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_LANDMARKS);
  if (!ranked.length) return [];

  // Call 2: intro text, photo and URL for just the winners.
  const details = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    pageids: ranked.map((c) => c.pageid).join("|"),
    prop: "extracts|pageimages|info",
    inprop: "url",
    exintro: "1",
    explaintext: "1",
    exsentences: "3",
    exlimit: "max",
    piprop: "thumbnail",
    pithumbsize: "900",
    pilimit: "max",
  });
  const byId = new Map();
  try {
    const dd = await getJson(`https://en.wikipedia.org/w/api.php?${details}`);
    for (const p of dd.query?.pages || []) byId.set(p.pageid, p);
  } catch (err) {
    console.error("landmark details lookup failed", err.message);
  }
  return ranked.map(({ score, views, ...c }) => {
    const p = byId.get(c.pageid) || {};
    return {
      ...c,
      extract: p.extract || c.description || "",
      thumbnail: photoUrl(p.thumbnail),
      url: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(c.title.replace(/ /g, "_"))}`,
    };
  });
}

// Wikipedia's "page image" is sometimes a logo, seal, flag or locator map rather
// than a photo of the place. Those look broken as a full-screen backdrop.
const NOT_A_PHOTO = /(logo|seal|flag|coat[_ ]of[_ ]arms|emblem|icon|wordmark|signature|locator|location[_ ]map|[_-]map[_.-]|\.svg)/i;
export function photoUrl(thumb) {
  if (!thumb?.source) return null;
  const file = decodeURIComponent(thumb.source.split("?")[0].split("/").pop() || "");
  return NOT_A_PHOTO.test(file) ? null : thumb.source;
}

// Wikimedia Commons: free, keyless, millions of geotagged photos. Returns photo
// URLs nearest first; files whose name shares a word with `prefer` come first.
// With `strict`, a photo that doesn't mention it must be within 60 m.
async function commonsPhotos(lat, lon, { radius, limit, prefer = "", strict = false }) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    generator: "geosearch",
    ggscoord: `${lat}|${lon}`,
    ggsradius: String(radius),
    ggsnamespace: "6",
    ggslimit: String(limit),
    prop: "imageinfo|coordinates",
    colimit: "max",
    iiprop: "url|mime",
    iiurlwidth: "900",
  });
  const d = await getJson(`https://commons.wikimedia.org/w/api.php?${params}`);
  const words = String(prefer).toLowerCase().replace(/\(.*?\)/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  return (d.query?.pages || [])
    .map((p) => {
      const ii = p.imageinfo?.[0];
      const c = p.coordinates?.[0];
      const name = p.title.toLowerCase();
      return {
        url: ii?.mime === "image/jpeg" && !NOT_A_PHOTO.test(p.title) ? ii.thumburl || ii.url : null,
        named: words.some((w) => name.includes(w)),
        d: c ? dist(lat, lon, c.lat, c.lon) : radius,
      };
    })
    .filter((x) => x.url && (!strict || x.named || x.d <= 60))
    .sort((a, b) => b.named - a.named || a.d - b.d)
    .map((x) => x.url);
}

async function cityImage(city, state) {
  const titles = [state ? `${city}, ${state}` : null, city].filter(Boolean);
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    titles: titles.join("|"),
    redirects: "1",
    prop: "pageimages|pageprops",
    ppprop: "disambiguation",
    piprop: "thumbnail",
    pithumbsize: "1200",
  });
  const d = await getJson(`https://en.wikipedia.org/w/api.php?${params}`);
  const pages = (d.query?.pages || []).filter((p) => !p.missing && !p.pageprops?.disambiguation);
  // Prefer "City, State" (the US convention) over a bare name that may be elsewhere.
  pages.sort((a, b) => (state && b.title.includes(state) ? 1 : 0) - (state && a.title.includes(state) ? 1 : 0));
  for (const p of pages) {
    const url = photoUrl(p.thumbnail);
    if (url) return url;
  }
  return null;
}

function dist(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(a));
}

function mockPlace() {
  return {
    label: "Old Harbor, Sample City",
    area: "Sample City",
    areaKey: "osm:xx/sample-city/old-harbor",
    areaName: "Old Harbor, Sample City",
    landmarks: [
      { pageid: 9001, title: "Old Town Hall", extract: "A 17th-century civic building that still hosts the city council. Its clock tower was rebuilt after a fire in 1842.", thumbnail: null, url: "https://en.wikipedia.org", lat: 48.851, lon: 2.291, distance: 120 },
      { pageid: 9002, title: "Riverside Cathedral", extract: "A Gothic cathedral on the river, begun in the 13th century and finished two hundred years later.", thumbnail: null, url: "https://en.wikipedia.org", lat: 48.853, lon: 2.294, distance: 450 },
      { pageid: 9003, title: "Harbor Lighthouse", extract: "A striped lighthouse at the end of the harbor wall, lit every night since 1871.", thumbnail: null, url: "https://en.wikipedia.org", lat: 48.846, lon: 2.297, distance: 820 },
      { pageid: 9004, title: "Market Hall", extract: "A covered iron-and-glass market from 1889, now full of food stalls.", thumbnail: null, url: "https://en.wikipedia.org", lat: 48.848, lon: 2.288, distance: 610 },
    ],
  };
}

// Free-text place search, for when the traveler wants to explore somewhere else
// (or their browser blocks location).
export async function searchPlace(q) {
  if (MOCK_PLACES) return { lat: 48.8584, lon: 2.2945, label: "Old Harbor, Sample City" };
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  const [hit] = await getJson(url);
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon), label: hit.display_name } : null;
}
