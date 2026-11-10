// Nearby places to eat. Two sources:
// - Google Places (when GOOGLE_PLACES_API_KEY is set): ratings, review counts,
//   price level, open-now and photos. Ranked by rating, popularity and distance.
// - OpenStreetMap via Overpass (free, no key, the fallback): names, cuisine and
//   type, but no ratings or photos. Ranked by type, local (not a chain), and how
//   well documented the place is.
// Either way the result is a short, varied list (not ten coffee shops) of
// "spots" in one shape the rest of the app understands.

import { spendPlacesCall } from "./budget.js";

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY || "";
const OVERPASS_URL = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
export const FOOD_SOURCE = GOOGLE_KEY ? "google" : "osm";

const MAX_SPOTS = 12;
const RADIUS_M = 1500; // food is a walking-distance thing

export async function nearbyFood(lat, lon, { ua }) {
  if (GOOGLE_KEY) {
    try {
      return { source: "google", spots: await googleSpots(lat, lon) };
    } catch (err) {
      console.error("google places failed; falling back to OpenStreetMap", err.message);
    }
  }
  return { source: "osm", spots: await osmSpots(lat, lon, ua) };
}

// Picks the best spots while keeping the list varied: each extra spot of the
// same category (cuisine or type) counts for less.
function pickVaried(cands, n = MAX_SPOTS) {
  const left = cands.filter((c) => c.score != null);
  const used = new Map();
  const out = [];
  while (out.length < n && left.length) {
    let best = 0;
    let bestScore = -Infinity;
    left.forEach((c, i) => {
      const s = c.score * 0.55 ** (used.get(c.category) || 0);
      if (s > bestScore) { bestScore = s; best = i; }
    });
    const [c] = left.splice(best, 1);
    used.set(c.category, (used.get(c.category) || 0) + 1);
    out.push(c);
  }
  return out.map(({ score, category, ...c }) => c);
}

const falloff = (distance, halfKm) => 1 + ((distance ?? 800) / 1000 / halfKm) ** 2;

// ---------------------------------------------------------------- Google ---
const PRICE = { PRICE_LEVEL_FREE: "Free", PRICE_LEVEL_INEXPENSIVE: "$", PRICE_LEVEL_MODERATE: "$$", PRICE_LEVEL_EXPENSIVE: "$$$", PRICE_LEVEL_VERY_EXPENSIVE: "$$$$" };
const GOOGLE_TYPES = [
  ["restaurant", "bakery", "cafe", "coffee_shop", "ice_cream_shop", "dessert_shop", "deli", "food_court"],
  ["restaurant", "bakery", "cafe"], // older type list, in case the API rejects a newer type
];
const FIELDS = [
  "id", "displayName", "primaryType", "primaryTypeDisplayName", "types", "location", "rating", "userRatingCount",
  "priceLevel", "photos", "googleMapsUri", "websiteUri", "editorialSummary", "shortFormattedAddress",
  "currentOpeningHours.openNow", "businessStatus",
].map((f) => `places.${f}`).join(",");

async function googleSpots(lat, lon) {
  let data;
  for (const includedTypes of GOOGLE_TYPES) {
    if (!spendPlacesCall("nearby")) throw new Error("daily Places limit reached");
    const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": GOOGLE_KEY, "X-Goog-FieldMask": FIELDS },
      body: JSON.stringify({
        includedTypes,
        maxResultCount: 20,
        rankPreference: "POPULARITY",
        locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius: RADIUS_M } },
      }),
    });
    if (res.ok) { data = await res.json(); break; }
    const body = await res.text();
    if (res.status !== 400) throw new Error(`${res.status} from Google Places: ${body.slice(0, 200)}`);
    console.error("google places rejected the request, retrying with fewer types", body.slice(0, 200));
  }
  if (!data) throw new Error("Google Places rejected every request");

  const cands = (data.places || [])
    .filter((p) => !p.businessStatus || p.businessStatus === "OPERATIONAL")
    .map((p) => {
      const plat = p.location?.latitude;
      const plon = p.location?.longitude;
      const distance = plat != null ? Math.round(dist(lat, lon, plat, plon)) : null;
      const n = p.userRatingCount || 0;
      const r = p.rating || 0;
      // Shrink small-sample ratings toward a typical 4.1 so a 5.0 from 3 reviews
      // doesn't beat a 4.7 from 2,000.
      const bayes = (r * n + 4.1 * 30) / (n + 30);
      const kind = p.primaryTypeDisplayName?.text || "Restaurant";
      const photo = p.photos?.[0]?.name;
      return {
        id: `g:${p.id}`,
        title: p.displayName?.text || "Unnamed spot",
        kind,
        cuisine: cuisineFromGoogle(p, kind),
        description: kind,
        extract: p.editorialSummary?.text || "",
        rating: p.rating ?? null,
        ratingCount: p.userRatingCount ?? null,
        price: PRICE[p.priceLevel] || null,
        openNow: p.currentOpeningHours?.openNow ?? null,
        address: p.shortFormattedAddress || null,
        website: p.websiteUri || null,
        mapsUrl: p.googleMapsUri || null,
        url: p.googleMapsUri || p.websiteUri || null,
        thumbnail: photo ? `/api/food-photo?ref=${encodeURIComponent(photo)}` : null,
        lat: plat ?? null,
        lon: plon ?? null,
        distance,
        famous: false,
        category: p.primaryType || kind,
        score: ((bayes - 3.6) * 2 + Math.log10(n + 1) * 0.5) / falloff(distance, 1.2),
      };
    })
    .sort((a, b) => b.score - a.score);
  return pickVaried(cands);
}

// "ramen_restaurant" -> "Ramen"; generic types say nothing about the food.
const GENERIC = new Set(["restaurant", "food", "point_of_interest", "establishment", "store", "meal_takeaway", "meal_delivery", "bar", "cafe", "bakery", "coffee_shop"]);
function cuisineFromGoogle(p, kind = "") {
  const t = (p.types || []).find((x) => x.endsWith("_restaurant") && !GENERIC.has(x));
  if (!t) return null;
  const c = t.replace(/_restaurant$/, "").split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  // "Ramen Restaurant" already says it.
  return kind.toLowerCase().includes(c.toLowerCase()) ? null : c;
}

// Turns a photo reference into a short-lived image URL (no API key in it),
// so the key never reaches the browser. Cached for 12 hours per photo, and
// browsers keep it for a day, so a photo costs at most two calls a day.
const photoCache = new Map();
export async function googlePhotoUrl(ref) {
  if (!GOOGLE_KEY || !/^places\/[\w-]+\/photos\/[\w-]+$/.test(ref)) return null;
  const hit = photoCache.get(ref);
  if (hit && Date.now() - hit.at < 12 * 3600_000) return hit.url;
  if (!spendPlacesCall("photo")) return hit?.url || null;
  const res = await fetch(`https://places.googleapis.com/v1/${ref}/media?maxWidthPx=900&skipHttpRedirect=true&key=${encodeURIComponent(GOOGLE_KEY)}`);
  if (!res.ok) throw new Error(`${res.status} from Google Places photos`);
  const { photoUri } = await res.json();
  if (photoCache.size > 5000) photoCache.clear();
  photoCache.set(ref, { at: Date.now(), url: photoUri });
  return photoUri;
}

// ------------------------------------------------------- OpenStreetMap ---
// How much a type of place belongs in a food guide, before anything else.
const OSM_WEIGHT = {
  restaurant: 1, marketplace: 1.1, food_court: 0.8, bakery: 0.85, pastry: 0.8, deli: 0.75, cafe: 0.65,
  ice_cream: 0.6, biergarten: 0.55, pub: 0.45, cheese: 0.6, chocolate: 0.55, confectionery: 0.5,
  seafood: 0.5, coffee: 0.45, tea: 0.4, wine: 0.35, butcher: 0.3, greengrocer: 0.25, fast_food: 0.2,
};
const OSM_LABEL = {
  restaurant: "Restaurant", marketplace: "Market", food_court: "Food hall", bakery: "Bakery", pastry: "Pastry shop",
  deli: "Deli", cafe: "Café", ice_cream: "Ice cream", biergarten: "Beer garden", pub: "Pub", cheese: "Cheese shop",
  chocolate: "Chocolate shop", confectionery: "Sweet shop", seafood: "Fish market", coffee: "Coffee roaster",
  tea: "Tea shop", wine: "Wine shop", butcher: "Butcher", greengrocer: "Greengrocer", fast_food: "Quick bite",
};

async function osmSpots(lat, lon, ua) {
  const around = `(around:${RADIUS_M},${lat},${lon})`;
  const query = `[out:json][timeout:20];
(
  nwr${around}[amenity~"^(restaurant|cafe|fast_food|ice_cream|food_court|pub|biergarten|marketplace)$"][name];
  nwr${around}[shop~"^(bakery|pastry|deli|cheese|chocolate|confectionery|seafood|coffee|tea|wine|butcher|greengrocer)$"][name];
);
out center tags 400;`;
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "User-Agent": ua, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) throw new Error(`${res.status} from Overpass`);
  const d = await res.json();
  const seen = new Set();
  const cands = [];
  for (const e of d.elements || []) {
    const t = e.tags || {};
    const plat = e.lat ?? e.center?.lat;
    const plon = e.lon ?? e.center?.lon;
    const type = t.amenity && OSM_WEIGHT[t.amenity] != null ? t.amenity : t.shop;
    if (!type || OSM_WEIGHT[type] == null || plat == null) continue;
    if (t.disused || t["disused:amenity"] || t.opening_hours === "closed") continue;
    const dupe = `${t.name.toLowerCase()}|${plat.toFixed(3)},${plon.toFixed(3)}`;
    if (seen.has(dupe)) continue;
    seen.add(dupe);
    const cand = osmSpot(e, t, type, plat, plon, lat, lon);
    if (cand) cands.push(cand);
  }
  cands.sort((a, b) => b.score - a.score);
  return pickVaried(cands);
}

function osmSpot(e, t, type, plat, plon, lat, lon) {
  const distance = Math.round(dist(lat, lon, plat, plon));
  const cuisine = t.cuisine
    ? t.cuisine.split(";").map((c) => c.trim().replace(/_/g, " ")).filter(Boolean).slice(0, 2).map((c) => c[0].toUpperCase() + c.slice(1)).join(", ")
    : null;
  const chain = Boolean(t.brand || t["brand:wikidata"]);
  const notable = Boolean(t.wikidata || t.wikipedia);
  let score = OSM_WEIGHT[type];
  if (notable && !chain) score += 1.5;
  if (chain) score -= 1.2;
  if (cuisine) score += 0.3;
  if (t.website || t["contact:website"]) score += 0.2;
  if (t.opening_hours) score += 0.1;
  if (t.description) score += 0.2;
  const kind = OSM_LABEL[type];
  const website = t.website || t["contact:website"] || null;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${t.name} ${plat},${plon}`)}`;
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  return {
    id: `osm:${e.type}/${e.id}`,
    title: t.name,
    kind,
    cuisine,
    description: [kind, cuisine].filter(Boolean).join(" · "),
    extract: t.description || "",
    rating: null,
    ratingCount: null,
    price: null,
    openNow: null,
    hours: t.opening_hours || null,
    address: street || null,
    website,
    mapsUrl,
    url: website || mapsUrl,
    thumbnail: null,
    lat: plat,
    lon: plon,
    distance,
    famous: notable && !chain,
    wikipedia: t.wikipedia || null,
    category: cuisine ? cuisine.split(",")[0].toLowerCase() : type,
    score: score / falloff(distance, 0.8),
  };
}

export function dist(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(a));
}

export function mockSpots() {
  return [
    { id: "mock:1", title: "Harbor Noodle House", kind: "Restaurant", cuisine: "Ramen", description: "Restaurant · Ramen", extract: "A tiny counter famous for its shoyu ramen and a queue that forms before opening.", rating: 4.6, ratingCount: 1840, price: "$$", openNow: true, address: "12 Wharf St", mapsUrl: "https://maps.google.com", url: "https://maps.google.com", thumbnail: null, lat: 48.851, lon: 2.291, distance: 140, famous: true },
    { id: "mock:2", title: "Old Market Hall", kind: "Market", cuisine: null, description: "Market", extract: "A covered iron-and-glass market from 1889, now full of food stalls.", rating: 4.5, ratingCount: 5210, price: "$", openNow: true, address: "Market Sq", mapsUrl: "https://maps.google.com", url: "https://maps.google.com", thumbnail: null, lat: 48.848, lon: 2.288, distance: 610, famous: true },
    { id: "mock:3", title: "Mariner's Bakery", kind: "Bakery", cuisine: null, description: "Bakery", extract: "", rating: 4.7, ratingCount: 620, price: "$", openNow: false, address: "3 Rope Lane", mapsUrl: "https://maps.google.com", url: "https://maps.google.com", thumbnail: null, lat: 48.853, lon: 2.294, distance: 320, famous: false },
    { id: "mock:4", title: "Casa Lisboa", kind: "Restaurant", cuisine: "Portuguese", description: "Restaurant · Portuguese", extract: "", rating: 4.4, ratingCount: 410, price: "$$$", openNow: true, address: "40 Quay Rd", mapsUrl: "https://maps.google.com", url: "https://maps.google.com", thumbnail: null, lat: 48.846, lon: 2.297, distance: 820, famous: false },
    { id: "mock:5", title: "Gelato Lighthouse", kind: "Ice cream", cuisine: null, description: "Ice cream", extract: "", rating: 4.8, ratingCount: 970, price: "$", openNow: true, address: "End of the pier", mapsUrl: "https://maps.google.com", url: "https://maps.google.com", thumbnail: null, lat: 48.846, lon: 2.299, distance: 900, famous: false },
  ];
}
