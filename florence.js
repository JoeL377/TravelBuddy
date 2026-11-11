// Florence mode: instead of whatever is near you, the app guides you through a
// hand-picked list of Florence's best places to eat (Michelin, Gambero Rosso,
// Lonely Planet, checked November 2026). If you're in Florence, places are
// sorted by distance from you; anywhere else, the app opens on the Duomo.
//
// Everything about each place, coordinates and photos included, is stored
// with the app: no paid API, nothing to look up at run time.

export const CITY = (process.env.FOOD_CITY || "florence").toLowerCase();
export const FLORENCE_MODE = CITY === "florence";

export const DUOMO = { lat: 43.77310, lon: 11.25600 };
// Further than this from the Duomo and you're "not in Florence".
const IN_CITY_M = 12000;

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MICHELIN = { name: "Michelin Guide 2026", url: "https://www.romeing.it/florence/michelin-starred-restaurants-in-florence/" };
const FCG = { name: "Florence City Guide", url: "https://florencecityguide.com/best-restaurants-in-florence/" };
const LP = { name: "Lonely Planet", url: "https://www.lonelyplanet.com/articles/best-places-to-eat-in-florence" };
const GR_BURDE = { name: "Gambero Rosso", url: "https://www.gamberorosso.it/ristoranti/scheda-ristorante/da-burde" };

// tier: 1 fine dining, 2 modern Florentine, 3 trattoria, 4 street food & more.
// Facts here come from the sources listed; stories add to them from the web.
export const CURATED = [
  { id: "fi:pinchiorri", lat: 43.77, lon: 11.2622222, title: "Enoteca Pinchiorri", tier: 1, kind: "Fine dining", cuisine: "Italian", price: "$$$$", badge: "3 Michelin stars", address: "Via Ghibellina 87", hood: "Santa Croce",
    extract: "Florence's only three-Michelin-star restaurant, in a 17th-century palazzo, with one of the great wine cellars of the world.", order: "The tasting menu, the soufflé and anything from the pastry kitchen; ask about the cellar.", sources: [MICHELIN, FCG] },
  { id: "fi:gucci-osteria", lat: 43.769737, lon: 11.2568188, title: "Gucci Osteria da Massimo Bottura", tier: 1, kind: "Fine dining", cuisine: "Italian", price: "$$$$", badge: "1 Michelin star", address: "Piazza della Signoria 10", hood: "Centro",
    extract: "Massimo Bottura's Florence outpost inside the Gucci Garden palazzo on Piazza della Signoria, with chef Karime Lopez in the kitchen.", order: "Tortellini in Parmesan cream.", sources: [MICHELIN, FCG, LP] },
  { id: "fi:atto", lat: 43.7715125, lon: 11.2573904, title: "Atto di Vito Mollica", tier: 1, kind: "Fine dining", cuisine: "Italian", price: "$$$$", badge: "1 Michelin star", address: "Via del Corso 6", hood: "Centro",
    extract: "Vito Mollica's restaurant in Palazzo Portinari Salviati, the palazzo of the family of Dante's Beatrice.", order: "Seared langoustine with carrot-orange and Champagne sauces.", sources: [MICHELIN, FCG] },
  { id: "fi:borgo-san-jacopo", lat: 43.7680072, lon: 11.2512944, title: "Borgo San Jacopo", tier: 1, kind: "Fine dining", cuisine: "Italian", price: "$$$$", badge: "1 Michelin star", address: "Borgo San Jacopo 62r", hood: "Oltrarno",
    extract: "Hotel Lungarno's starred dining room, with a handful of balcony tables hanging over the Arno near Ponte Vecchio.", order: "Meat and fish dishes with a Tuscan touch; book a balcony table.", sources: [MICHELIN, FCG] },
  { id: "fi:saporium", lat: 43.764527, lon: 11.265742, title: "Saporium Firenze", tier: 1, kind: "Fine dining", cuisine: "Italian", price: "$$$$", badge: "1 Michelin star", address: "Lungarno Benvenuto Cellini 63r", hood: "San Niccolò",
    extract: "An open-kitchen fine dining room on the Arno in San Niccolò.", order: "Caterina de' Medici's rose, a modern zuccotto with milk and Alkermes.", sources: [MICHELIN, FCG] },
  { id: "fi:il-palagio", lat: 43.7771869, lon: 11.266372, title: "Il Palagio", tier: 1, kind: "Fine dining", cuisine: "Italian", price: "$$$$", badge: "1 Michelin star", address: "Borgo Pinti 99", hood: "Santa Croce",
    extract: "The Four Seasons' starred restaurant in Palazzo della Gherardesca, beside one of the largest private gardens in Florence.", order: "One of the two tasting menus.", sources: [MICHELIN, FCG] },
  { id: "fi:lucas", lat: 43.7707363, lon: 11.2540568, title: "Luca's by Paulo Airaudo", tier: 1, kind: "Fine dining", cuisine: "Italian", price: "$$$$", badge: "1 Michelin star", address: "Via dei Cavalieri 2c", hood: "Centro",
    extract: "Paulo Airaudo's intimate tasting-menu restaurant in Hotel La Gemma.", order: "The tasting menu; the goat's milk flan with strawberry caramel crust.", sources: [MICHELIN, FCG] },
  { id: "fi:leggenda-frati", lat: 43.7643054, lon: 11.256038, title: "La Leggenda dei Frati", tier: 1, kind: "Fine dining", cuisine: "Italian", price: "$$$$", badge: "Michelin Guide", address: "Costa San Giorgio 6a", hood: "Oltrarno",
    extract: "In the grounds of Villa Bardini on the hill above the Arno, with sunset views over the rooftops and the Duomo.", order: "The seven- or nine-course tasting menu, or hare ravioli with cocoa and truffle.", sources: [FCG, LP] },

  { id: "fi:cibreo", lat: 43.771132, lon: 11.266452, title: "Cibrèo", tier: 2, kind: "Restaurant", cuisine: "Florentine", price: "$$$", badge: "Since 1979", address: "Via Andrea del Verrocchio 8r", hood: "Sant'Ambrogio",
    extract: "The Sant'Ambrogio institution Fabio Picchi opened in 1979, famous for serving old Florentine recipes without pasta.", order: "Pork liver with lemon, squab with mostarda, the bitter orange cheese tart.", sources: [FCG] },
  { id: "fi:santo-bevitore", lat: 43.7690392, lon: 11.2468281, title: "Il Santo Bevitore", tier: 2, kind: "Restaurant", cuisine: "Tuscan", price: "$$", badge: "Michelin Guide", address: "Via Santo Spirito 64r", hood: "Santo Spirito",
    extract: "A candlelit, vaulted Oltrarno room with its own bakery and a list of small Tuscan wine producers, loved since 2002.", order: "Ribollita, roast pigeon with zolfini beans, handmade pasta.", sources: [FCG, LP] },
  { id: "fi:nugolo", lat: 43.7718198, lon: 11.268021, title: "Nugolo", tier: 2, kind: "Restaurant", cuisine: "Italian", price: "$$", badge: "Michelin Guide", address: "Via della Mattonaia 27r", hood: "Sant'Ambrogio",
    extract: "A convivial, contemporary spot from a young chef near the Sant'Ambrogio market.", order: "Seared octopus with mussels, duck breast with red-fruit jus, buffalo-milk panna cotta.", sources: [FCG] },
  { id: "fi:konnubio", lat: 43.7743099, lon: 11.2532536, title: "Konnubio", tier: 2, kind: "Restaurant", cuisine: "Italian", price: "$$", badge: "Michelin Guide", address: "Via dei Conti 8r", hood: "San Lorenzo",
    extract: "Relaxed but polished contemporary Italian cooking near San Lorenzo.", order: "Cuttlefish tagliatelle with its own ragù.", sources: [FCG] },

  { id: "fi:sostanza", lat: 43.7726719, lon: 11.2470175, title: "Trattoria Sostanza", tier: 3, kind: "Trattoria", cuisine: "Florentine", price: "$$", badge: "150+ years old", address: "Via della Porcellana 25r", hood: "Santa Maria Novella",
    extract: "A narrow, white-tiled trattoria that has been cooking over embers for more than 150 years.", order: "Bistecca cooked over the embers, crostini di fegatini.", sources: [FCG] },
  { id: "fi:da-burde", lat: 43.7941421, lon: 11.1858446, title: "Da Burde", tier: 3, kind: "Trattoria", cuisine: "Florentine", price: "$$", badge: "Bib Gourmand", address: "Via Pistoiese 154", hood: "Peretola",
    extract: "A food shop with a trattoria next door, run by the same family for over 120 years, outside the old walls.", order: "Bistecca alla fiorentina, cured meats and cheese to start.", sources: [FCG, GR_BURDE] },
  { id: "fi:del-fagioli", lat: 43.7675005, lon: 11.2596794, title: "Del Fagioli", tier: 3, kind: "Trattoria", cuisine: "Florentine", price: "$", badge: "Michelin Guide", address: "Corso dei Tintori 47r", hood: "Santa Croce",
    extract: "A rustic, open-kitchen trattoria in Santa Croce at honest prices.", order: "Pici with aglione, pappa al pomodoro, twice-cooked beef with green beans.", sources: [FCG] },
  { id: "fi:mario", lat: 43.7765605, lon: 11.2545811, title: "Trattoria Mario", tier: 3, kind: "Trattoria", cuisine: "Florentine", price: "$", badge: "Since 1953", address: "Via Rosina 2r", hood: "San Lorenzo",
    extract: "A family-run lunch trattoria by the San Lorenzo market since 1953, with shared tables and a menu that changes by the day.", order: "Bistecca for two; tripe on Mondays, rabbit on Thursdays, salt cod on Fridays.", sources: [LP] },
  { id: "fi:sabatino", lat: 43.7707639, lon: 11.2400389, title: "Trattoria Sabatino", tier: 3, kind: "Trattoria", cuisine: "Florentine", price: "$", badge: "Since 1956", address: "Via Pisana 2r", hood: "San Frediano",
    extract: "A family trattoria in San Frediano since 1956. No reservations and closed on weekends: arrive half an hour before it opens.", order: "Ravioli al sugo, stracotto, bistecca with a side.", sources: [LP] },
  { id: "fi:da-bibe", lat: 43.7428384, lon: 11.2152771, title: "Da Bibe", tier: 3, kind: "Trattoria", cuisine: "Florentine", price: "$$", badge: "6th generation", address: "Via delle Bagnese 1r", hood: "Galluzzo",
    extract: "A 150-year-old country trattoria south of the city, now run by the sixth generation of the same family.", order: "Pici al ragù, peposo, fried or grilled chicken.", sources: [FCG] },
  { id: "fi:il-magazzino", lat: 43.7672232, lon: 11.2503629, title: "Osteria Tripperia Il Magazzino", tier: 3, kind: "Trattoria", cuisine: "Offal", price: "$$", badge: "Tripe specialist", address: "Piazza della Passera 2", hood: "Oltrarno",
    extract: "A small Oltrarno osteria that makes Florence's offal tradition the main event.", order: "Tongue carpaccio, lampredotto meatballs, pappardelle with duck, peposo.", sources: [FCG] },

  { id: "fi:lupen-margo", lat: 43.7760615, lon: 11.2530463, title: "Lupen e Margo", tier: 4, kind: "Street food", cuisine: "Lampredotto", price: "$", badge: "Street food", address: "Via dell'Ariento 75", hood: "San Lorenzo",
    extract: "A tripe stand at the San Lorenzo market run by Beatrice, Florence's only woman tripaia.", order: "A lampredotto sandwich with green sauce and a dip of the broth.", sources: [LP] },
  { id: "fi:xinge", lat: 43.7788216, lon: 11.2411804, title: "Il Gusto di Xinge", tier: 4, kind: "Restaurant", cuisine: "Chinese", price: "$$", badge: "Michelin Guide", address: "Viale Belfiore 2", hood: "Santa Maria Novella",
    extract: "Chinese cooking with Italian and French training behind the station, with a devoted following and creative cocktails.", order: "Sheng jian bao with pork and Tuscan truffle, dim sum.", sources: [FCG, LP] },
];

// Photos are hand-picked and stored with the app: public/img/florence/,
// listed in photos.json as { "<place id>": [{ "file", "credit", "source", "license" }] }.
// The first photo of a place is its cover. Places without one get a free
// Wikimedia Commons photo taken near the address, or drawn art.
const here = path.dirname(fileURLToPath(import.meta.url));
const PHOTO_DIR = path.join(here, "public", "img", "florence");
let PHOTOS = {};
function loadPhotos() {
  try {
    PHOTOS = JSON.parse(fs.readFileSync(path.join(PHOTO_DIR, "photos.json"), "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") console.error("florence photos.json unreadable", err.message);
    PHOTOS = {};
  }
  // Only list files that are really there, so a typo shows art, not a broken image.
  for (const [id, list] of Object.entries(PHOTOS)) {
    PHOTOS[id] = (Array.isArray(list) ? list : []).filter((ph) => ph?.file && !ph.file.includes("..") && fs.existsSync(path.join(PHOTO_DIR, ph.file)));
  }
}
loadPhotos();

const commons = new Map(); // id -> { photo, tried }

export function initFlorence() {}

export function florenceStatus() {
  const withPhotos = CURATED.filter((c) => PHOTOS[c.id]?.length).map((c) => c.id);
  return {
    places: CURATED.length,
    curatedPhotos: withPhotos.length,
    commonsPhotos: CURATED.filter((c) => !PHOTOS[c.id]?.length && commons.get(c.id)?.photo).length,
    missing: CURATED.filter((c) => !PHOTOS[c.id]?.length && !commons.get(c.id)?.photo).map((c) => c.title),
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
    const r = { lat: c.lat, lon: c.lon };
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.title}, ${c.address}, Firenze`)}`;
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
      rating: null,
      ratingCount: null,
      price: c.price,
      openNow: null,
      address: `${c.address}, ${c.hood}`,
      website: c.website || null,
      mapsUrl,
      url: mapsUrl,
      ...photoFor(c.id),
      lat: r.lat,
      lon: r.lon,
      distance: Math.round(dist(lat, lon, r.lat, r.lon)),
      famous: c.tier === 1,
      curated: true,
      order_i: i,
    };
  });
  spots.sort(here ? (a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9) : (a, b) => a.order_i - b.order_i);
  return spots.map(({ order_i, ...s }) => s);
}

function photoFor(id) {
  const [ph] = PHOTOS[id] || [];
  if (ph) return { thumbnail: `/img/florence/${encodeURIComponent(ph.file)}`, photoCredit: ph.credit || null, photoSource: ph.source || null };
  return { thumbnail: commons.get(id)?.photo || null, photoCredit: null, photoSource: null };
}

// Places with no hand-picked photo borrow a Wikimedia Commons photo taken
// near the address; places.js fills this in.
export function setCommonsPhoto(id, url) {
  const e = commons.get(id) || {};
  if (url && !e.photo) commons.set(id, { ...e, photo: url });
}
export const needsCommonsPhoto = () => CURATED.filter((c) => !PHOTOS[c.id]?.length && !commons.get(c.id)?.photo && !commons.get(c.id)?.tried);
export function markPhotoTried(id) {
  commons.set(id, { ...(commons.get(id) || {}), tried: true });
}
export const resolvedCoords = (id) => { const c = CURATED.find((x) => x.id === id); return c ? { lat: c.lat, lon: c.lon } : null; };
