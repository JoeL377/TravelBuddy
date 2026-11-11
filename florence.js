// Florence mode: instead of whatever is near you, the app guides you through a
// hand-picked list of Florence's best places to eat (Michelin, Gambero Rosso,
// Lonely Planet, checked November 2026). If you're in Florence, places are
// sorted by distance from you; anywhere else, the app opens on the Duomo.
//
// Each place's coordinates (and, with GOOGLE_PLACES_API_KEY, its Google rating,
// price, open-now and photos) are looked up once and remembered.

export const CITY = (process.env.FOOD_CITY || "florence").toLowerCase();
export const FLORENCE_MODE = CITY === "florence";

export const DUOMO = { lat: 43.77310, lon: 11.25600 };
// Further than this from the Duomo and you're "not in Florence".
const IN_CITY_M = 12000;

import { spendPlacesCall, placesUsage } from "./budget.js";
import { googlePhotoUrl } from "./food.js";

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY || "";
const UA = `TravelBuddy/0.2 (food guide${process.env.CONTACT_EMAIL ? `; ${process.env.CONTACT_EMAIL}` : ""})`;

const MICHELIN = { name: "Michelin Guide 2026", url: "https://www.romeing.it/florence/michelin-starred-restaurants-in-florence/" };
const FCG = { name: "Florence City Guide", url: "https://florencecityguide.com/best-restaurants-in-florence/" };
const LP = { name: "Lonely Planet", url: "https://www.lonelyplanet.com/articles/best-places-to-eat-in-florence" };
const GR_BURDE = { name: "Gambero Rosso", url: "https://www.gamberorosso.it/ristoranti/scheda-ristorante/da-burde" };

// tier: 1 fine dining, 2 modern Florentine, 3 trattoria, 4 street food & more.
// Facts here come from the sources listed; stories add to them from the web.
export const CURATED = [
  { id: "fi:pinchiorri", title: "Enoteca Pinchiorri", tier: 1, kind: "Fine dining", cuisine: "Italian", price: "$$$$", badge: "3 Michelin stars", address: "Via Ghibellina 87", hood: "Santa Croce",
    extract: "Florence's only three-Michelin-star restaurant, in a 17th-century palazzo, with one of the great wine cellars of the world.", order: "The tasting menu, the soufflé and anything from the pastry kitchen; ask about the cellar.", sources: [MICHELIN, FCG] },
  { id: "fi:gucci-osteria", title: "Gucci Osteria da Massimo Bottura", tier: 1, kind: "Fine dining", cuisine: "Italian", price: "$$$$", badge: "1 Michelin star", address: "Piazza della Signoria 10", hood: "Centro",
    extract: "Massimo Bottura's Florence outpost inside the Gucci Garden palazzo on Piazza della Signoria, with chef Karime Lopez in the kitchen.", order: "Tortellini in Parmesan cream.", sources: [MICHELIN, FCG, LP] },
  { id: "fi:atto", title: "Atto di Vito Mollica", tier: 1, kind: "Fine dining", cuisine: "Italian", price: "$$$$", badge: "1 Michelin star", address: "Via del Corso 6", hood: "Centro",
    extract: "Vito Mollica's restaurant in Palazzo Portinari Salviati, the palazzo of the family of Dante's Beatrice.", order: "Seared langoustine with carrot-orange and Champagne sauces.", sources: [MICHELIN, FCG] },
  { id: "fi:borgo-san-jacopo", title: "Borgo San Jacopo", tier: 1, kind: "Fine dining", cuisine: "Italian", price: "$$$$", badge: "1 Michelin star", address: "Borgo San Jacopo 62r", hood: "Oltrarno",
    extract: "Hotel Lungarno's starred dining room, with a handful of balcony tables hanging over the Arno near Ponte Vecchio.", order: "Meat and fish dishes with a Tuscan touch; book a balcony table.", sources: [MICHELIN, FCG] },
  { id: "fi:saporium", title: "Saporium Firenze", tier: 1, kind: "Fine dining", cuisine: "Italian", price: "$$$$", badge: "1 Michelin star", address: "Lungarno Benvenuto Cellini 63r", hood: "San Niccolò",
    extract: "An open-kitchen fine dining room on the Arno in San Niccolò.", order: "Caterina de' Medici's rose, a modern zuccotto with milk and Alkermes.", sources: [MICHELIN, FCG] },
  { id: "fi:il-palagio", title: "Il Palagio", tier: 1, kind: "Fine dining", cuisine: "Italian", price: "$$$$", badge: "1 Michelin star", address: "Borgo Pinti 99", hood: "Santa Croce",
    extract: "The Four Seasons' starred restaurant in Palazzo della Gherardesca, beside one of the largest private gardens in Florence.", order: "One of the two tasting menus.", sources: [MICHELIN, FCG] },
  { id: "fi:lucas", title: "Luca's by Paulo Airaudo", tier: 1, kind: "Fine dining", cuisine: "Italian", price: "$$$$", badge: "1 Michelin star", address: "Via dei Cavalieri 2c", hood: "Centro",
    extract: "Paulo Airaudo's intimate tasting-menu restaurant in Hotel La Gemma.", order: "The tasting menu; the goat's milk flan with strawberry caramel crust.", sources: [MICHELIN, FCG] },
  { id: "fi:leggenda-frati", title: "La Leggenda dei Frati", tier: 1, kind: "Fine dining", cuisine: "Italian", price: "$$$$", badge: "Michelin Guide", address: "Costa San Giorgio 6a", hood: "Oltrarno",
    extract: "In the grounds of Villa Bardini on the hill above the Arno, with sunset views over the rooftops and the Duomo.", order: "The seven- or nine-course tasting menu, or hare ravioli with cocoa and truffle.", sources: [FCG, LP] },

  { id: "fi:cibreo", title: "Cibrèo", tier: 2, kind: "Restaurant", cuisine: "Florentine", price: "$$$", badge: "Since 1979", address: "Via Andrea del Verrocchio 8r", hood: "Sant'Ambrogio",
    extract: "The Sant'Ambrogio institution Fabio Picchi opened in 1979, famous for serving old Florentine recipes without pasta.", order: "Pork liver with lemon, squab with mostarda, the bitter orange cheese tart.", sources: [FCG] },
  { id: "fi:santo-bevitore", title: "Il Santo Bevitore", tier: 2, kind: "Restaurant", cuisine: "Tuscan", price: "$$", badge: "Michelin Guide", address: "Via Santo Spirito 64r", hood: "Santo Spirito",
    extract: "A candlelit, vaulted Oltrarno room with its own bakery and a list of small Tuscan wine producers, loved since 2002.", order: "Ribollita, roast pigeon with zolfini beans, handmade pasta.", sources: [FCG, LP] },
  { id: "fi:nugolo", title: "Nugolo", tier: 2, kind: "Restaurant", cuisine: "Italian", price: "$$", badge: "Michelin Guide", address: "Via della Mattonaia 27r", hood: "Sant'Ambrogio",
    extract: "A convivial, contemporary spot from a young chef near the Sant'Ambrogio market.", order: "Seared octopus with mussels, duck breast with red-fruit jus, buffalo-milk panna cotta.", sources: [FCG] },
  { id: "fi:konnubio", title: "Konnubio", tier: 2, kind: "Restaurant", cuisine: "Italian", price: "$$", badge: "Michelin Guide", address: "Via dei Conti 8r", hood: "San Lorenzo",
    extract: "Relaxed but polished contemporary Italian cooking near San Lorenzo.", order: "Cuttlefish tagliatelle with its own ragù.", sources: [FCG] },

  { id: "fi:sostanza", title: "Trattoria Sostanza", tier: 3, kind: "Trattoria", cuisine: "Florentine", price: "$$", badge: "150+ years old", address: "Via della Porcellana 25r", hood: "Santa Maria Novella",
    extract: "A narrow, white-tiled trattoria that has been cooking over embers for more than 150 years.", order: "Bistecca cooked over the embers, crostini di fegatini.", sources: [FCG] },
  { id: "fi:da-burde", title: "Da Burde", tier: 3, kind: "Trattoria", cuisine: "Florentine", price: "$$", badge: "Bib Gourmand", address: "Via Pistoiese 154", hood: "Peretola",
    extract: "A food shop with a trattoria next door, run by the same family for over 120 years, outside the old walls.", order: "Bistecca alla fiorentina, cured meats and cheese to start.", sources: [FCG, GR_BURDE] },
  { id: "fi:del-fagioli", title: "Del Fagioli", tier: 3, kind: "Trattoria", cuisine: "Florentine", price: "$", badge: "Michelin Guide", address: "Corso dei Tintori 47r", hood: "Santa Croce",
    extract: "A rustic, open-kitchen trattoria in Santa Croce at honest prices.", order: "Pici with aglione, pappa al pomodoro, twice-cooked beef with green beans.", sources: [FCG] },
  { id: "fi:mario", title: "Trattoria Mario", tier: 3, kind: "Trattoria", cuisine: "Florentine", price: "$", badge: "Since 1953", address: "Via Rosina 2r", hood: "San Lorenzo",
    extract: "A family-run lunch trattoria by the San Lorenzo market since 1953, with shared tables and a menu that changes by the day.", order: "Bistecca for two; tripe on Mondays, rabbit on Thursdays, salt cod on Fridays.", sources: [LP] },
  { id: "fi:sabatino", title: "Trattoria Sabatino", tier: 3, kind: "Trattoria", cuisine: "Florentine", price: "$", badge: "Since 1956", address: "Via Pisana 2r", hood: "San Frediano",
    extract: "A family trattoria in San Frediano since 1956. No reservations and closed on weekends: arrive half an hour before it opens.", order: "Ravioli al sugo, stracotto, bistecca with a side.", sources: [LP] },
  { id: "fi:da-bibe", title: "Da Bibe", tier: 3, kind: "Trattoria", cuisine: "Florentine", price: "$$", badge: "6th generation", address: "Via delle Bagnese 1r", hood: "Galluzzo",
    extract: "A 150-year-old country trattoria south of the city, now run by the sixth generation of the same family.", order: "Pici al ragù, peposo, fried or grilled chicken.", sources: [FCG] },
  { id: "fi:il-magazzino", title: "Osteria Tripperia Il Magazzino", tier: 3, kind: "Trattoria", cuisine: "Offal", price: "$$", badge: "Tripe specialist", address: "Piazza della Passera 2", hood: "Oltrarno",
    extract: "A small Oltrarno osteria that makes Florence's offal tradition the main event.", order: "Tongue carpaccio, lampredotto meatballs, pappardelle with duck, peposo.", sources: [FCG] },

  { id: "fi:lupen-margo", title: "Lupen e Margo", tier: 4, kind: "Street food", cuisine: "Lampredotto", price: "$", badge: "Street food", address: "Via dell'Ariento 75", hood: "San Lorenzo",
    extract: "A tripe stand at the San Lorenzo market run by Beatrice, Florence's only woman tripaia.", order: "A lampredotto sandwich with green sauce and a dip of the broth.", sources: [LP] },
  { id: "fi:xinge", title: "Il Gusto di Xinge", tier: 4, kind: "Restaurant", cuisine: "Chinese", price: "$$", badge: "Michelin Guide", address: "Viale Belfiore 2", hood: "Santa Maria Novella",
    extract: "Chinese cooking with Italian and French training behind the station, with a devoted following and creative cocktails.", order: "Sheng jian bao with pork and Tuscan truffle, dim sum.", sources: [FCG, LP] },
];

let store = null;
const resolved = new Map(); // id -> { lat, lon, google? }
// Google details (rating, open now, photo references) are refreshed every 3 days.
const LOOKUP_TTL_MS = 3 * 24 * 3600_000;

let classifyPhoto = null; // (imageUrl, placeTitle) -> "DISH" | "FOOD" | "DRINK" | "PLACE" | ...

export function initFlorence(s, { classify = null } = {}) {
  store = s;
  classifyPhoto = classify;
  if (!FLORENCE_MODE) return;
  for (const c of CURATED) {
    const saved = store.getValue(`geo:${c.id}`);
    if (saved) resolved.set(c.id, { ...JSON.parse(saved), at: 0 });
  }
  if (process.env.MOCK_PLACES !== "1") resolveAll().catch((err) => console.error("florence lookups failed", err.message));
}

// One place at a time: OpenStreetMap's free geocoder allows ~1 request a second.
let resolving = null;
// What the last lookups and photo picking did, for /healthz (no Railway logs needed).
const status = { lookupErrors: new Map(), pickStopped: null, pickAt: null };
export function florenceStatus() {
  const withGoogle = CURATED.filter((c) => resolved.get(c.id)?.google).length;
  const picked = CURATED.filter((c) => { const ch = readJson(PICK_KEY(c.id)); return ch && ch.index != null; }).length;
  return { places: CURATED.length, googleKey: !!GOOGLE_KEY, lastLookupAt: status.lookupAt, withGoogle, picked, resolving: !!resolving, picking, pickStopped: status.pickStopped, pickAt: status.pickAt, lookupErrors: Object.fromEntries(status.lookupErrors) };
}
function resolveAll() {
  resolving ??= (async () => {
    status.lookupAt = new Date().toISOString();
    for (const c of CURATED) {
      const r = resolved.get(c.id);
      if (r && (!GOOGLE_KEY || (r.google && Date.now() - r.at < LOOKUP_TTL_MS))) continue; // places Google missed are retried at each check
      try {
        // Over today's Google allowance: keep what we have, or fall back to the free geocoder.
        const useGoogle = GOOGLE_KEY && spendPlacesCall("search");
        if (GOOGLE_KEY && !useGoogle && r) continue;
        const hit = useGoogle ? await googleLookup(c) : await geocode(c);
        if (hit) {
          resolved.set(c.id, { ...hit, at: Date.now() });
          // Coordinates and the Google place ID may be kept; other Google data is refreshed.
          store?.setValue(`geo:${c.id}`, JSON.stringify({ lat: hit.lat, lon: hit.lon, placeId: hit.google?.placeId || null }));
        }
        if (hit?.google) status.lookupErrors.delete(c.title);
      } catch (err) {
        console.error("florence lookup failed", c.title, err.message);
        status.lookupErrors.set(c.title, err.message.slice(0, 160));
      }
      // Pace the lookups: the free geocoder allows ~1 a second, and a
      // per-minute quota on the Google key would otherwise cut off the end of the list.
      await new Promise((r) => setTimeout(r, GOOGLE_KEY ? 3000 : 1100));
    }
  })().finally(() => { resolving = null; pickFoodPhotos().catch((err) => console.error("food photo picking failed", err.message)); });
  return resolving;
}
// Check twice a day for places whose Google details are due for a refresh.
setInterval(() => { if (FLORENCE_MODE && GOOGLE_KEY) resolveAll().catch(() => {}); }, 12 * 3600_000).unref();

async function geocode(c) {
  const q = `${c.address}, 50100 Firenze, Italia`;
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=it&q=${encodeURIComponent(q)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${res.status} from Nominatim`);
  const [hit] = await res.json();
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
}

const PRICE = { PRICE_LEVEL_INEXPENSIVE: "$", PRICE_LEVEL_MODERATE: "$$", PRICE_LEVEL_EXPENSIVE: "$$$", PRICE_LEVEL_VERY_EXPENSIVE: "$$$$" };
async function googleLookup(c) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.photos,places.googleMapsUri,places.websiteUri,places.currentOpeningHours.openNow",
    },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ textQuery: `${c.title}, ${c.address}, Firenze`, maxResultCount: 1, locationBias: { circle: { center: { latitude: DUOMO.lat, longitude: DUOMO.lon }, radius: 15000 } } }),
  });
  if (!res.ok) throw new Error(`${res.status} from Google Places: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const p = body.places?.[0];
  if (!p?.location) {
    // Shown in /healthz, so a key or query problem is visible without the server logs.
    status.lookupErrors.set(c.title, `no Google match: ${JSON.stringify(body).slice(0, 160)}`);
    console.warn("no Google match", c.title, JSON.stringify(body).slice(0, 300));
    return geocode(c);
  }
  // Prefer the place's own photos, in Google's order; a curated `photo` index can pin a better one.
  const photos = (p.photos || []).slice(0, 10);
  const pick = photos[c.photo ?? 0] || photos[0];
  return {
    lat: p.location.latitude,
    lon: p.location.longitude,
    google: {
      placeId: p.id,
      rating: p.rating ?? null,
      ratingCount: p.userRatingCount ?? null,
      price: PRICE[p.priceLevel] || null,
      openNow: p.currentOpeningHours?.openNow ?? null,
      mapsUrl: p.googleMapsUri || null,
      website: p.websiteUri || null,
      // All candidate photos; pickFoodPhotos() chooses the one that shows a dish.
      photos: photos.map((ph) => ({ name: ph.name, credit: ph.authorAttributions?.[0]?.displayName || null })),
      fallbackIndex: photos.indexOf(pick),
    },
  };
}

function dist(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(a));
}

export const inFlorence = (lat, lon) => dist(lat, lon, DUOMO.lat, DUOMO.lon) <= IN_CITY_M;

// The curated list as spots, measured from (lat, lon). In Florence: nearest
// first. Elsewhere: by tier (fine dining first), in the order above.
export function florenceSpots(lat, lon, { mock = false, nearest = inFlorence(lat, lon) } = {}) {
  const here = nearest;
  const spots = CURATED.map((c, i) => {
    const r = resolved.get(c.id) || (mock ? mockCoords(i) : null);
    const g = r?.google || {};
    const mapsUrl = g.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.title}, ${c.address}, Firenze`)}`;
    return {
      id: c.id,
      title: c.title,
      kind: c.kind,
      cuisine: c.cuisine,
      description: [c.kind, c.cuisine].filter(Boolean).join(" · "),
      extract: c.extract,
      order: c.order,
      badge: c.badge,
      tier: c.tier,
      hood: c.hood,
      sources: c.sources,
      rating: g.rating ?? null,
      ratingCount: g.ratingCount ?? null,
      price: g.price || c.price,
      openNow: g.openNow ?? null,
      address: `${c.address}, ${c.hood}`,
      website: g.website || null,
      mapsUrl,
      url: mapsUrl,
      ...photoFor(c.id, g, r),
      lat: r?.lat ?? null,
      lon: r?.lon ?? null,
      distance: r ? Math.round(dist(lat, lon, r.lat, r.lon)) : null,
      famous: c.tier === 1,
      curated: true,
      order_i: i,
    };
  });
  spots.sort(here ? (a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9) : (a, b) => a.order_i - b.order_i);
  return spots.map(({ order_i, ...s }) => s);
}

// --- Food photos ---------------------------------------------------------
// Google's first photo of a restaurant is usually the dining room or the
// front door, and the first food photo isn't always a good one. So a vision
// model looks at every Google photo of each place (Google gives at most 10)
// and scores it as a full-screen cover: is it a dish, is it sharp, well lit,
// close and appetizing. The best-scoring dish wins. The choice is remembered
// (as its position in Google's list and its photographer) for 30 days.
// Looking costs one Places photo call per photo, so it pauses while today's
// Google allowance is nearly spent and carries on later, always leaving
// PHOTO_RESERVE calls for serving visitors. Until a place's new pick is
// finished, it keeps showing its previous pick.
const PICK_TTL_MS = 30 * 24 * 3600_000;
const PHOTO_RESERVE = 25;
const PICK_KEY = (id) => `foodpick2:${id}`;
// How much each kind of photo is worth as a cover, on top of its 1-10 score.
const KIND_BONUS = { DISH: 0, FOOD: -2, DRINK: -3 };

const readJson = (key) => {
  try { return JSON.parse(store?.getValue(key) || "null"); } catch { return null; }
};
// A remembered choice still applies if the same photographer's photo is at that position.
const choiceValid = (ch, photos) => ch && ch.index != null && photos[ch.index] && photos[ch.index].credit === ch.credit;
// The scored pick if finished, else the earlier first-dish pick.
const currentChoice = (id, photos) => [readJson(PICK_KEY(id)), readJson(`foodphoto:${id}`)].find((ch) => choiceValid(ch, photos)) || null;

function photoFor(id, g, r) {
  const photos = g.photos || [];
  const ch = currentChoice(id, photos);
  const i = ch ? ch.index : g.fallbackIndex >= 0 ? g.fallbackIndex : 0;
  const ph = photos[i];
  if (ph) return { thumbnail: `/api/food-photo?ref=${encodeURIComponent(ph.name)}`, photoCredit: ph.credit, photoKind: ch?.kind || null, photoScore: ch?.score ?? null };
  return { thumbnail: r?.photo || null, photoCredit: r?.photoCredit || null, photoKind: null, photoScore: null };
}

export function bestPhoto(seen) {
  let best = null;
  for (const [i, v] of Object.entries(seen)) {
    if (!(v.kind in KIND_BONUS)) continue;
    const value = v.score + KIND_BONUS[v.kind];
    if (!best || value > best.value || (value === best.value && Number(i) < best.i)) best = { i: Number(i), value, ...v };
  }
  return best;
}

let picking = false;
export async function pickFoodPhotos() {
  if (!classifyPhoto || !GOOGLE_KEY || picking) return;
  picking = true;
  status.pickAt = new Date().toISOString();
  status.pickStopped = null;
  const stop = (why) => { status.pickStopped = why; console.log(`food photo picking paused: ${why}`); };
  try {
    for (const c of CURATED) {
      const photos = resolved.get(c.id)?.google?.photos;
      if (!photos?.length) continue;
      let ch = readJson(PICK_KEY(c.id));
      if (choiceValid(ch, photos) && Date.now() - ch.at < PICK_TTL_MS) continue;
      // Google's list changed (or the pick is old): look again from scratch.
      if (ch && (ch.index != null || ch.count !== photos.length || Date.now() - ch.at >= PICK_TTL_MS)) ch = null;
      const seen = ch?.seen || {}; // position -> { kind, score }, kept across days while unfinished
      for (let i = 0; i < photos.length; i++) {
        if (seen[i]) continue;
        const { used, limit } = placesUsage();
        if (used >= limit - PHOTO_RESERVE) return stop("daily reserve reached"); // carry on later
        let url;
        try { url = await googlePhotoUrl(photos[i].name); } catch (err) { return stop(`photo for ${c.title}: ${err.message.slice(0, 160)}`); }
        if (!url) return stop(`no photo URL for ${c.title}`);
        const verdict = await classifyPhoto(url, c.title);
        if (!verdict) return stop(`vision check failed for ${c.title}`);
        seen[i] = verdict;
        console.log(`food photo ${c.title} #${i}: ${verdict.kind} ${verdict.score}`);
        store.setValue(PICK_KEY(c.id), JSON.stringify({ seen, count: photos.length, at: Date.now() }));
      }
      // Every photo scored: keep the best food shot, or Google's first photo if none shows food.
      const best = bestPhoto(seen);
      const index = best ? best.i : 0;
      store.setValue(PICK_KEY(c.id), JSON.stringify({ index, credit: photos[index].credit, kind: best?.kind || null, score: best?.score ?? null, seen, count: photos.length, at: Date.now() }));
    }
    status.pickStopped = "all done";
  } catch (err) {
    stop(err.message.slice(0, 160));
  } finally {
    picking = false;
  }
}
// Resume unfinished picks a few times a day (each run stops at the reserve).
setInterval(() => { if (FLORENCE_MODE) pickFoodPhotos().catch(() => {}); }, 4 * 3600_000).unref();

// Without a Google key, photos come from Wikimedia Commons near each address;
// places.js fills this in once coordinates are known.
export function setCommonsPhoto(id, url) {
  const r = resolved.get(id);
  if (r && url && !r.photo) r.photo = url;
}
export const needsCommonsPhoto = () => (GOOGLE_KEY ? [] : CURATED.filter((c) => resolved.get(c.id) && !resolved.get(c.id).photo && !resolved.get(c.id).photoTried));
export function markPhotoTried(id) {
  const r = resolved.get(id);
  if (r) r.photoTried = true;
}
export const resolvedCoords = (id) => resolved.get(id) || null;

// Demo mode without network: spread the places around the Duomo.
function mockCoords(i) {
  const a = (i / CURATED.length) * Math.PI * 2;
  const m = 300 + (i % 5) * 400;
  return { lat: DUOMO.lat + (Math.sin(a) * m) / 111320, lon: DUOMO.lon + (Math.cos(a) * m) / (111320 * Math.cos((DUOMO.lat * Math.PI) / 180)) };
}
