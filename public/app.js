import { art } from "./art.js";

const $ = (id) => document.getElementById(id);
const S = {
  here: null,        // { lat, lon }
  place: null,       // { label, spots[] }
  questions: [],
  stories: new Map(), // key -> { cards, done }
  tab: "explore",
};

// ---------- small utilities ----------
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
const prose = (s) => s.trim().split(/\n{2,}/).filter(Boolean).map((p) => `<p>${inline(p).replace(/\n/g, " ")}</p>`).join("");
const plain = (s) => s.replace(/\*\*/g, "");
const icon = (name, cls = "") => `<svg class="icon ${cls}"><use href="#i-${name}"/></svg>`;
const dist = (m) => (m == null ? "" : m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const walk = (m) => (m == null ? "" : `${Math.max(1, Math.round(m / 80))} min walk`);
const ago = (iso) => {
  const s = (Date.now() - new Date(iso.replace(" ", "T") + "Z").getTime()) / 1000;
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};
const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const initials = (name) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const photo = (l) => l?.thumbnail || art(l?.title || "TravelBuddy");
// "Restaurant · Ramen", "Bakery"
const spotKind = (l) => [l.kind, l.cuisine].filter(Boolean).join(" · ") || l.description || "";
const openLabel = (l) => (l.openNow === true ? "Open now" : l.openNow === false ? "Closed now" : "");
const count = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

function local(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(val));
  } catch { return null; }
}
const saved = () => local("tb-saved-food") || [];
const isSaved = (title) => saved().some((l) => l.title === title);
const seen = () => new Set(local("tb-seen") || []);
const voted = () => new Set(local("tb-voted") || []);

let toastTimer;
function toast(msg) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2600);
}

// Reads a server-sent-events response body, calling onEvent(name, data).
async function readSse(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event: (.*)$/m.exec(chunk)?.[1] || "message";
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      onEvent(event, data ? JSON.parse(data) : {});
    }
  }
}

// "## 🏛️ Title\nbody\n\n## ..." -> [{ emoji, title, body }]
function parseCards(text) {
  return text.split(/^## /m).map((s) => s.trim()).filter(Boolean).map((chunk) => {
    const [head, ...body] = chunk.split("\n");
    const m = /^(\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*)\s*(.*)$/u.exec(head.trim());
    return { emoji: m ? m[1] : "✨", title: plain(m ? m[2] : head).trim(), body: body.join("\n").trim() };
  });
}

// ---------- navigation ----------
const root = document.documentElement;
const tabScroll = {}; // each tab remembers how far down you were

// top: true starts the tab at the top (a new place, a new question) instead of where you left it.
function showTab(name, { top = false } = {}) {
  if (name !== S.tab) tabScroll[S.tab] = window.scrollY;
  S.tab = name;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  for (const v of ["explore", "ask", "saved"]) $(`view-${v}`).hidden = v !== name;
  $("composer").hidden = name !== "ask";
  root.classList.toggle("on-ask", name === "ask");
  if (name === "ask") $("qaBadge").hidden = true;
  if (name === "saved") renderSaved();
  window.scrollTo(0, top ? 0 : tabScroll[name] || 0);
}
const toTop = () => window.scrollTo({ top: 0, behavior: "smooth" });
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  // Tapping the tab you're already on scrolls back to the top, like a native app.
  if (t.dataset.tab === S.tab) toTop();
  else showTab(t.dataset.tab);
}));
document.querySelectorAll(".topbar").forEach((t) => t.addEventListener("click", (e) => { if (!e.target.closest("button")) toTop(); }));
addEventListener("scroll", () => root.classList.toggle("scrolled", window.scrollY > 4), { passive: true });
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
// iOS only shows :active press states when a touch listener exists.
document.addEventListener("touchstart", () => {}, { passive: true });

// Photos fade in when loaded; a photo that fails to load falls back to generated art.
document.addEventListener("load", (e) => { if (e.target.tagName === "IMG") e.target.classList.add("ld"); }, true);
document.addEventListener("error", (e) => {
  const img = e.target;
  if (img.tagName !== "IMG" || img.dataset.fallback) return;
  img.dataset.fallback = "1";
  img.src = art(img.dataset.title || "TravelBuddy");
}, true);

// Keyboard: hide the tab bar while typing and keep inputs just above the keyboard.
const vv = window.visualViewport;
function syncKeyboard() {
  const kb = vv && vv.scale <= 1.01 ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  root.style.setProperty("--kb", kb > 60 ? `${Math.round(kb)}px` : "0px");
}
vv?.addEventListener("resize", syncKeyboard);
vv?.addEventListener("scroll", syncKeyboard);
let typingTimer;
document.addEventListener("focusin", (e) => {
  if (!e.target.matches("input, textarea")) return;
  clearTimeout(typingTimer);
  root.classList.add("typing");
  syncKeyboard();
});
// Wait a beat so a tap on Send lands before the layout moves back.
document.addEventListener("focusout", () => {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => { if (!document.activeElement?.matches("input, textarea")) root.classList.remove("typing"); }, 120);
});
document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-goto]");
  if (go) showTab(go.dataset.goto, { top: true });
  if (e.target.closest("[data-open-search]") && !e.target.closest("#hereBtn")) openSearch();
});

// Full-screen layers (story, landmark, search) each get a history entry, so the phone's
// back button or back swipe closes the layer instead of leaving the app.
const layers = [];
let ownBacks = 0;      // history.back() calls we made ourselves and are waiting on
let pendingUrl = null; // URL change waiting for those to finish

function openLayer(el) {
  clearTimeout(el._leave);
  el.classList.remove("leave", "dragging", "settle");
  el.style.transform = el.style.opacity = "";
  el.hidden = false;
  el.classList.remove("enter");
  void el.offsetWidth;
  el.classList.add("enter");
  document.body.style.overflow = "hidden";
  if (!layers.includes(el)) {
    layers.push(el);
    history.pushState({ layer: el.id }, "");
  }
}
function hideLayer(el, instant) {
  const done = () => {
    el.hidden = true;
    el.classList.remove("leave", "dragging", "settle");
    el.style.transform = el.style.opacity = "";
  };
  clearTimeout(el._leave);
  if (instant) done();
  else {
    el.classList.remove("enter", "dragging", "settle");
    el.classList.add("leave");
    el._leave = setTimeout(done, 200);
  }
  if (!layers.length) document.body.style.overflow = "";
}
function closeLayer(el, { fromBack = false, instant = false } = {}) {
  const i = layers.indexOf(el);
  if (i === -1) return;
  layers.splice(i, 1);
  hideLayer(el, instant);
  if (!fromBack) { ownBacks++; history.back(); }
}
function closeAllLayers() {
  const n = layers.length;
  if (!n) return;
  for (const el of layers.splice(0)) hideLayer(el, true);
  ownBacks++;
  history.go(-n);
}
addEventListener("popstate", () => {
  if (ownBacks) {
    ownBacks--;
    if (!ownBacks && pendingUrl) { history.replaceState(null, "", pendingUrl); pendingUrl = null; }
    return;
  }
  const top = layers.at(-1);
  if (!top) return;
  if (top.id === "story") closeStory({ fromBack: true });
  else closeLayer(top, { fromBack: true });
});
function setUrl(url) {
  if (ownBacks) pendingUrl = url;
  else history.replaceState(null, "", url);
}

// ---------- location & search ----------
function locate() {
  $("startError").hidden = true;
  if (!navigator.geolocation) return startError("Location isn't available here. Search for a place instead.");
  $("locateBtn").disabled = true;
  $("locateBtn").querySelector("span").textContent = "Finding you…";
  $("hereBtn").classList.add("busy");
  navigator.geolocation.getCurrentPosition(
    (pos) => { $("hereBtn").classList.remove("busy"); go(pos.coords.latitude, pos.coords.longitude, { gps: true }); },
    () => startError("I couldn't get your location. Allow location access, or search for a place."),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
}
function startError(msg) {
  $("hereBtn").classList.remove("busy");
  closeLayer($("search"));
  if (!$("app").hidden) return toast(msg);
  $("locateBtn").disabled = false;
  $("locateBtn").querySelector("span").textContent = "Find food near me";
  $("startError").textContent = msg;
  $("startError").hidden = false;
}

const IDEAS = ["Duomo, Florence", "Santa Croce, Florence", "San Lorenzo, Florence", "Santo Spirito, Florence", "San Frediano, Florence"];
function openSearch() {
  const recents = local("tb-recents") || [];
  const opt = (q, ic) => `<button class="opt" data-q="${esc(q)}"><span class="ic">${icon(ic)}</span><span><div class="t">${esc(q.split(",")[0])}</div><div class="s">${esc(q.split(",").slice(1).join(",").trim())}</div></span></button>`;
  $("recents").innerHTML = recents.length ? `<h4>Recent</h4>${recents.map((q) => opt(q, "clock")).join("")}` : "";
  $("ideas").innerHTML = IDEAS.map((q) => opt(q, "pin")).join("");
  openLayer($("search"));
  setTimeout(() => $("searchInput").focus(), 50);
}
$("search").addEventListener("click", (e) => {
  if (e.target.closest("[data-close-search]")) return closeLayer($("search"));
  const q = e.target.closest("[data-q]")?.dataset.q;
  if (q) searchAndGo(q);
});
$("searchHere").addEventListener("click", () => { closeLayer($("search")); locate(); });
$("searchForm").addEventListener("submit", (e) => { e.preventDefault(); searchAndGo($("searchInput").value); });
$("hereBtn").addEventListener("click", (e) => { e.stopPropagation(); locate(); });

async function searchAndGo(q) {
  q = q.trim();
  if (!q || $("search").classList.contains("busy")) return;
  $("search").classList.add("busy");
  $("searchInput").blur();
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const hit = await res.json();
    if (!res.ok) throw new Error(hit.error);
    local("tb-recents", [q, ...(local("tb-recents") || []).filter((x) => x !== q)].slice(0, 4));
    $("searchInput").value = "";
    closeLayer($("search"));
    go(hit.lat, hit.lon);
  } catch (err) {
    toast(err.message || "Couldn't find that place.");
  } finally {
    $("search").classList.remove("busy");
  }
}

// ---------- explore ----------
function go(lat, lon, { gps = false } = {}) {
  S.here = { lat, lon };
  S.gps = gps;
  S.place = null;
  S.stories.clear();
  $("welcome").hidden = true;
  $("app").hidden = false;
  closeAllLayers();
  setUrl(`?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`);
  showTab("explore", { top: true });
  for (const k in tabScroll) delete tabScroll[k];
  renderExploreSkeleton();
  loadPlace();
  loadQuestions();
}

function renderExploreSkeleton() {
  $("pillTitle").textContent = "Finding you…";
  $("pillSub").textContent = "Looking for good food nearby";
  $("storiesRow").innerHTML = Array.from({ length: 5 }, () => `<div class="story-bubble"><div class="sk" style="width:70px;height:70px;border-radius:50%"></div><div class="sk" style="width:48px;height:10px"></div></div>`).join("");
  $("heroWrap").innerHTML = `<div class="hero"><div class="photo sk"></div></div>`;
  $("guide").classList.remove("open");
  $("guide").innerHTML = guideGhosts();
  $("rail").innerHTML = Array.from({ length: 2 }, () => `<div class="listing"><div class="photo sk"></div><div class="sk" style="height:14px;width:70%;margin-top:12px"></div><div class="sk" style="height:12px;width:40%;margin-top:8px"></div></div>`).join("");
  $("lmCount").textContent = "";
}

async function loadPlace() {
  try {
    const res = await fetch(`/api/place?lat=${S.here.lat}&lon=${S.here.lon}`);
    const place = await res.json();
    if (!res.ok) throw new Error(place.error);
    S.place = place;
    // Florence mode: when you're not in Florence, the guide starts you at the Duomo.
    if (place.centered && (place.lat !== S.here.lat || place.lon !== S.here.lon)) {
      S.here = { lat: place.lat, lon: place.lon };
      S.gps = false;
      loadQuestions();
      if (!S.toldCentered) { S.toldCentered = true; toast("You're not in Florence yet, so here's the city from the Duomo."); }
    }
    $("rail").closest(".section").querySelector("h2").textContent = place.source === "florence" ? "Florence's best tables" : "Where to eat nearby";
    renderExplore();
    renderChips();
    prefetchTour();
  } catch {
    S.place = { label: "Somewhere tasty", spots: [] };
    renderExplore();
    toast("Couldn't load places to eat right now.");
  }
}

function placeParts() {
  const [first, ...rest] = (S.place?.label || "").split(", ");
  return { name: first || "Here", region: rest.slice(0, 2).join(", ") };
}

function renderExplore() {
  const { name, region } = placeParts();
  const lms = S.place.spots;
  $("pillTitle").textContent = name;
  $("pillSub").textContent = [region, lms.length ? `${lms.length} places to eat` : ""].filter(Boolean).join(" · ");
  $("askSub").textContent = `Food questions from people near ${name}`;

  const seenSet = seen();
  const heroImg = S.place.areaImage || lms.find((l) => l.thumbnail)?.thumbnail || art(name);
  $("storiesRow").innerHTML = [
    `<button class="story-bubble" data-story="tour"><div class="ring ${seenSet.has(tourKey()) ? "seen" : ""}" data-key="${esc(tourKey())}"><img src="${esc(heroImg)}" data-title="${esc(name)}" alt=""></div><div class="lbl"><b>Food story</b></div></button>`,
    ...lms.map((l, i) => `<button class="story-bubble" data-story="lm" data-i="${i}"><div class="ring ${seenSet.has(lmKey(l)) ? "seen" : ""}" data-key="${esc(lmKey(l))}"><img src="${esc(photo(l))}" data-title="${esc(l.title)}" alt=""></div><div class="lbl">${esc(l.title)}</div></button>`),
  ].join("");
  $("storiesRow").classList.add("stagger");

  $("heroWrap").innerHTML = `<button class="hero" data-story="tour" aria-label="Play the food story of ${esc(name)}">
    <div class="photo"><img src="${esc(heroImg)}" data-title="${esc(name)}" alt="">
      <span class="badge"><span class="dot"></span>Food story</span>
      <div class="over"><div class="k">What ${esc(name)} eats</div><div class="t">${esc(name)}</div>
        <div class="play"><span class="pc">${icon("play", "sm")}</span>Watch the food story · 2 min</div></div>
    </div></button>`;

  const far = Math.max(0, ...lms.map((l) => l.distance || 0));
  $("lmCount").textContent = !lms.length ? "" : S.place.source === "florence" ? `${lms.length} hand-picked${S.place.centered ? "" : ", nearest first"}` : `${lms.length} within ${far < 1000 ? "1 km" : `${Math.ceil(far / 1000)} km`}`;
  $("rail").innerHTML = lms.length
    ? lms.map((l, i) => listingCard(l, i)).join("")
    : `<div class="empty" style="padding:24px 0;width:100%"><div class="big">Slim pickings</div>No places to eat on the map right around here. Ask the guide where to go.</div>`;
  $("rail").classList.add("stagger");
  $("sourceNote").textContent = S.place.source === "florence"
    ? `Picked from the Michelin Guide, Gambero Rosso and Lonely Planet${lms.some((l) => l.rating != null) ? ". Ratings and photos from Google Maps" : ""}`
    : S.place.source === "google" ? "Ratings and photos from Google Maps" : S.place.source === "osm" ? "Places from OpenStreetMap" : "";
}

function listingCard(l, i, extra = "") {
  return `<button class="listing ${extra}" data-landmark="${i}">
    <div class="photo"><img src="${esc(photo(l))}" data-title="${esc(l.title)}" alt="" loading="lazy">
      ${l.badge ? `<span class="tag">${esc(l.badge)}</span>` : l.famous && !extra ? `<span class="tag">Famous</span>` : i === 0 && !extra ? `<span class="tag">Top pick</span>` : ""}
      <span class="heart ${isSaved(l.title) ? "on" : ""}" data-save="${i}" data-save-title="${esc(l.title)}" role="button" aria-label="Save">${icon("heart")}</span>
    </div>
    <div class="meta">
      <div class="t"><span>${esc(l.title)}</span>${l.rating != null ? `<span class="rate">★ ${l.rating.toFixed(1)}</span>` : ""}</div>
      <div class="s">${esc([spotKind(l), l.hood].filter(Boolean).join(" · "))}</div>
      <div class="d">${[dist(l.distance) && `<b>${dist(l.distance)}</b>`, walk(l.distance), l.price, openLabel(l)].filter(Boolean).join(" · ")}</div>
    </div></button>`;
}

$("storiesRow").addEventListener("click", onStoryTap);
$("heroWrap").addEventListener("click", onStoryTap);
function onStoryTap(e) {
  const b = e.target.closest("[data-story]");
  if (!b || !S.place) return;
  if (b.dataset.story === "tour") openStory({ kind: "tour" });
  else openStory({ kind: "lm", landmark: S.place.spots[Number(b.dataset.i)] });
}

$("rail").addEventListener("click", (e) => {
  const sv = e.target.closest("[data-save]");
  if (sv) {
    e.stopPropagation();
    return toggleSave(S.place.spots[Number(sv.dataset.save)], sv);
  }
  const c = e.target.closest("[data-landmark]");
  if (c) openDetail(S.place.spots[Number(c.dataset.landmark)]);
});

function toggleSave(l, el) {
  const list = saved();
  const on = !list.some((x) => x.title === l.title);
  local("tb-saved-food", on ? [{ ...l, savedFrom: placeParts().name, savedAt: S.here }, ...list] : list.filter((x) => x.title !== l.title));
  el?.classList.toggle("on", on);
  document.querySelectorAll(`[data-save-title="${CSS.escape(l.title)}"]`).forEach((b) => b.classList.toggle("on", on));
  toast(on ? `Saved ${l.title}` : `Removed from saved`);
}

// ---------- saved ----------
function renderSaved() {
  const list = saved();
  $("savedGrid").innerHTML = list.length
    ? `<div class="grid stagger">${list.map((l, i) => listingCard(l, i).replace(`data-landmark="${i}"`, `data-saved="${i}"`).replace(`data-save="${i}"`, `data-unsave="${i}"`).replace("Top pick", esc(l.savedFrom || ""))).join("")}</div>`
    : `<div class="empty"><div class="big">Nothing saved yet</div>Tap the ${icon("heart", "sm")} on any place to eat to keep it for later.</div>`;
}
$("savedGrid").addEventListener("click", (e) => {
  const list = saved();
  const un = e.target.closest("[data-unsave]");
  if (un) {
    e.stopPropagation();
    toggleSave(list[Number(un.dataset.unsave)]);
    return renderSaved();
  }
  const c = e.target.closest("[data-saved]");
  if (c) openDetail(list[Number(c.dataset.saved)]);
});

// ---------- stories ----------
const tourKey = () => `tour:${S.here.lat.toFixed(3)},${S.here.lon.toFixed(3)}`;
const lmKey = (l) => `spot:${l.id || l.title}`;
const V = { key: null, idx: 0, elapsed: 0, last: 0, paused: false, raf: 0, held: false, sound: false, spokenIdx: -1 };

function storyUrl(kind, l) {
  const q = `lat=${S.here.lat}&lon=${S.here.lon}`;
  if (kind === "tour") return `/api/tour?${q}`;
  // Saved spots are looked up from where they were saved, since the server only
  // tells stories about places near the given point.
  const at = l.savedAt ? `lat=${l.savedAt.lat}&lon=${l.savedAt.lon}` : q;
  return `/api/spot-story?${at}&id=${encodeURIComponent(l.id || "")}`;
}

// Starts (or reuses) a streamed story; cards fill in as they arrive.
function fetchStory(key, url) {
  if (S.stories.has(key)) return S.stories.get(key);
  const st = { cards: [], done: false, error: null };
  S.stories.set(key, st);
  (async () => {
    let text = "";
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error);
      await readSse(res, (ev, data) => {
        if (ev === "text") { text += data.text; st.cards = parseCards(text); }
        if (ev === "error") st.error = data.message;
        if (ev === "meta") st.meta = data;
        onStoryUpdate(key);
      });
    } catch (err) { st.error = err.message || "Couldn't load this story."; }
    st.done = true;
    onStoryUpdate(key);
    if (st.error && !st.cards.length) S.stories.delete(key);
  })();
  return st;
}
function prefetchTour() { if (S.here) { fetchStory(tourKey(), storyUrl("tour")); renderGuide(); } }

// ---------- your guide (tour narration shown right on Explore) ----------
const GUIDE_PREVIEW = 3;
const guideGhosts = () => Array.from({ length: GUIDE_PREVIEW }, () => `<div class="card ghost">${[40, 95, 80].map((w) => `<div class="sk sk-line" style="width:${w}%"></div>`).join("")}</div>`).join("");
function onStoryUpdate(key) {
  if (S.here && key === tourKey()) renderGuide();
}
function renderGuide() {
  const el = $("guide");
  if (!S.here) return;
  const st = S.stories.get(tourKey());
  if (!st) { el.innerHTML = ""; return; }
  if (!st.cards.length) {
    el.innerHTML = st.error
      ? `<div class="err">${esc(st.error)}<br><button data-guide-retry>Try again</button></div>`
      : `<div class="note">Your guide is digging into what this neighborhood eats…</div>` + guideGhosts();
    return;
  }
  const open = el.classList.contains("open");
  const cards = st.cards.map((c, i) => `<article class="card ${i >= GUIDE_PREVIEW ? "hidden-card" : ""}">
      <div class="em" aria-hidden="true">${esc(c.emoji)}</div>
      <div><h3>${esc(c.title)}</h3><p>${inline(c.body)}${!st.done && i === st.cards.length - 1 ? '<span class="cursor"></span>' : ""}</p></div>
    </article>`).join("");
  const extra = st.cards.length - GUIDE_PREVIEW;
  const more = extra > 0 ? `<button class="more" data-guide-more>${open ? "Show less" : `Keep reading (${extra} more)`}</button>` : "";
  const note = st.meta?.demo ? `<div class="note">Demo mode: the server has no Anthropic API key, so this is placeholder text.</div>`
    : st.error ? `<div class="note">${esc(st.error)}</div>` : "";
  el.innerHTML = cards + more + note;
}
$("guide").addEventListener("click", (e) => {
  if (e.target.closest("[data-guide-more]")) {
    const open = $("guide").classList.toggle("open");
    renderGuide();
    // After collapsing, bring the guide back into view rather than leaving you far down the page.
    if (!open) window.scrollTo({ top: Math.max(0, $("guide").closest(".section").offsetTop - 64), behavior: "smooth" });
  }
  if (e.target.closest("[data-guide-retry]")) { S.stories.delete(tourKey()); prefetchTour(); }
});
$("guidePlay").addEventListener("click", () => { if (S.place) openStory({ kind: "tour" }); });

function openStory({ kind, landmark }) {
  const key = kind === "tour" ? tourKey() : lmKey(landmark);
  const st = fetchStory(key, storyUrl(kind, landmark));
  const { name } = placeParts();
  Object.assign(V, { key, st, kind, landmark, idx: 0, elapsed: 0, last: performance.now(), paused: false, spokenIdx: -1 });
  $("storyName").textContent = kind === "tour" ? `Eating in ${name}` : landmark.title;
  V.baseSub = kind === "tour" ? "Your food guide" : [spotKind(landmark), landmark.distance != null && !landmark.savedFrom ? dist(landmark.distance) : ""].filter(Boolean).join(" · ") || "Your food guide";
  V.metaShown = false;
  $("storySub").textContent = V.baseSub;
  $("storyAvatar").innerHTML = `<img src="${esc(kind === "tour" ? (S.place.areaImage || S.place.spots.find((l) => l.thumbnail)?.thumbnail || art(name)) : photo(landmark))}" data-title="${esc(kind === "tour" ? name : landmark.title)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
  $("storyQ").value = "";
  $("storyQ").placeholder = kind === "tour" ? `Ask about ${name}…` : `Ask about ${landmark.title}…`;
  openLayer($("story"));
  V.rendered = null;
  cancelAnimationFrame(V.raf);
  V.raf = requestAnimationFrame(tick);
}

function closeStory(opts) {
  cancelAnimationFrame(V.raf);
  window.speechSynthesis?.cancel();
  if (press) clearTimeout(press.timer);
  press = null;
  closeLayer($("story"), opts);
  if (V.st?.done && V.st.cards.length) {
    local("tb-seen", [...seen(), V.key].slice(-200));
    // Grey the ring in place; re-rendering Explore would reset the rows' scroll positions.
    document.querySelectorAll(".ring[data-key]").forEach((r) => { if (r.dataset.key === V.key) r.classList.add("seen"); });
  }
}

// Reading time per card: ~3.6 words/sec plus a beat, at least 5 s.
const cardMs = (c) => Math.max(5000, ((c.title + " " + c.body).split(/\s+/).length / 3.6) * 1000 + 1800);

function bgFor(card, i) {
  const lms = S.place?.spots || [];
  if (V.kind === "lm") return photo(V.landmark);
  // Show a landmark's photo only on the card that talks about it. Match the short
  // name too: the guide says "Central Park", the article is "Central Park (San Mateo)".
  const text = card ? (card.title + " " + card.body).toLowerCase() : "";
  const short = (t) => t.replace(/\s*\(.*\)$/, "").split(",")[0].toLowerCase();
  const named = lms.find((l) => text.includes(l.title.toLowerCase()) || (short(l.title).length > 4 && text.includes(short(l.title))));
  if (named) return photo(named);
  // Cards about the area itself get the town's photo, then other photos taken
  // around here, never an unrelated landmark's picture.
  const pics = [S.place?.areaImage, ...(S.place?.areaPhotos || [])].filter(Boolean);
  if (pics.length) return pics[i % pics.length];
  return art(`${placeParts().name}-${i}`);
}

function tick(now) {
  const { st } = V;
  const dt = now - V.last;
  V.last = now;
  const cards = st.cards;
  const card = cards[V.idx];
  const complete = card && (V.idx < cards.length - 1 || st.done);

  if (!V.paused && complete) V.elapsed += dt;
  const dur = card ? cardMs(card) : 1;

  // progress bars
  const total = Math.max(cards.length, st.done ? cards.length : V.kind === "tour" ? 5 : 3);
  const bars = $("bars");
  if (bars.children.length !== total) bars.innerHTML = Array.from({ length: total }, () => "<span><i></i></span>").join("");
  [...bars.children].forEach((b, i) => {
    b.classList.toggle("pending", i >= cards.length);
    b.firstChild.style.width = i < V.idx ? "100%" : i > V.idx ? "0%" : `${Math.min(100, (V.elapsed / dur) * 100)}%`;
  });

  renderStoryCard(card, complete);

  if (V.sound && complete && V.spokenIdx !== V.idx) speakCard(card);
  if (st.meta && !V.metaShown) {
    V.metaShown = true;
    const n = st.meta.hits || 1;
    $("storySub").textContent = `${V.baseSub} · ${n > 1 ? `heard by ${n.toLocaleString()} people` : "you're the first to hear this"}`;
  }

  if (complete && V.elapsed >= dur && !V.speaking) {
    if (V.idx < cards.length - 1 || !st.done) next();
    else return closeStory();
  }
  if (st.done && !cards.length) {
    toast(st.error || "Couldn't load this story.");
    return closeStory();
  }
  V.raf = requestAnimationFrame(tick);
}

function renderStoryCard(card, complete) {
  const sig = card ? `${V.idx}|${card.title}|${card.body.length}|${complete}` : "loading";
  if (V.rendered === sig) return;
  const fresh = !V.rendered || V.rendered.split("|")[0] !== String(V.idx) || V.rendered === "loading";
  V.rendered = sig;
  const bg = bgFor(card, V.idx);
  const bgEl = $("storyBg");
  if (bgEl.dataset.src !== bg) { bgEl.dataset.src = bg; bgEl.style.backgroundImage = `url("${bg.replace(/"/g, "%22")}")`; }
  const n = V.st.done ? V.st.cards.length : null;
  $("storyContent").innerHTML = card
    ? `<div class="${fresh ? "reveal" : ""}">
        <div class="kicker"><span class="e">${card.emoji}</span>${V.idx + 1}${n ? ` of ${n}` : ""}</div>
        <h2>${esc(card.title)}</h2>
        <div class="text ${complete ? "" : "cursor"}">${prose(card.body) || "&nbsp;"}</div>
      </div>`
    : `<div class="kicker">Your guide is looking it up</div><h2>One moment…</h2><div class="skeleton-line"></div><div class="skeleton-line" style="width:80%"></div>`;
}

function next() {
  const { cards, done } = V.st;
  if (V.idx < cards.length - 1) { V.idx++; V.elapsed = 0; }
  else if (done) return closeStory();
  else V.elapsed = cardMs(cards[V.idx] || { title: "", body: "" }); // wait at end of current until next arrives
  window.speechSynthesis?.cancel();
  V.speaking = false;
}
function prev() {
  if (V.idx > 0) V.idx--;
  V.elapsed = 0;
  window.speechSynthesis?.cancel();
  V.speaking = false;
  V.spokenIdx = -1;
}

function speakCard(card) {
  V.spokenIdx = V.idx;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(`${card.title}. ${plain(card.body)}`);
  V.speaking = true;
  u.onend = u.onerror = () => { V.speaking = false; };
  speechSynthesis.speak(u);
}
$("soundBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  if (!("speechSynthesis" in window)) return toast("Read-aloud isn't supported in this browser.");
  V.sound = !V.sound;
  $("soundBtn").innerHTML = icon(V.sound ? "sound" : "mute");
  if (!V.sound) { speechSynthesis.cancel(); V.speaking = false; }
  else V.spokenIdx = -1;
});
$("storyClose").addEventListener("click", closeStory);

// Tap left/right to move, press and hold to pause, swipe down to close.
let press = null;
$("story").addEventListener("pointerdown", (e) => {
  if (e.target.closest("button, input, form")) return;
  press = { x: e.clientX, y: e.clientY, t: performance.now(), zone: e.target.closest("[data-tap]")?.dataset.tap };
  try { $("story").setPointerCapture(e.pointerId); } catch {}
  V.paused = true;
  V.held = false;
  press.timer = setTimeout(() => { V.held = true; $("story").classList.add("paused"); window.speechSynthesis?.pause?.(); }, 220);
});
// The story follows your finger as you pull it down, then closes or springs back.
$("story").addEventListener("pointermove", (e) => {
  if (!press) return;
  const dy = e.clientY - press.y;
  if (!press.drag && dy > 12 && dy > Math.abs(e.clientX - press.x)) {
    press.drag = true;
    clearTimeout(press.timer);
    $("story").classList.remove("enter", "settle", "paused");
    $("story").classList.add("dragging");
  }
  if (press.drag) {
    const d = Math.max(0, dy);
    $("story").style.transform = `translateY(${d}px) scale(${1 - Math.min(d / 2400, 0.08)})`;
    $("story").style.opacity = String(1 - Math.min(d / 600, 0.4));
  }
});
function endPress(e, cancelled) {
  if (!press) return;
  clearTimeout(press.timer);
  const el = $("story");
  const dy = e.clientY - press.y;
  const quick = performance.now() - press.t < 220;
  const { drag: wasDrag, zone } = press;
  V.paused = false;
  el.classList.remove("paused");
  if (V.held) window.speechSynthesis?.resume?.();
  press = null;
  if (!cancelled && dy > 90) return closeStory();
  if (wasDrag) {
    el.classList.remove("dragging");
    el.classList.add("settle");
    el.style.transform = el.style.opacity = "";
  } else if (!cancelled && quick && Math.abs(dy) < 20) zone === "prev" ? prev() : next();
}
$("story").addEventListener("pointerup", (e) => endPress(e, false));
$("story").addEventListener("pointercancel", (e) => endPress(e, true));
$("storyQ").addEventListener("focus", () => { V.paused = true; });
$("storyQ").addEventListener("blur", () => { V.paused = false; });
$("storyReply").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("storyQ").value.trim();
  if (!q) return;
  const topic = V.kind === "lm" ? V.landmark.title : null;
  closeStory({ instant: true });
  closeAllLayers(); // the landmark page may be open underneath
  showTab("ask", { top: true });
  ask(q, topic);
});

// ---------- landmark detail ----------
function openDetail(l) {
  const qs = S.questions.filter((q) => q.topic === l.title);
  const links = [
    l.mapsUrl && [l.mapsUrl, "pin", "Menu, hours & reviews", "Google Maps"],
    l.website && [l.website, "share", "Website", esc(l.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, ""))],
    l.wikiUrl && [l.wikiUrl, "book", "Read its history", "Wikipedia"],
  ].filter(Boolean);
  const dir = l.lat != null
    ? `https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${l.lat},${l.lon}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.title)}`;
  $("detail").innerHTML = `
    <div class="hero-photo"><img src="${esc(photo(l))}" data-title="${esc(l.title)}" alt="">
      ${l.photoCredit ? `<span class="credit">Photo: ${esc(l.photoCredit)}${l.rating != null ? " on Google Maps" : ""}</span>` : ""}
      <div class="hero-actions">
        <button class="round" data-close-detail aria-label="Back">${icon("back", "sm")}</button><span class="sp"></span>
        <button class="round" data-share aria-label="Share">${icon("share", "sm")}</button>
        <button class="round heart-btn ${isSaved(l.title) ? "on" : ""}" data-save-title="${esc(l.title)}" aria-label="Save" style="${isSaved(l.title) ? "color:var(--accent)" : ""}">${icon("heart", "sm")}</button>
      </div></div>
    <div class="sheet stagger">
      <h1>${esc(l.title)}</h1>
      <div class="sub">${esc([spotKind(l), l.address || l.savedFrom || placeParts().name].filter(Boolean).join(" · "))}</div>
      <div class="stats">
        ${l.rating != null
          ? `<div><b>★ ${l.rating.toFixed(1)}</b><span>${l.ratingCount ? `${count(l.ratingCount)} reviews` : "rating"}</span></div>`
          : l.badge ? `<div><b>${esc(l.badge.replace(/ (Michelin )?stars?$/, "★").replace(/^Michelin Guide$/, "Michelin"))}</b><span>${/star/.test(l.badge) ? "Michelin" : /Michelin/.test(l.badge) ? "listed" : ""}</span></div>`
          : `<div><b>${l.famous ? "Famous" : "Local"}</b><span>${l.famous ? "on Wikipedia" : "spot"}</span></div>`}
        <div><b>${l.price || dist(l.distance) || "—"}</b><span>${l.price ? "price" : "distance"}</span></div>
        <div><b>${l.openNow == null ? qs.length : l.openNow ? "Open" : "Closed"}</b><span>${l.openNow == null ? "questions" : "right now"}</span></div>
      </div>
      <button class="row-link" data-lm-story>
        <div class="ring ${seen().has(lmKey(l)) ? "seen" : ""}" data-key="${esc(lmKey(l))}"><img src="${esc(photo(l))}" data-title="${esc(l.title)}" alt=""></div>
        <div class="txt"><div class="t">Watch its story</div><div class="s">Why people come, what to order, a tip</div></div>${icon("chev", "sm")}
      </button>
      ${l.extract ? `<hr><h3>About</h3><div class="about">${esc(l.extract)}</div>` : ""}
      ${l.order ? `<hr><h3>What to order</h3><div class="about">${esc(l.order)}</div>` : ""}
      ${l.sources?.length ? `<div class="muted sources">Recommended by ${l.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`).join(", ")}</div>` : ""}
      ${l.hours ? `<div class="muted" style="margin-top:8px;font-size:14px">${icon("clock", "sm")} ${esc(l.hours)}</div>` : ""}
      <hr>
      <h3>Getting there</h3>
      <a class="row-link" href="${dir}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">
        <span class="avatar" style="background:var(--soft);color:var(--ink);width:48px;height:48px;border-radius:12px">${icon("walk")}</span>
        <div class="txt"><div class="t">Walking directions</div><div class="s">${walk(l.distance) || "Open in Maps"}</div></div>${icon("chev", "sm")}
      </a>
      ${links.map(([href, ic, t, sub]) => `<a class="row-link" href="${esc(href)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">
        <span class="avatar" style="background:var(--soft);color:var(--ink);width:48px;height:48px;border-radius:12px">${icon(ic)}</span>
        <div class="txt"><div class="t">${t}</div><div class="s">${sub}</div></div>${icon("chev", "sm")}
      </a>`).join("")}
      <hr>
      <h3>Questions about ${esc(l.title)}</h3>
      <div class="feed" style="margin:0 -20px">${qs.length ? qs.slice(0, 3).map(postHtml).join("") : `<div class="muted" style="padding:0 20px">No one has asked about it yet. Be the first.</div>`}</div>
    </div>
    <div class="footer-bar">
      <div class="txt"><b>${[l.price, walk(l.distance)].filter(Boolean).join(" · ") || "Nearby"}</b><span data-lm-story>Watch the story</span></div>
      <button class="btn primary" data-ask-about>${icon("sparkle", "sm")}Ask the guide</button>
    </div>`;
  $("detail").scrollTop = 0;
  $("detail")._landmark = l;
  openLayer($("detail"));
}
$("detail").addEventListener("click", async (e) => {
  const l = $("detail")._landmark;
  if (e.target.closest("[data-close-detail]")) return closeLayer($("detail"));
  const sv = e.target.closest("[data-save-title]");
  if (sv) {
    toggleSave(l, sv);
    sv.style.color = isSaved(l.title) ? "var(--accent)" : "";
    if (S.tab === "saved") renderSaved();
    return;
  }
  if (e.target.closest("[data-lm-story]")) return openStory({ kind: "lm", landmark: l });
  if (e.target.closest("[data-ask-about]")) {
    closeLayer($("detail"), { instant: true });
    showTab("ask", { top: true });
    $("question").placeholder = `Ask about ${l.title}…`;
    $("question").dataset.topic = l.title;
    return $("question").focus();
  }
  if (e.target.closest("[data-share]")) {
    const data = { title: l.title, text: `${l.title}, found with TravelBuddy`, url: l.mapsUrl || l.url };
    if (navigator.share) navigator.share(data).catch(() => {});
    else { navigator.clipboard?.writeText(data.url); toast("Link copied"); }
  }
  handlePostClick(e);
});

// ---------- ask & Q&A feed ----------
function renderChips() {
  const top = S.place?.spots?.[0]?.title;
  const chips = S.place?.source === "florence"
    ? ["What should I eat in Florence?", "Where's the best bistecca?", top && `What should I order at ${top}?`, "Where do Florentines get lampredotto?", "Best cheap lunch nearby?"].filter(Boolean)
    : ["What is this area known for eating?", "Where do locals eat?", top && `What should I order at ${top}?`, "Best cheap eats nearby?", "Anything good open late?"].filter(Boolean);
  $("chips").innerHTML = chips.map((c) => `<button class="chip" data-chip>${esc(c)}</button>`).join("");
}
$("chips").addEventListener("click", (e) => {
  const c = e.target.closest("[data-chip]");
  if (c) ask(c.textContent);
});
$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const topic = $("question").dataset.topic || null;
  ask($("question").value, topic);
});
$("question").addEventListener("input", () => { $("askBtn").disabled = !$("question").value.trim(); });

function postHtml(q, live = false) {
  const v = voted().has(q.id);
  const ans = plain(q.answer || "").trim();
  const cut = ans.search(/(?<=[.!?])\s/);
  const lead = cut > 0 ? ans.slice(0, cut) : ans;
  const rest = cut > 0 ? ans.slice(cut) : "";
  const h = hue(q.author + q.id);
  return `<article class="post ${live ? "live" : ""}" ${q.id ? `data-id="${q.id}"` : ""}>
    <div class="post-head"><span class="avatar" style="background:hsl(${h} 55% 52%)">${esc(initials(q.author || "A T"))}</span>
      <span><b>${esc(q.author || "You")}</b> · ${q.createdAt ? ago(q.createdAt) : "now"}${q.distance ? ` · ${dist(q.distance)} away` : ""}</span></div>
    <div class="q">${esc(q.question)}</div>
    ${q.topic ? `<span class="topic">${icon("pin", "sm")}${esc(q.topic)}</span>` : ""}
    <div class="reply"><span class="avatar guide">${icon("sparkle", "sm")}</span>
      <div class="body"><div class="who">Food guide</div>
        <p class="ans">${live ? `<span class="cursor">${inline(q.answer || "")}</span>` : `${esc(lead)}<span class="more">${esc(rest)}</span>`}</p></div></div>
    ${live ? "" : `<div class="post-actions">
      <button data-like="${q.id}" class="${v ? "liked" : ""}" ${v ? "disabled" : ""} aria-label="Helpful">${icon("heart", "sm")}<span>${q.upvotes || 0}</span></button>
      ${rest ? `<button data-more>More</button>` : ""}
    </div>`}
  </article>`;
}

function renderFeed() {
  const qs = S.questions;
  $("feed").innerHTML = qs.length
    ? qs.map((q) => postHtml(q)).join("")
    : `<div class="empty"><div class="big">Be the first to ask</div>Your question, and the guide's answer, will help the next hungry person here.</div>`;
  $("previewQa").innerHTML = qs.length
    ? qs.slice(0, 2).map((q) => postHtml(q)).join("")
    : `<div class="empty" style="padding:28px 20px"><div class="big" style="font-size:24px">No questions yet</div><button class="btn outline" data-goto="ask" style="margin-top:12px">Ask the first one</button></div>`;
}

async function loadQuestions() {
  try {
    const res = await fetch(`/api/questions?lat=${S.here.lat}&lon=${S.here.lon}`);
    S.questions = await res.json();
    renderFeed();
    const n = S.questions.length;
    $("qaBadge").textContent = n > 9 ? "9+" : n;
    $("qaBadge").hidden = n === 0 || S.tab === "ask";
  } catch {
    $("feed").innerHTML = `<div class="empty">Couldn't load questions right now.</div>`;
  }
}

async function ask(question, topic = null) {
  question = question.trim();
  if (!question || !S.here) return;
  $("question").value = "";
  $("question").blur();
  $("question").placeholder = "Ask about food around here…";
  delete $("question").dataset.topic;
  $("askBtn").disabled = true;

  const holder = document.createElement("div");
  $("feed").querySelector(".empty")?.remove();
  $("feed").prepend(holder);
  const draft = { author: "You", question, topic, answer: "" };
  holder.innerHTML = postHtml(draft, true);
  window.scrollTo({ top: 0, behavior: "smooth" });
  const ansEl = () => holder.querySelector(".ans .cursor");
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...S.here, question, topic }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error);
    await readSse(res, (ev, data) => {
      if (ev === "text") { draft.answer += data.text; ansEl().innerHTML = inline(draft.answer); }
      else if (ev === "error") throw new Error(data.message);
      else if (ev === "saved") {
        if (data.hidden) toast("Answered privately: this question won't be shown to other people.");
        else S.questions = [{ ...data, distance: 0 }, ...S.questions];
        holder.outerHTML = postHtml({ ...data, author: "You" }).replace('class="post', 'class="post open');
        renderFeedPreviewOnly();
      }
    });
  } catch (err) {
    holder.remove();
    toast(err.message || "Couldn't ask that right now.");
  } finally {
    $("askBtn").disabled = !$("question").value.trim();
  }
}
function renderFeedPreviewOnly() {
  $("previewQa").innerHTML = S.questions.slice(0, 2).map((q) => postHtml(q)).join("");
}

async function handlePostClick(e) {
  const more = e.target.closest("[data-more]");
  if (more) {
    const open = more.closest(".post").classList.toggle("open");
    more.textContent = open ? "Less" : "More";
    return;
  }
  const like = e.target.closest("[data-like]");
  if (!like || like.disabled) return;
  const id = Number(like.dataset.like);
  like.disabled = true;
  like.classList.add("liked");
  const res = await fetch(`/api/questions/${id}/upvote`, { method: "POST" });
  if (!res.ok) return;
  const row = await res.json();
  local("tb-voted", [...voted(), id]);
  const q = S.questions.find((x) => x.id === id);
  if (q) q.upvotes = row.upvotes;
  document.querySelectorAll(`[data-like="${id}"]`).forEach((b) => {
    b.classList.add("liked");
    b.disabled = true;
    b.querySelector("span").textContent = row.upvotes;
  });
}
$("feed").addEventListener("click", handlePostClick);
$("previewQa").addEventListener("click", handlePostClick);

// ---------- boot ----------
$("welcomeArt").style.backgroundImage = `url("${art("TravelBuddy welcome", { tall: true })}")`;
$("locateBtn").addEventListener("click", locate);
$("askBtn").disabled = true;
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("story").hidden) closeStory();
  else if (!$("detail").hidden) closeLayer($("detail"));
  else if (!$("search").hidden) closeLayer($("search"));
});

const params = new URLSearchParams(location.search);
if (params.has("lat") && params.has("lon")) go(Number(params.get("lat")), Number(params.get("lon")));
else {
  // Already allowed location before? Skip the tap and start the tour straight away.
  navigator.permissions?.query({ name: "geolocation" }).then((p) => { if (p.state === "granted" && !S.here) locate(); }).catch(() => {});
}
root.classList.remove("booted");

// Coming back to the app after a while: if you've moved, quietly switch to where you are now.
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (!S.gps || !S.here || layers.length || Date.now() - hiddenAt < 5 * 60 * 1000) return;
  navigator.geolocation?.getCurrentPosition((pos) => {
    const { latitude: lat, longitude: lon } = pos.coords;
    const m = Math.hypot(lat - S.here.lat, (lon - S.here.lon) * Math.cos((lat * Math.PI) / 180)) * 111320;
    if (m > 300 && S.gps && !layers.length && !root.classList.contains("typing")) {
      go(lat, lon, { gps: true });
      toast("You've moved. Here's what's cooking where you are now.");
    }
  }, () => {}, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
