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

import { spendPlacesCall } from "./budget.js";

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

export function initFlorence(s) {
  store = s;
  if (!FLORENCE_MODE) return;
  for (const c of CURATED) {
    const saved = store.getValue(`geo:${c.id}`);
    if (saved) resolved.set(c.id, { ...JSON.parse(saved), at: 0 });
  }
  if (process.env.MOCK_PLACES !== "1") resolveAll().catch((err) => console.error("florence lookups failed", err.message));
}

// One place at a time: OpenStreetMap's free geocoder allows ~1 request a second.
let resolving = null;
function resolveAll() {
  resolving ??= (async () => {
    for (const c of CURATED) {
      const r = resolved.get(c.id);
      if (r && (!GOOGLE_KEY || Date.now() - r.at < LOOKUP_TTL_MS)) continue;
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
      } catch (err) {
        console.error("florence lookup failed", c.title, err.message);
      }
      if (!GOOGLE_KEY) await new Promise((r) => setTimeout(r, 1100));
    }
  })().finally(() => { resolving = null; });
  return resolving;
}
// Check twice a day for places whose Google details are due for a refresh.
setInterval(() => { if (FLORENCE_MODE && GOOGLE_KEY) resolveAll().catch(() => {}); }, 12 * 3600_000).unref();

async function geocode(c) {
  const q = `${c.address}, 50100 Firenze, Italia`;
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=it&q=${encodeURIComponent(q)}`, { headers: { "User-Agent": UA } });
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
    body: JSON.stringify({ textQuery: `${c.title}, ${c.address}, Firenze`, maxResultCount: 1, locationBias: { circle: { center: { latitude: DUOMO.lat, longitude: DUOMO.lon }, radius: 15000 } } }),
  });
  if (!res.ok) throw new Error(`${res.status} from Google Places: ${(await res.text()).slice(0, 200)}`);
  const p = (await res.json()).places?.[0];
  if (!p?.location) return geocode(c);
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
      thumbnail: pick ? `/api/food-photo?ref=${encodeURIComponent(pick.name)}` : null,
      photoCredit: pick?.authorAttributions?.[0]?.displayName || null,
      gallery: photos.slice(0, 6).map((ph) => ({ url: `/api/food-photo?ref=${encodeURIComponent(ph.name)}`, credit: ph.authorAttributions?.[0]?.displayName || null })),
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
      thumbnail: g.thumbnail || r?.photo || null,
      photoCredit: g.photoCredit || r?.photoCredit || null,
      gallery: g.gallery || [],
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
