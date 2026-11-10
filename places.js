// Turns coordinates into a place name + nearby places to eat: OpenStreetMap
// Nominatim (reverse geocoding), food spots from Google Places or OpenStreetMap
// (see food.js), and Wikipedia for the famous ones (restaurants, markets,
// bakeries with their own article) and for photos of the area.
// Results are cached by ~100 m grid cell so many users in one spot cost one lookup.

// OpenStreetMap asks apps to identify themselves with a way to reach the operator.
import { nearbyFood, mockSpots, FOOD_SOURCE } from "./food.js";
import { FLORENCE_MODE, DUOMO, inFlorence, florenceSpots, needsCommonsPhoto, markPhotoTried, setCommonsPhoto, resolvedCoords } from "./florence.js";

const UA = `TravelBuddy/0.2 (food guide${process.env.CONTACT_EMAIL ? `; ${process.env.CONTACT_EMAIL}` : ""})`;
const cache = new Map();
const TTL_MS = 6 * 60 * 60 * 1000;

const MOCK_PLACES = process.env.MOCK_PLACES === "1";

export async function describePlace(lat, lon) {
  if (FLORENCE_MODE) return describeFlorence(lat, lon);
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
  const [geo, food, famous] = await Promise.all([
    reverseGeocode(lat, lon).catch(() => null),
    nearbyFood(lat, lon, { ua: UA }).catch((err) => {
      console.error("food spots lookup failed", err.message);
      return { source: FOOD_SOURCE, spots: [] };
    }),
    famousFoodPlaces(lat, lon).catch((err) => {
      console.error("wikipedia food lookup failed", err.message);
      return [];
    }),
  ]);
  const spots = mergeFamous(food.spots, famous);
  const areaImage = geo?.area ? await cityImage(geo.area, geo.state).catch(() => null) : null;
  // Wikimedia asks API clients not to fire requests in parallel (and answers
  // 429 when they do), so Commons lookups run one after another.
  const areaPhotos = await commonsPhotos(lat, lon, { radius: 1500, limit: 40, prefer: geo?.area }).catch((err) => {
    console.error("commons area photos failed", err.message);
    return [];
  });
  // Famous spots with no photo: borrow a Commons photo taken right there,
  // preferring one whose file name mentions the place.
  for (const l of spots.filter((x) => !x.thumbnail && x.famous && x.lat != null).slice(0, 4)) {
    try {
      const [hit] = await commonsPhotos(l.lat, l.lon, { radius: 120, limit: 10, prefer: l.title, strict: true });
      if (hit) l.thumbnail = hit;
    } catch (err) {
      console.error("commons spot photo failed", l.title, err.message);
    }
  }
  return {
    label: geo?.label || "Somewhere tasty",
    // Lead photo of the town's own Wikipedia article, for the food story cover.
    areaImage,
    // More photos taken around here (Wikimedia Commons), for story cards.
    areaPhotos: areaPhotos.filter((u) => u !== areaImage && !spots.some((l) => l.thumbnail === u)).slice(0, 8),
    area: geo?.area || null,
    // Everyone in the same neighborhood shares one generated food story.
    areaKey: geo?.areaKey || gridKey(lat, lon),
    areaName: geo?.areaName || geo?.label || null,
    // Where the spot list came from: "google" (ratings, photos) or "osm".
    source: food.source,
    spots,
  };
}

// Restaurants, markets and bakeries famous enough for a Wikipedia article.
// Matched against the article's short description, e.g. "Restaurant in San Mateo".
const FOOD_ARTICLE = /\b(restaurant|diner|bakery|caf[eé]|coffee ?house|tea ?house|delicatessen|deli|food hall|food court|market hall|public market|farmers'? market|marketplace|brewery|winery|distillery|ice cream|creamery|pizzeria|steakhouse|taqueria|noodle|sushi|dim sum|chocolatier|confectioner|tavern|saloon|drive-in|eatery|brewpub)\b/i;
const NOT_A_SPOT = /\b(chain|company|corporation|franchise|brand|conglomerate|headquarters|person|chef|restaurateur|businessman|businesswoman|television|book|film)\b/i;

async function famousFoodPlaces(lat, lon) {
  if (MOCK_PLACES) return [];
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", origin: "*",
    generator: "geosearch", ggscoord: `${lat}|${lon}`, ggsradius: "3000", ggslimit: "50",
    prop: "coordinates|description", colimit: "max",
  });
  const d = await getJson(`https://en.wikipedia.org/w/api.php?${params}`);
  const hits = (d.query?.pages || []).filter((p) => p.coordinates?.[0] && FOOD_ARTICLE.test(p.description || "") && !NOT_A_SPOT.test(p.description || ""));
  if (!hits.length) return [];
  const details = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", origin: "*",
    pageids: hits.map((p) => p.pageid).slice(0, 20).join("|"),
    prop: "extracts|pageimages|info", inprop: "url", exintro: "1", explaintext: "1", exsentences: "3", exlimit: "max",
    piprop: "thumbnail", pithumbsize: "900", pilimit: "max",
  });
  const byId = new Map();
  try {
    const dd = await getJson(`https://en.wikipedia.org/w/api.php?${details}`);
    for (const p of dd.query?.pages || []) byId.set(p.pageid, p);
  } catch (err) {
    console.error("wikipedia food details failed", err.message);
  }
  return hits.map((p) => {
    const c = p.coordinates[0];
    const x = byId.get(p.pageid) || {};
    return {
      pageid: p.pageid,
      title: p.title.replace(/\s*\(.*\)$/, ""),
      description: p.description,
      extract: x.extract || p.description,
      thumbnail: photoUrl(x.thumbnail),
      wikiUrl: x.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
      lat: c.lat,
      lon: c.lon,
      distance: Math.round(dist(lat, lon, c.lat, c.lon)),
    };
  });
}

const norm = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();

// A famous place that's also in the spot list gets its Wikipedia story and a
// "famous" badge; one that isn't (the source missed it) joins the list.
export function mergeFamous(spots, famous) {
  const out = spots.map((s) => ({ ...s }));
  for (const f of famous) {
    const n = norm(f.title);
    const match = out.find((s) => {
      const m = norm(s.title);
      return (m === n || (n.length > 5 && (m.includes(n) || n.includes(m)))) && (s.lat == null || dist(s.lat, s.lon, f.lat, f.lon) < 300);
    });
    if (match) {
      match.famous = true;
      match.extract = f.extract || match.extract;
      match.wikiUrl = f.wikiUrl;
      match.thumbnail = match.thumbnail || f.thumbnail;
    } else if (f.distance <= 3000) {
      out.push({
        id: `wp:${f.pageid}`, title: f.title, kind: kindFromDescription(f.description), cuisine: null,
        description: f.description, extract: f.extract, rating: null, ratingCount: null, price: null, openNow: null,
        address: null, website: null,
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${f.title} ${f.lat},${f.lon}`)}`,
        url: f.wikiUrl, wikiUrl: f.wikiUrl, thumbnail: f.thumbnail, lat: f.lat, lon: f.lon, distance: f.distance, famous: true,
      });
    }
  }
  // Famous places first, then the source's own ranking.
  return out.map((s, i) => ({ s, i })).sort((a, b) => (b.s.famous - a.s.famous) || a.i - b.i).map((x) => x.s).slice(0, 14);
}

function kindFromDescription(d = "") {
  const m = FOOD_ARTICLE.exec(d);
  if (!m) return "Food spot";
  const w = m[1].toLowerCase();
  return w[0].toUpperCase() + w.slice(1);
}

// Florence mode: the curated list, measured from you if you're in Florence,
// otherwise from the Duomo (and `centered` tells the app it moved you there).
async function describeFlorence(lat, lon) {
  const here = inFlorence(lat, lon);
  const at = here ? { lat, lon } : DUOMO;
  const key = `fi:${at.lat.toFixed(3)},${at.lon.toFixed(3)}`;
  let base = cache.get(key);
  if (!base || Date.now() - base.at >= TTL_MS) {
    const geo = MOCK_PLACES ? null : await reverseGeocode(at.lat, at.lon).catch(() => null);
    const areaImage = MOCK_PLACES ? null : await cityImage("Florence", null).catch(() => null);
    base = {
      at: Date.now(),
      value: {
        label: geo?.label || "Florence, Tuscany, Italy",
        area: "Florence",
        areaImage,
        areaPhotos: [],
        // One shared food story per Florence neighborhood (or the whole city).
        areaKey: here && geo?.areaKey ? geo.areaKey : "city:florence",
        areaName: here && geo?.areaName ? geo.areaName : "Florence",
      },
    };
    cache.set(key, base);
  }
  if (!MOCK_PLACES) fillCommonsPhotos();
  return { ...base.value, lat: at.lat, lon: at.lon, centered: !here, source: "florence", spots: florenceSpots(at.lat, at.lon, { mock: MOCK_PLACES, nearest: here }) };
}

// Without a Google key, look for a free Wikimedia Commons photo taken at each
// curated place, a few at a time in the background.
let fillingPhotos = false;
async function fillCommonsPhotos() {
  if (fillingPhotos) return;
  fillingPhotos = true;
  try {
    for (const c of needsCommonsPhoto().slice(0, 6)) {
      const r = resolvedCoords(c.id);
      markPhotoTried(c.id);
      try {
        const [hit] = await commonsPhotos(r.lat, r.lon, { radius: 80, limit: 20, prefer: c.title, strict: true });
        if (hit) setCommonsPhoto(c.id, hit);
      } catch (err) {
        console.error("commons photo failed", c.title, err.message);
      }
    }
  } finally {
    fillingPhotos = false;
  }
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
// Commons photos near a point include office HQs, event snapshots and people.
// Skip file names that say so; a tour should show the place, not a lobby.
const NOT_SIGHTSEEING = /(headquarters|\bhq\b|office|corporate|campus|brewing|company|inc\b|portrait|headshot|\bwith\b|speaking|speech|panel|conference|meeting|interview|selfie|screenshot|interior|lobby|parking|construction|\bsign\b|receipt|menu)/i;

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
        url: ii?.mime === "image/jpeg" && !NOT_A_PHOTO.test(p.title) && !NOT_SIGHTSEEING.test(p.title) ? ii.thumburl || ii.url : null,
        named: words.filter((w) => name.includes(w)).length,
        d: c ? dist(lat, lon, c.lat, c.lon) : radius,
      };
    })
    .filter((x) => x.url && (!strict || x.named > 0 || x.d <= 60))
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
    source: "mock",
    spots: mockSpots(),
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
