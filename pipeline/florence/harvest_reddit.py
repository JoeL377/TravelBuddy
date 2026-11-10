"""Stage 1: harvest Florence food threads and comments from Reddit through the official Data API.

Needs a free Reddit "script" app (https://www.reddit.com/prefs/apps). Put its id and secret in
~/.travelbuddy-reddit.env as REDDIT_CLIENT_ID=... and REDDIT_CLIENT_SECRET=... (or export them).
Reddit's robots.txt disallows crawling the website, so this uses only oauth.reddit.com.

Writes out/reddit/posts.json and out/reddit/comments.jsonl. Re-running skips threads already fetched.
"""
import base64, json, os, sys, time, urllib.parse, urllib.request
from lib import OUT, log, save_json, load_json, norm

UA = "script:travelbuddy-florence-research:v0.1 (by /u/" + os.environ.get("REDDIT_USERNAME", "travelbuddy") + ")"


def creds():
    p = os.path.expanduser("~/.travelbuddy-reddit.env")
    if os.path.exists(p):
        for line in open(p):
            if "=" in line and not line.startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))
    cid, sec = os.environ.get("REDDIT_CLIENT_ID"), os.environ.get("REDDIT_CLIENT_SECRET")
    if not cid or not sec:
        sys.exit("Missing REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET (see the docstring).")
    return cid, sec


TOKEN = {"v": None, "exp": 0}


def token():
    if TOKEN["v"] and time.time() < TOKEN["exp"] - 60:
        return TOKEN["v"]
    cid, sec = creds()
    req = urllib.request.Request(
        "https://www.reddit.com/api/v1/access_token",
        data=b"grant_type=client_credentials",
        headers={"User-Agent": UA, "Authorization": "Basic " + base64.b64encode(f"{cid}:{sec}".encode()).decode()},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        j = json.load(r)
    TOKEN.update(v=j["access_token"], exp=time.time() + j.get("expires_in", 3600))
    return TOKEN["v"]


_last = [0.0]


def api(path, **params):
    params.setdefault("raw_json", 1)
    url = "https://oauth.reddit.com" + path + "?" + urllib.parse.urlencode(params)
    for i in range(4):
        gap = 1.2 - (time.time() - _last[0])  # stay under 60 requests/minute (limit is 100)
        if gap > 0:
            time.sleep(gap)
        _last[0] = time.time()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Authorization": "bearer " + token()})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                rem = r.headers.get("x-ratelimit-remaining")
                if rem and float(rem) < 5:
                    time.sleep(float(r.headers.get("x-ratelimit-reset", 60)))
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(10 * (i + 1)); continue
            raise
    raise RuntimeError("gave up on " + url)


# (subreddit, query, needs_florence_in_text)
SEARCHES = []
for q in ["restaurant", "restaurants", "where to eat", "food recommendations", "trattoria", "osteria", "dinner",
          "bistecca", "steak", "pasta", "lunch", "best food", "tasting menu", "michelin", "pizza", "panino", "gelato",
          "tourist trap", "eat", "wine bar", "aperitivo", "lampredotto", "ristorante", "mangiare"]:
    SEARCHES.append(("florence", q, False))
for sub in ["ItalyTravel", "travel", "solotravel", "italy", "Tuscany", "food", "finedining", "Cooking", "foodtravel",
            "TravelNoPics", "europe", "Firenze", "AskAnItalian"]:
    for q in ["Florence restaurant", "Florence where to eat", "Florence food", "Florence trattoria", "Florence dinner",
              "Firenze ristorante", "Florence bistecca", "Florence recommendations"]:
        SEARCHES.append((sub, q, True))

FLORENCE_WORDS = ("florence", "firenze", "florentine", "fiorentin")
FOOD_WORDS = ("eat", "food", "restaurant", "trattoria", "osteria", "dinner", "lunch", "bistecca", "steak", "pasta",
              "ristorant", "mangiare", "cucina", "pizza", "panin", "wine", "menu", "michelin", "gelato", "lampredotto")


def main():
    d = os.path.join(OUT, "reddit")
    os.makedirs(d, exist_ok=True)
    posts = load_json(os.path.join(d, "posts.json"), {}) or {}
    for sub, q, need_flo in SEARCHES:
        for sort in ("relevance", "top"):
            try:
                j = api(f"/r/{sub}/search", q=q, restrict_sr=1, sort=sort, t="all", limit=100, type="link")
            except Exception as e:
                log("search failed", sub, q, e); continue
            n = 0
            for c in j.get("data", {}).get("children", []):
                p = c["data"]
                text = norm(p.get("title", "") + " " + p.get("selftext", ""))
                if need_flo and not any(w in text for w in FLORENCE_WORDS):
                    continue
                if not any(w in text for w in FOOD_WORDS):
                    continue
                if p["id"] not in posts:
                    n += 1
                posts[p["id"]] = {k: p.get(k) for k in ("id", "subreddit", "title", "selftext", "score", "num_comments",
                                                          "created_utc", "permalink", "author", "url", "post_hint", "is_gallery")}
                if p.get("is_gallery") and p.get("media_metadata"):
                    posts[p["id"]]["gallery"] = [
                        {"id": k, "src": (v.get("s") or {}).get("u"), "w": (v.get("s") or {}).get("x"), "h": (v.get("s") or {}).get("y")}
                        for k, v in p["media_metadata"].items() if v.get("e") == "Image"]
            log(f"r/{sub} '{q}' {sort}: +{n} (total {len(posts)})")
        save_json(os.path.join(d, "posts.json"), posts)

    # Comments for threads with real discussion, most-discussed first.
    done_path = os.path.join(d, "comments_done.json")
    done = set(load_json(done_path, []) or [])
    todo = sorted((p for p in posts.values() if (p["num_comments"] or 0) >= 3 and p["id"] not in done),
                  key=lambda p: -(p["num_comments"] or 0))
    max_threads = int(os.environ.get("MAX_THREADS", "600"))
    log(f"{len(todo)} threads to fetch comments for (cap {max_threads})")
    with open(os.path.join(d, "comments.jsonl"), "a", encoding="utf-8") as out:
        for i, p in enumerate(todo[:max_threads]):
            try:
                j = api(f"/comments/{p['id']}", limit=500, depth=6, sort="top")
            except Exception as e:
                log("comments failed", p["id"], e); continue
            stack = list(j[1]["data"]["children"]) if len(j) > 1 else []
            n = 0
            while stack:
                c = stack.pop()
                if c.get("kind") != "t1":
                    continue
                cd = c["data"]
                out.write(json.dumps({"post": p["id"], "id": cd["id"], "author": cd.get("author"), "score": cd.get("score"),
                                      "created_utc": cd.get("created_utc"), "permalink": cd.get("permalink"),
                                      "body": cd.get("body", "")}, ensure_ascii=False) + "\n")
                n += 1
                rep = cd.get("replies")
                if isinstance(rep, dict):
                    stack.extend(rep["data"]["children"])
            done.add(p["id"])
            if i % 10 == 0:
                out.flush(); save_json(done_path, sorted(done))
                log(f"[{i + 1}/{min(len(todo), max_threads)}] {p['subreddit']}: {p['title'][:60]} ({n} comments)")
    save_json(done_path, sorted(done))
    log("done")


if __name__ == "__main__":
    main()
