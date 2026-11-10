"""Stage 2 (mechanical half): count who recommends which restaurant and pull the quotes.

Reads out/reddit (or RAW_DIR) and names.json; writes evidence/summary.json, evidence/<slug>.md
(top quotes with links) and evidence/unknown_names.txt (names people use that names.json misses,
for Claude to review and add). Claude reads these and makes the picks.
"""
import collections, json, os, re
from lib import HERE, OUT, norm, save_json

RAW = os.environ.get("RAW_DIR", os.path.join(OUT, "reddit"))
EV = os.path.join(HERE, "evidence")
NEG = re.compile(r"tourist trap|overrated|overpriced|avoid|skip it|skip this|not worth|disappoint|mediocre|meh\b|rude|"
                 r"wouldn'?t recommend|would not recommend|terrible|worst|bland|scam|underwhelm", re.I)
POS = re.compile(r"best|amazing|incredible|favou?rite|must|loved|delicious|fantastic|outstanding|highlight|"
                 r"go to|recommend|excellent|perfect|unforgettable|top notch|phenomenal|so good", re.I)
UNKNOWN = re.compile(r"\b(?:Trattoria|Osteria|Ristorante|Pizzeria|Enoteca|Gelateria|Pasticceria|Fiaschetteria|Vineria|"
                     r"Tripperia|Buca|Bottega|Forno|Caff[eè]|Da|Dal|Dall'|Alla|All'|Il|La|Le|I)\s+"
                     r"(?:[A-Z][\w'’àèéìòù]+)(?:\s+(?:d[ie]l?l?[ao]?|di|e|del|della|dei|degli)?\s*[A-Z][\w'’àèéìòù]+){0,2}")


def units():
    posts = json.load(open(os.path.join(RAW, "posts.json"), encoding="utf-8"))
    for p in posts.values():
        yield {"post": p["id"], "author": p.get("author"), "score": p.get("score") or 0, "kind": "post",
               "link": "https://www.reddit.com" + p["permalink"], "thread": p["title"], "sub": p["subreddit"],
               "body": p["title"] + "\n" + (p.get("selftext") or ""), "created": p.get("created_utc")}
    with open(os.path.join(RAW, "comments.jsonl"), encoding="utf-8") as f:
        for line in f:
            c = json.loads(line)
            p = posts.get(c["post"], {})
            yield {"post": c["post"], "author": c.get("author"), "score": c.get("score") or 0, "kind": "comment",
                   "link": "https://www.reddit.com" + (c.get("permalink") or ""), "thread": p.get("title", ""),
                   "sub": p.get("subreddit", ""), "body": c.get("body") or "", "created": c.get("created_utc")}


def main():
    names = json.load(open(os.path.join(HERE, "names.json"), encoding="utf-8"))
    pats = {slug: re.compile(r"(?<![\w])(?:" + "|".join(re.escape(norm(a)) for a in al) + r")(?![\w])") for slug, al in names.items()}
    known = re.compile(r"(?<![\w])(?:" + "|".join(re.escape(norm(a)) for al in names.values() for a in al) + r")(?![\w])")
    hits = collections.defaultdict(list)
    unknown = collections.defaultdict(set)
    seen_body = set()
    for u in units():
        if u["author"] in ("AutoModerator",) or u["body"] in ("[deleted]", "[removed]"):
            continue
        key = (u["author"], u["body"][:200])
        if key in seen_body:
            continue
        seen_body.add(key)
        t = norm(u["body"])
        for slug, pat in pats.items():
            m = pat.search(t)
            if not m:
                continue
            a, b = max(0, m.start() - 280), min(len(t), m.end() + 280)
            window = t[a:b]
            hits[slug].append({**{k: u[k] for k in ("author", "score", "kind", "link", "thread", "sub", "created")},
                               "neg": bool(NEG.search(window)), "pos": bool(POS.search(window)),
                               "quote": u["body"][a:b].replace("\n", " ").strip()})
        for m in UNKNOWN.finditer(u["body"]):
            s = m.group(0).strip()
            if not known.search(norm(s)):
                unknown[s].add(u["author"])
    rows = []
    for slug, hs in hits.items():
        authors = {h["author"] for h in hs}
        rows.append({"slug": slug, "name": names[slug][0], "people": len(authors),
                     "threads": len({h["link"].split("/comments/")[1].split("/")[0] for h in hs if "/comments/" in h["link"]}),
                     "upvotes": sum(max(h["score"], 0) for h in hs), "positive": sum(h["pos"] and not h["neg"] for h in hs),
                     "negative": sum(h["neg"] for h in hs),
                     "latest": max((h["created"] or 0) for h in hs)})
    rows.sort(key=lambda r: (-r["people"], -r["upvotes"]))
    os.makedirs(EV, exist_ok=True)
    save_json(os.path.join(EV, "summary.json"), rows)
    for r in rows:
        hs = sorted(hits[r["slug"]], key=lambda h: (-h["neg"], -h["score"]))
        hs = sorted(hs[:60], key=lambda h: -h["score"])
        with open(os.path.join(EV, r["slug"] + ".md"), "w", encoding="utf-8") as f:
            f.write(f"# {r['name']}\n{r['people']} people, {r['threads']} threads, {r['upvotes']} upvotes, "
                    f"{r['positive']} positive / {r['negative']} negative-flagged\n\n")
            for h in hs:
                tag = "NEG " if h["neg"] else ""
                f.write(f"- {tag}[{h['score']}] r/{h['sub']} {h['kind']} — {h['quote']}\n  {h['link']}\n")
    with open(os.path.join(EV, "unknown_names.txt"), "w", encoding="utf-8") as f:
        for s, a in sorted(unknown.items(), key=lambda kv: -len(kv[1])):
            if len(a) >= 3:
                f.write(f"{len(a)}\t{s}\n")
    print(f"{len(rows)} restaurants mentioned; top 40:")
    for r in rows[:40]:
        print(f"{r['people']:4d} people {r['upvotes']:6d} up {r['positive']:3d}+ {r['negative']:3d}-  {r['name']}")


if __name__ == "__main__":
    main()
