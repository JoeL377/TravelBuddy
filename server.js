// TravelBuddy: a pocket food guide.
// Express server that turns the user's coordinates into the food story of the
// neighborhood and its best nearby places to eat (via OpenStreetMap or Google
// Places + Wikipedia + Claude), and keeps a shared, location-based board of food
// questions that other people nearby can read.

import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { openStore } from "./store.js";
import { describePlace, searchPlace } from "./places.js";
import { googlePhotoUrl } from "./food.js";
import { initFlorence, FLORENCE_MODE } from "./florence.js";
import { initBudget, placesUsage } from "./budget.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
// Stories are written once and shown to everyone, so they get the stronger model.
// Follow-up answers are paid on every question, so they use a cheaper one.
const STORY_MODEL = process.env.CLAUDE_STORY_MODEL || process.env.CLAUDE_MODEL || "claude-opus-5-5";
const ANSWER_MODEL = process.env.CLAUDE_ANSWER_MODEL || "claude-sonnet-5-5";
const EFFORT = process.env.CLAUDE_EFFORT || "low"; // narration is conversational; keep it snappy
const MOCK = process.env.MOCK === "1" || !hasClaudeCredentials();

function hasClaudeCredentials() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const client = MOCK ? null : new Anthropic();
const store = openStore(process.env.DB_PATH || path.join(here, "travelbuddy.db"));
initBudget(store);
initFlorence(store, { classify: MOCK ? null : classifyPhoto });

// Bump when the story prompts change, so every area gets fresh cards.
const STORY_VERSION = "food1";
// Stories look things up on the web first (what a place is known for, what to
// order), since spot data alone rarely says. Set FOOD_WEB_SEARCH=0 to turn off.
const WEB_SEARCH = process.env.FOOD_WEB_SEARCH !== "0";
const STORY_TTL_DAYS = Number(process.env.STORY_TTL_DAYS || 0); // 0 = keep forever

const app = express();
// Which proxy's forwarded IP to trust: "loopback" for local tunnels (localtunnel,
// cloudflared); hosts like Render put one proxy in front, so they set TRUST_PROXY=1.
const TRUST_PROXY = process.env.TRUST_PROXY || "loopback";
app.set("trust proxy", /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);

// For the host's health check.
app.get("/healthz", (req, res) => res.json({ ok: true, mode: MOCK ? "demo" : "live", storyModel: STORY_MODEL, answerModel: ANSWER_MODEL, foodSource: process.env.GOOGLE_PLACES_API_KEY ? "google" : "osm", webSearch: WEB_SEARCH, placesCalls: placesUsage() }));
app.use(express.json({ limit: "32kb" }));

// --- Abuse limits ---------------------------------------------------------
// Every question and every new story is a paid Claude call, so cap them per
// traveler. In-memory sliding windows: fine for one server process.
const LIMITS = {
  ask: { max: Number(process.env.ASK_PER_HOUR || 20), windowMs: 3600_000 },
  generate: { max: Number(process.env.GENERATE_PER_HOUR || 15), windowMs: 3600_000 },
};
const hitsByKey = new Map();
function allow(kind, who) {
  const { max, windowMs } = LIMITS[kind];
  const now = Date.now();
  const key = `${kind}:${who}`;
  const recent = (hitsByKey.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hitsByKey.set(key, recent); return false; }
  recent.push(now);
  hitsByKey.set(key, recent);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of hitsByKey) if (!ts.some((t) => now - t < 3600_000)) hitsByKey.delete(k);
}, 600_000).unref();

// A stable, anonymous id per traveler (salted hash of their IP) for likes and limits.
const VOTER_SALT = store.persistentSecret("voter_salt", () => crypto.randomBytes(16).toString("hex"));
const travelerId = (req) => crypto.createHash("sha256").update(VOTER_SALT + req.ip).digest("hex").slice(0, 32);
app.use(express.static(path.join(here, "public")));

const GUIDE_SYSTEM = `You are TravelBuddy, a warm, well-fed local food guide talking to someone standing at the location described below.
Speak directly to them, like a friend who knows every kitchen in town: vivid, specific, and accurate. Talk about food: what this place eats and why, the dishes, the people and history behind them, and where to go.
Ground what you say in the supplied place and spot notes and in anything you look up. Never invent a dish, a menu item, a price, an opening hour, a date or a person. If you aren't sure what a specific spot serves, talk about its cuisine in general terms rather than guess. If the notes are thin, say less.
They're reading on a phone, probably hungry, so be brief and scannable: short sentences, plain words, **bold** only for the names of places to eat. No preamble, no sign-off.`;

function spotLine(l) {
  const away = l.distance == null ? "" : l.distance < 1000 ? `${l.distance} m away` : `${(l.distance / 1000).toFixed(1)} km away`;
  const facts = [
    l.kind,
    l.cuisine,
    l.rating != null ? `rated ${l.rating} from ${l.ratingCount ?? "some"} reviews` : null,
    l.price,
    l.badge || null,
    l.famous && !l.curated ? "has its own Wikipedia article" : null,
    l.address,
    away,
  ].filter(Boolean).join(", ");
  const order = l.order ? ` Known for: ${l.order}` : "";
  const src = l.sources?.length ? ` (Sources: ${l.sources.map((x) => x.name).join(", ")})` : "";
  return `- ${l.title} (${facts})${l.extract ? `: ${l.extract}` : ""}${order}${src}`;
}

function locationContext(place) {
  const lines = [
    `Location: ${place.label}`,
    `Coordinates: ${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`,
  ];
  if (place.spots.length) {
    lines.push("", place.source === "florence"
      ? `The hand-picked list of Florence's best places to eat (from the Michelin Guide, Gambero Rosso and Lonely Planet)${place.centered ? "; the reader is not in Florence right now, they're exploring it from afar" : ", nearest to the reader first"}:`
      : `Places to eat within about 1.5 km (from ${place.source === "google" ? "Google Maps" : "OpenStreetMap"}; best and most notable first, chains pushed down):`);
    for (const l of place.spots) lines.push(spotLine(l));
  } else {
    lines.push("", "No places to eat were found in the map data within 1.5 km.");
  }
  return lines.join("\n");
}

// --- Server-sent events helpers -------------------------------------------
function openSse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  return (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Streams Claude's answer as `text` events and resolves with the full text.
// With `search`, Claude may look things up on the web first.
async function streamClaude({ model, system, prompt, send, maxTokens = 4000, search = 0 }) {
  if (MOCK) return mockStream(prompt, send);

  const messages = [{ role: "user", content: prompt }];
  const tools = search ? [{ type: "web_search_20260209", name: "web_search", max_uses: search }] : undefined;
  let full = "";
  let final;
  // A long search turn can pause; resume it (a few times at most) to get the answer.
  for (let round = 0; round < 3; round++) {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: maxTokens,
      output_config: { effort: EFFORT },
      // If a safety classifier declines, let the API re-run on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages,
      ...(tools ? { tools } : {}),
    });
    let lastBlock = null;
    for await (const event of stream) {
      if (event.type === "content_block_start") {
        // Text that resumes after a web search starts a new block; make sure a
        // card heading still lands on its own line.
        if (event.content_block.type === "text" && lastBlock && lastBlock !== "text" && full && !full.endsWith("\n")) {
          full += "\n\n";
          send("text", { text: "\n\n" });
        }
        lastBlock = event.content_block.type;
      }
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        full += event.delta.text;
        send("text", { text: event.delta.text });
      }
    }
    final = await stream.finalMessage();
    if (final.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: final.content });
  }
  if (final.stop_reason === "refusal") {
    const msg = "Sorry, I can't help with that one.";
    send("text", { text: msg });
    return { text: msg, ok: false };
  }
  return { text: full, ok: final.stop_reason === "end_turn" && full.trim().length > 0 };
}

// Story cards start at the first "## " heading; drop any lead-in Claude wrote
// before it (e.g. while searching).
const cardsOnly = (text) => {
  const i = text.search(/^## /m);
  return i === -1 ? text : text.slice(i);
};

const MOCK_TEXT = {
  answer:
    "**(Demo mode) Locals queue at Harbor Noodle House for the shoyu ramen.** With an API key set, I'll answer any food question about where you are in a couple of quick sentences.",
  spot: [
    "## 🍜 Why people come\nThis is a demo story about a single spot. With an API key, you'll get three quick cards on what it is and why it's loved.",
    "## 🥢 What to order\nThe middle card tells you the dish regulars come back for.",
    "## 💡 Good to know\nThe last card is a tip: when to go, how to order, or what most people miss.",
  ].join("\n\n"),
  tour: [
    "## 📍 You're in Old Harbor\nWelcome to the demo food story. This waterfront quarter has fed sailors, merchants and painters for seven centuries.",
    "## 🐟 A town built on herring\nIn the 1300s the herring trade made this harbor rich, and pickled herring is still sold from carts by the water.",
    "## 🍜 The ramen wave\nJapanese crews docking here in the 1970s left behind a taste for noodles. Now **Harbor Noodle House** has a queue before it opens.",
    "## 🧺 Under one roof\n**Old Market Hall** has been feeding the quarter since 1889. Go hungry and graze from stall to stall.",
    "## ⭐ Don't miss\nA scoop from **Gelato Lighthouse** at the end of the pier at sunset. Set ANTHROPIC_API_KEY to hear the real food story of wherever you are.",
  ].join("\n\n"),
};

async function mockStream(prompt, send) {
  return { text: await mockText(prompt, send), ok: true };
}

async function mockText(prompt, send) {
  const text = prompt.includes("QUESTION:") ? MOCK_TEXT.answer : prompt.includes("SPOT:") ? MOCK_TEXT.spot : MOCK_TEXT.tour;
  let out = "";
  for (const word of text.split(/(?<= )/)) {
    out += word;
    send("text", { text: word });
    await new Promise((r) => setTimeout(r, 18));
  }
  return out;
}

function parseCoords(src) {
  const lat = Number(src.lat);
  const lon = Number(src.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null;
  }
  return { lat, lon };
}

// --- Shared story cards ---------------------------------------------------
// A story is generated once per key (an area or a spot), stored, and
// replayed to everyone after. If a second traveler asks while the first
// generation is still streaming, they join that stream instead of starting a
// new Claude call.
const inflight = new Map(); // key -> { text, subscribers:Set<send>, done:Promise }

async function serveStory(req, res, { key, kind, label, prompt, maxTokens = 8000, search = 0 }) {
  const send = openSse(res);
  const cached = store.getStory(key, STORY_TTL_DAYS);
  if (cached) {
    const hits = store.countHit(key);
    send("meta", { cached: true, hits, createdAt: cached.createdAt, demo: MOCK });
    send("text", { text: cached.text });
    send("done", {});
    return res.end();
  }

  let job = inflight.get(key);
  if (!job && !allow("generate", travelerId(req))) {
    send("error", { message: "You've explored a lot this hour. Try again in a little while." });
    return res.end();
  }
  if (job) {
    job.joiners++;
    send("meta", { cached: false, joined: true, hits: job.joiners, demo: MOCK });
    if (job.text) send("text", { text: job.text });
    job.subscribers.add(send);
  } else {
    console.log(`generating ${kind} story for ${key}`);
    send("meta", { cached: false, hits: 1, demo: MOCK });
    // Subscribe before generation starts so no early chunk is missed.
    job = { text: "", subscribers: new Set([send]), joiners: 1 };
    inflight.set(key, job);
    const broadcast = (event, data) => {
      if (event === "text") job.text += data.text;
      for (const s of job.subscribers) s(event, data);
    };
    job.done = streamClaude({ model: STORY_MODEL, system: GUIDE_SYSTEM, prompt, send: broadcast, maxTokens, search: WEB_SEARCH ? search : 0 })
      .then((out) => {
        if (out.ok) store.putStory({ key, kind, label, text: cardsOnly(out.text), model: MOCK ? "mock" : STORY_MODEL, hits: job.joiners });
        return out.ok;
      })
      .finally(() => inflight.delete(key));
  }
  res.on("close", () => job.subscribers.delete(send));
  try {
    await job.done;
    send("done", {});
  } catch (err) {
    console.error(`${kind} story failed`, err);
    send("error", { message: friendlyError(err) });
  }
  job.subscribers.delete(send);
  res.end();
}

// Turns an API failure into something the app owner can act on.
function friendlyError(err) {
  const status = err?.status;
  if (status === 401) return "The guide can't speak: the server's Anthropic API key is invalid. Check ANTHROPIC_API_KEY in your host's settings.";
  if (status === 403 || status === 404) return `The guide can't speak: this API key can't use one of the models (${STORY_MODEL}, ${ANSWER_MODEL}). Set CLAUDE_STORY_MODEL / CLAUDE_ANSWER_MODEL to models your account has.`;
  if (status === 400 && /credit|billing|balance/i.test(err?.message || "")) return "The guide can't speak: the Anthropic account is out of credits.";
  if (status === 429) return "The guide is busy right now (rate limited). Try again in a minute.";
  return "The guide lost its voice for a moment. Please try again.";
}

// --- Food photo check ----------------------------------------------------
// Decides whether a restaurant photo shows a dish (what a food guide should
// lead with) or the room, the front door, people or a menu. Small and cheap.
const PHOTO_MODEL = process.env.PHOTO_MODEL || "claude-haiku-5-5";
const PHOTO_KINDS = ["DISH", "FOOD", "DRINK", "PLACE", "PEOPLE", "MENU", "OTHER"];

async function classifyPhoto(url, title) {
  try {
    const img = await fetch(url);
    if (!img.ok) throw new Error(`${img.status} fetching photo`);
    const type = (img.headers.get("content-type") || "image/jpeg").split(";")[0];
    const data = Buffer.from(await img.arrayBuffer()).toString("base64");
    const msg = await client.messages.create({
      model: PHOTO_MODEL,
      max_tokens: 1000,
      output_config: { effort: "low" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: type, data } },
          { type: "text", text: `This photo is from the Google Maps listing of ${title}, a restaurant in Florence. We want to show a photo of the food.
Reply with one word:
DISH if a plate or bowl of food is the main subject, close and appetizing;
FOOD if food is visible but small, far away or not the main subject;
DRINK if a drink or wine is the main subject;
PLACE if it mostly shows the dining room, building, terrace, kitchen or view;
PEOPLE if people are the main subject;
MENU if it shows a menu, sign or text;
OTHER otherwise.` },
        ],
      }],
    });
    const word = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim().toUpperCase().match(/[A-Z]+/)?.[0];
    return PHOTO_KINDS.includes(word) ? word : "OTHER";
  } catch (err) {
    console.error("photo check failed", title, err.message);
    return null; // try again later rather than writing the photo off
  }
}

// --- Moderation -----------------------------------------------------------
// Questions are shown to strangers nearby, so a small, cheap model checks each
// one first. Anything it flags (or can't judge) is kept private to the asker.
const MODERATION_MODEL = process.env.MODERATION_MODEL || "claude-haiku-5-5";

async function isFitToShare(question) {
  if (MOCK) return true;
  try {
    const msg = await client.messages.create({
      model: MODERATION_MODEL,
      max_tokens: 1000,
      output_config: { effort: "low" },
      system: `You screen questions that people ask a local food-guide app before they are shown publicly to other people nearby.
Reply SHARE if the question is fine to show strangers, or HIDE if it contains personal information (names, phone numbers, addresses of private people), harassment, hate, sexual content, spam or advertising (including a business promoting itself or attacking a competitor), or anything others would find offensive. Reply with that one word only.`,
      messages: [{ role: "user", content: `Question: ${question}` }],
    });
    if (msg.stop_reason === "refusal") return false;
    const verdict = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim().toUpperCase();
    return verdict.startsWith("SHARE");
  } catch (err) {
    console.error("moderation check failed; keeping question private", err);
    return false;
  }
}

// --- Routes ---------------------------------------------------------------

// Place name + nearby places to eat (no LLM; fast, cached).
app.get("/api/place", async (req, res) => {
  const c = parseCoords(req.query);
  if (!c) return res.status(400).json({ error: "lat and lon are required" });
  try {
    res.json(await describePlace(c.lat, c.lon));
  } catch (err) {
    console.error("place lookup failed", err);
    res.status(502).json({ error: "Could not look up this location right now." });
  }
});

// Look up a place by name.
app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 200);
  if (!q) return res.status(400).json({ error: "q is required" });
  try {
    const hit = await searchPlace(q);
    if (!hit) return res.status(404).json({ error: "No place found by that name." });
    res.json(hit);
  } catch (err) {
    console.error("search failed", err);
    res.status(502).json({ error: "Search is unavailable right now." });
  }
});

// The food story of the neighborhood, shared by everyone in it.
app.get("/api/tour", async (req, res) => {
  const c = parseCoords(req.query);
  if (!c) return res.status(400).json({ error: "lat and lon are required" });
  let place;
  try {
    place = await describePlace(c.lat, c.lon);
  } catch (err) {
    console.error("tour place lookup failed", err);
    return res.status(502).json({ error: "Could not look up this location right now." });
  }
  const prompt = `${locationContext(place)}
${place.areaName ? `\nNeighborhood: ${place.areaName}` : ""}

${place.source === "florence" && place.areaKey === "city:florence"
  ? "Tell me the food story of Florence as a set of swipeable story cards for my phone: what Florentines eat and why (bistecca, lampredotto, ribollita and friends), the history behind it, and where on this list to taste it."
  : "Tell me the food story of this neighborhood as a set of swipeable story cards for my phone. Other people anywhere in this neighborhood will see the same cards, so describe the area as a whole rather than one street corner."}
${WEB_SEARCH ? "First, if it helps, search the web for what this neighborhood and town are known for eating and for the stories behind the notable spots above. Then write the cards.\n" : ""}Write 5 to 7 cards. Each card starts on its own line with "## ", then one fitting emoji, then a title of at most 5 words. Under it, write 2 or 3 short sentences (at most 45 words in total).
Card order: first "what's cooking here" (the food identity of this place in a nutshell), then 2 cards on how it came to eat this way (the communities, history or local produce behind its signature dishes), then 1 or 2 cards each on a standout spot from the list and what to get there, and last a card titled "Don't miss" with the one bite to try here and where.
Only recommend spots from the list above. Output only the cards, with nothing before the first card.`;
  await serveStory(req, res, { key: `tour:${STORY_VERSION}:${place.areaKey}`, kind: "tour", label: place.areaName || place.label, prompt, search: 4 });
});

// A three-card mini story about one place to eat, shared by everyone who opens it.
app.get("/api/spot-story", async (req, res) => {
  const c = parseCoords(req.query);
  const id = String(req.query.id || "").trim().slice(0, 300);
  if (!c || !id) return res.status(400).json({ error: "lat, lon and id are required" });
  let place;
  try {
    place = await describePlace(c.lat, c.lon);
  } catch (err) {
    console.error("spot place lookup failed", err);
    return res.status(502).json({ error: "Could not look up this location right now." });
  }
  // Only stories about real spots near the person, so nobody can make the guide
  // write (and share) a story about something arbitrary.
  const spot = place.spots.find((l) => l.id === id);
  if (!spot) return res.status(404).json({ error: "That place isn't near here." });
  const prompt = `SPOT: ${spot.title}
In or near: ${place.label}
What we know:
${spotLine({ ...spot, distance: null })}${spot.website ? `\nWebsite: ${spot.website}` : ""}

Tell me about this one place to eat as exactly 3 swipeable story cards for my phone. Don't refer to how far away it is, since people will open this from different spots.
${WEB_SEARCH ? `First, search the web for ${spot.title} in ${place.area || place.label} to learn what it's known for and what people order. If you can't find it, or aren't sure a result is this exact place, stick to what we know above and talk about its kind of food in general.\n` : ""}Each card starts on its own line with "## ", then one fitting emoji, then a title of at most 5 words. Under it, write 2 or 3 short sentences (at most 40 words in total).
Card 1: what it is and why people come (its story, if it has one). Card 2: what to order. Card 3: one tip (when to go, how to order, or what most people miss).
Never make up a dish, price or opening hour. Output only the cards, with nothing before the first card.`;
  await serveStory(req, res, { key: `spot:${STORY_VERSION}:${spot.id}`, kind: "spot", label: spot.title, prompt, search: 3 });
});

// Ask a follow-up; the answer streams back and the Q&A is saved for travelers nearby.
app.post("/api/ask", async (req, res) => {
  const c = parseCoords(req.body || {});
  const question = String(req.body?.question || "").trim().slice(0, 500);
  const author = String(req.body?.author || "").trim().slice(0, 40) || "A local";
  const topic = String(req.body?.topic || "").trim().slice(0, 200) || null;
  if (!c || !question) return res.status(400).json({ error: "lat, lon and question are required" });
  if (!allow("ask", travelerId(req))) {
    return res.status(429).json({ error: "You've asked a lot this hour. Try again in a little while." });
  }

  const send = openSse(res);
  try {
    const place = await describePlace(c.lat, c.lon);
    const prompt = `${locationContext(place)}

They ask a food question about this area${topic ? `, specifically about ${topic}` : ""}.
QUESTION: ${question}

Answer as their food guide for a phone screen: start with a one-sentence direct answer in **bold**, then at most 2 short sentences of color or a tip. When you point them somewhere, prefer the spots listed above. If they ask about something you can't know from here, like today's hours or a current menu, say so and suggest checking the spot's page. If the question isn't about food or drink, answer briefly and steer back to what's good to eat nearby. Under 70 words total, no lists.`;
    const { text: answer } = await streamClaude({ model: ANSWER_MODEL, system: GUIDE_SYSTEM, prompt, send, maxTokens: 2000 });
    const hidden = !(await isFitToShare(question));
    const saved = store.addQuestion({ ...c, placeLabel: place.label, author, question, answer, topic, hidden });
    send("saved", saved);
    send("done", {});
  } catch (err) {
    console.error("ask failed", err);
    send("error", { message: friendlyError(err) });
  }
  res.end();
});

// Photos of Google Places spots, without exposing the API key to the browser.
app.get("/api/food-photo", async (req, res) => {
  try {
    const url = await googlePhotoUrl(String(req.query.ref || ""));
    if (!url) return res.status(404).end();
    res.set("Cache-Control", "public, max-age=43200");
    res.redirect(302, url);
  } catch (err) {
    console.error("food photo failed", err.message);
    res.status(502).end();
  }
});

// Food questions other people asked near here.
app.get("/api/questions", (req, res) => {
  const c = parseCoords(req.query);
  if (!c) return res.status(400).json({ error: "lat and lon are required" });
  const radius = Math.min(Number(req.query.radius) || 1500, 20000);
  res.json(store.nearbyQuestions(c.lat, c.lon, radius));
});

app.post("/api/questions/:id/upvote", (req, res) => {
  const row = store.upvote(Number(req.params.id), travelerId(req));
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(row);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TravelBuddy (food guide) running at http://localhost:${PORT}`);
  if (MOCK) console.log("Demo mode: set ANTHROPIC_API_KEY for real narration.");
});
