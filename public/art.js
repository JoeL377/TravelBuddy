// Generative "postcard" art: a sky, a sun and layered rooftops, unique per name.
// Used whenever a landmark has no photo, so the feed never shows an empty box.

const PALETTES = [
  { sky: ["#ffcf9e", "#ff8a65", "#7b4a8c"], sun: "#fff3d6", hills: ["#c0566b", "#8e3c63", "#4f2350"], water: "#5b2c5f" },  // sunset
  { sky: ["#bfe6ff", "#7cc4ef", "#3d8fc6"], sun: "#fff9e8", hills: ["#5f9fb8", "#3e7491", "#24485f"], water: "#2d5a74" },  // harbor morning
  { sky: ["#ffe7c2", "#f6b17a", "#d4734a"], sun: "#fffaf0", hills: ["#b9643e", "#8a4429", "#552817"], water: "#6d3820" },  // terracotta
  { sky: ["#d9f2e6", "#9ed6c0", "#4f9e8a"], sun: "#fbfff4", hills: ["#5d9c84", "#3c7562", "#1f4a3d"], water: "#2a5d4f" },  // garden
  { sky: ["#2b2d5c", "#5b3f87", "#e07b8c"], sun: "#ffd9c7", hills: ["#3c2f62", "#271f45", "#120e24"], water: "#1b1636" },  // dusk
  { sky: ["#f3e7ff", "#c9b6f2", "#8e7bd1"], sun: "#ffffff", hills: ["#8a74c4", "#5f4c99", "#3a2c66"], water: "#463775" },  // lavender
];

function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function skyline(r, baseY, maxH, color, W) {
  let x = -10;
  let d = `M -10 ${baseY + 400}`;
  while (x < W + 10) {
    const w = 18 + r() * 46;
    const h = maxH * (0.35 + r() * 0.65);
    const top = baseY - h;
    const kind = r();
    d += ` L ${x} ${top}`;
    if (kind < 0.18) d += ` L ${x + w / 2} ${top - 14 - r() * 26} L ${x + w} ${top}`; // gable
    else if (kind < 0.26) d += ` Q ${x + w / 2} ${top - w * 0.8} ${x + w} ${top}`; // dome
    else if (kind < 0.31) { d += ` L ${x + w / 2 - 3} ${top} L ${x + w / 2} ${top - 60 - r() * 50} L ${x + w / 2 + 3} ${top} L ${x + w} ${top}`; } // spire
    else d += ` L ${x + w} ${top}`;
    x += w;
  }
  return `<path d="${d} L ${W + 10} ${baseY + 400} Z" fill="${color}"/>`;
}

export function art(name, { tall = false } = {}) {
  const r = rng(name);
  const p = PALETTES[Math.floor(r() * PALETTES.length)];
  const W = 600, H = tall ? 1100 : 720;
  const horizon = H * (0.6 + r() * 0.08);
  const sunX = W * (0.2 + r() * 0.6), sunY = horizon - H * (0.18 + r() * 0.15), sunR = 40 + r() * 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[2]}"/><stop offset=".55" stop-color="${p.sky[1]}"/><stop offset="1" stop-color="${p.sky[0]}"/></linearGradient>
    <radialGradient id="g"><stop offset="0" stop-color="${p.sun}" stop-opacity=".9"/><stop offset="1" stop-color="${p.sun}" stop-opacity="0"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#s)"/>
    <circle cx="${sunX}" cy="${sunY}" r="${sunR * 3}" fill="url(#g)"/>
    <circle cx="${sunX}" cy="${sunY}" r="${sunR}" fill="${p.sun}"/>
    ${skyline(r, horizon - 40, 150, p.hills[0], W)}
    ${skyline(r, horizon, 120, p.hills[1], W)}
    ${skyline(r, horizon + 30, 80, p.hills[2], W)}
    <rect y="${horizon + 30}" width="${W}" height="${H}" fill="${p.water}"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
