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
  return {
    label: geo?.label || landmarks[0]?.title || "Somewhere interesting",
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
    areaKey,
    areaName: local && city ? `${local}, ${city}` : null,
  };
}

async function nearbyLandmarks(lat, lon) {
  // One call: geosearch generator + intro extract + thumbnail + coordinates.
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "geosearch",
    ggscoord: `${lat}|${lon}`,
    ggsradius: "2000",
    ggslimit: "15",
    prop: "extracts|pageimages|coordinates|info",
    inprop: "url",
    exintro: "1",
    explaintext: "1",
    exsentences: "3",
    exlimit: "15",
    piprop: "thumbnail",
    pithumbsize: "900",
    pilimit: "15",
  });
  const d = await getJson(`https://en.wikipedia.org/w/api.php?${params}`);
  const pages = Object.values(d.query?.pages || {});
  return pages
    .map((p) => {
      const c = p.coordinates?.[0];
      return {
        pageid: p.pageid,
        title: p.title,
        extract: p.extract || "",
        thumbnail: p.thumbnail?.source || null,
        url: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
        lat: c?.lat ?? null,
        lon: c?.lon ?? null,
        distance: c ? Math.round(dist(lat, lon, c.lat, c.lon)) : null,
      };
    })
    .sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9))
    .slice(0, 10);
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
