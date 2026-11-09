// TravelBuddy: a virtual tour guide.
// Express server that turns the user's coordinates into a guided rundown of the
// area (via OpenStreetMap + Wikipedia + Claude) and keeps a shared, location-based
// board of follow-up questions that other travelers nearby can read.

import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { openStore } from "./store.js";
import { describePlace, searchPlace } from "./places.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const EFFORT = process.env.CLAUDE_EFFORT || "low"; // narration is conversational; keep it snappy
const MOCK = process.env.MOCK === "1" || !hasClaudeCredentials();

function hasClaudeCredentials() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const client = MOCK ? null : new Anthropic();
const store = openStore(process.env.DB_PATH || path.join(here, "travelbuddy.db"));

// Bump when the story prompts change, so every area gets fresh cards.
const STORY_VERSION = "v1";
const STORY_TTL_DAYS = Number(process.env.STORY_TTL_DAYS || 0); // 0 = keep forever

const app = express();
// Which proxy's forwarded IP to trust: "loopback" for local tunnels (localtunnel,
// cloudflared); hosts like Render put one proxy in front, so they set TRUST_PROXY=1.
const TRUST_PROXY = process.env.TRUST_PROXY || "loopback";
app.set("trust proxy", /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);

// For the host's health check.
app.get("/healthz", (req, res) => res.json({ ok: true, mode: MOCK ? "demo" : "live", model: MODEL }));
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

const GUIDE_SYSTEM = `You are TravelBuddy, a warm, knowledgeable local tour guide speaking to a traveler who is standing at the location described below.
Speak directly to them ("you're standing in..."), like a great human guide: vivid, specific, and accurate.
Ground what you say in the supplied place and landmark notes. You may add well-established historical facts you are confident about, but never invent dates, names or events. If the notes are thin, say less rather than guess.
The traveler is reading on a phone while walking, so be brief and scannable: short sentences, plain words, **bold** only for landmark names. No preamble, no sign-off.`;

function locationContext(place) {
  const lines = [
    `Location: ${place.label}`,
    `Coordinates: ${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`,
  ];
  if (place.landmarks.length) {
    lines.push("", "Nearby landmarks (from Wikipedia, nearest first):");
    for (const l of place.landmarks) {
      lines.push(`- ${l.title} (${l.distance} m away): ${l.extract || "no summary available"}`);
    }
  } else {
    lines.push("", "No Wikipedia landmarks were found within walking distance.");
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
async function streamClaude({ system, prompt, send, maxTokens = 4000 }) {
  if (MOCK) return mockStream(prompt, send);

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { effort: EFFORT },
    // If a safety classifier declines, let the API re-run on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: prompt }],
  });

  let full = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      full += event.delta.text;
      send("text", { text: event.delta.text });
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    const msg = "Sorry, I can't help with that one.";
    send("text", { text: msg });
    return { text: msg, ok: false };
  }
  return { text: full, ok: final.stop_reason === "end_turn" && full.trim().length > 0 };
}

const MOCK_TEXT = {
  answer:
    "**(Demo mode) The old harbor wall is the oldest thing here, from around 1300.** With an API key set, I'll answer any question about where you are in a couple of quick sentences.",
  landmark: [
    "## 🏛️ Built to impress\nThis is a demo story about a single landmark. With an API key, you'll get three quick cards on its real history.",
    "## 🕰️ The turning point\nThe middle card tells the moment that made it famous: a fire, a king, a revolution.",
    "## 👀 Look for this\nThe last card points out one detail most visitors walk straight past.",
  ].join("\n\n"),
  tour: [
    "## 📍 You're in Old Harbor\nWelcome to the demo tour. This is a cobbled waterfront quarter where fishermen, merchants and painters have rubbed shoulders for seven centuries.",
    "## ⚓ A town built on herring\nIn the 1300s, the herring trade made this harbor rich. The tall, narrow houses you see were merchants' homes, taxed by the width of their fronts.",
    "## 🔥 The great fire of 1842\nA bakery fire swept the quarter one windy night. The town rebuilt in stone, which is why the streets feel so uniform today.",
    "## 🏛️ **Old Town Hall**\nIts clock tower was the first thing rebuilt after the fire, as a sign the town would recover. Council still meets under its painted ceiling.",
    "## ⭐ Don't miss\nWalk to the end of the harbor wall at sunset, when the whole waterfront turns gold. Set ANTHROPIC_API_KEY to hear the real story of wherever you are.",
  ].join("\n\n"),
};

async function mockStream(prompt, send) {
  return { text: await mockText(prompt, send), ok: true };
}

async function mockText(prompt, send) {
  const text = prompt.includes("QUESTION:") ? MOCK_TEXT.answer : prompt.includes("LANDMARK:") ? MOCK_TEXT.landmark : MOCK_TEXT.tour;
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
// A story is generated once per key (an area or a landmark), stored, and
// replayed to everyone after. If a second traveler asks while the first
// generation is still streaming, they join that stream instead of starting a
// new Claude call.
const inflight = new Map(); // key -> { text, subscribers:Set<send>, done:Promise }

async function serveStory(req, res, { key, kind, label, prompt, maxTokens }) {
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
    job.done = streamClaude({ system: GUIDE_SYSTEM, prompt, send: broadcast, maxTokens })
      .then((out) => {
        if (out.ok) store.putStory({ key, kind, label, text: out.text, model: MOCK ? "mock" : MODEL, hits: job.joiners });
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
  if (status === 403 || status === 404) return `The guide can't speak: this API key can't use the model "${MODEL}". Set CLAUDE_MODEL to a model your account has.`;
  if (status === 400 && /credit|billing|balance/i.test(err?.message || "")) return "The guide can't speak: the Anthropic account is out of credits.";
  if (status === 429) return "The guide is busy right now (rate limited). Try again in a minute.";
  return "The guide lost its voice for a moment. Please try again.";
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
      system: `You screen questions that travelers ask a tour-guide app before they are shown publicly to other travelers nearby.
Reply SHARE if the question is fine to show strangers, or HIDE if it contains personal information (names, phone numbers, addresses of private people), harassment, hate, sexual content, spam or advertising, or anything unrelated to travel that others would find offensive. Reply with that one word only.`,
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

// Place name + nearby landmarks (no LLM; fast, cached).
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

// The guided rundown of the area, shared by everyone in the same neighborhood.
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

Give me the rundown of this neighborhood as a set of swipeable story cards for my phone. Other travelers anywhere in this neighborhood will see the same cards, so describe the area as a whole rather than one exact street corner.
Write 5 to 7 cards. Each card starts on its own line with "## ", then one fitting emoji, then a title of at most 5 words. Under it, write 2 or 3 short sentences (at most 45 words in total).
Card order: first "where you are" (what this place is and its vibe), then 2 or 3 cards on how it came to be and key moments in its history, then 1 or 2 cards each on a famous nearby landmark and why it matters, and last a card titled "Don't miss" with one concrete thing to do or see here.
Output only the cards.`;
  await serveStory(req, res, { key: `tour:${STORY_VERSION}:${place.areaKey}`, kind: "tour", label: place.areaName || place.label, prompt });
});

// A three-card mini story about one landmark, shared by everyone who opens it.
app.get("/api/landmark-story", async (req, res) => {
  const c = parseCoords(req.query);
  const title = String(req.query.title || "").trim().slice(0, 200);
  if (!c || !title) return res.status(400).json({ error: "lat, lon and title are required" });
  let place;
  try {
    place = await describePlace(c.lat, c.lon);
  } catch (err) {
    console.error("landmark place lookup failed", err);
    return res.status(502).json({ error: "Could not look up this location right now." });
  }
  // Only stories about real Wikipedia landmarks near the traveler, so nobody can
  // make the guide write (and share) a story about something arbitrary.
  const lm = place.landmarks.find((l) => l.title === title);
  if (!lm) return res.status(404).json({ error: "That landmark isn't near here." });
  const prompt = `LANDMARK: ${title}
In or near: ${place.label}
Notes from Wikipedia: ${lm.extract || "none available"}

Tell me the story of this one landmark as exactly 3 swipeable story cards for my phone. Don't refer to how far away it is, since travelers will open this from different spots.
Each card starts on its own line with "## ", then one fitting emoji, then a title of at most 5 words. Under it, write 2 or 3 short sentences (at most 40 words in total).
Card 1: what it is and why people come. Card 2: the most dramatic moment in its history. Card 3: one detail to look for when you're there.
Output only the cards.`;
  await serveStory(req, res, { key: `landmark:${STORY_VERSION}:wp:${lm.pageid ?? title.toLowerCase()}`, kind: "landmark", label: title, prompt, maxTokens: 2000 });
});

// Ask a follow-up; the answer streams back and the Q&A is saved for travelers nearby.
app.post("/api/ask", async (req, res) => {
  const c = parseCoords(req.body || {});
  const question = String(req.body?.question || "").trim().slice(0, 500);
  const author = String(req.body?.author || "").trim().slice(0, 40) || "A traveler";
  const topic = String(req.body?.topic || "").trim().slice(0, 200) || null;
  if (!c || !question) return res.status(400).json({ error: "lat, lon and question are required" });
  if (!allow("ask", travelerId(req))) {
    return res.status(429).json({ error: "You've asked a lot this hour. Try again in a little while." });
  }

  const send = openSse(res);
  try {
    const place = await describePlace(c.lat, c.lon);
    const prompt = `${locationContext(place)}

The traveler asks a follow-up question about this area${topic ? `, specifically about ${topic}` : ""}.
QUESTION: ${question}

Answer as their guide for a phone screen: start with a one-sentence direct answer in **bold**, then at most 2 short sentences of color or a tip. Under 70 words total, no lists.`;
    const { text: answer } = await streamClaude({ system: GUIDE_SYSTEM, prompt, send, maxTokens: 2000 });
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

// Questions other travelers asked near here.
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
  console.log(`TravelBuddy running at http://localhost:${PORT}`);
  if (MOCK) console.log("Demo mode: set ANTHROPIC_API_KEY for real narration.");
});
