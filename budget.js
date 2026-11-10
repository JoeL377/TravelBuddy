// A hard daily cap on paid Google Places calls, so a bug, a bot or a busy day
// can't run up the bill. Every Google request (search, details, photo) asks
// first; once today's allowance is spent the app quietly falls back to the free
// data (OpenStreetMap, Wikimedia, drawn placeholders) until midnight UTC.
// The count is saved, so a restart doesn't reset it.

const DAILY_LIMIT = Number(process.env.PLACES_DAILY_LIMIT ?? 100);

let store = null;
let day = "";
let used = 0;
let warned = false;

export function initBudget(s) {
  store = s;
  load();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function load() {
  day = today();
  used = Number(store?.getValue(`places-calls:${day}`) || 0);
  warned = false;
}

// Returns true (and counts the call) if a Google Places call is allowed now.
export function spendPlacesCall(kind) {
  if (day !== today()) load();
  if (used >= DAILY_LIMIT) {
    if (!warned) {
      warned = true;
      console.warn(`Google Places daily limit reached (${DAILY_LIMIT}); using free data until midnight UTC. Last call kind: ${kind}`);
    }
    return false;
  }
  used++;
  store?.setValue(`places-calls:${day}`, String(used));
  return true;
}

export function placesUsage() {
  if (day !== today()) load();
  return { day, used, limit: DAILY_LIMIT };
}
