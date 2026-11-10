"""Stage 3: collect candidate photos for each picked restaurant from its own website,
Wikimedia Commons (free licences) and Reddit posts that show it.

Input:  picks.json  [{"slug", "name", "website", "pages": [extra urls], "commons_query"}]
Output: out/images/<slug>/<sha1>.<ext> and out/images/<slug>/manifest.json, one entry per image:
        {file, width, height, bytes, source_type, image_url, page_url, alt, owner, licence}
Respects robots.txt, one request per 3 s per host. Re-running skips restaurants already done
unless FORCE=1. Usage: python3 scrape_sites.py [slug ...]
"""
import hashlib, html, json, os, re, subprocess, sys, urllib.parse
from html.parser import HTMLParser
from lib import OUT, BROWSER_UA, UA, fetch, image_size, log, load_json, save_json, norm

MIN_SIDE = int(os.environ.get("MIN_SIDE", "700"))
MAX_PAGES = int(os.environ.get("MAX_PAGES", "14"))
MAX_IMAGES = int(os.environ.get("MAX_IMAGES", "60"))
PAGE_HINTS = ("galler", "foto", "photo", "menu", "cucina", "kitchen", "food", "piatti", "dishes", "about", "chi-siamo",
              "storia", "story", "history", "ristorante", "restaurant", "home", "media", "press", "image", "carta")
SKIP_IMG = ("logo", "icon", "favicon", "sprite", "placeholder", "spinner", "flag", "badge", "tripadvisor", "michelin-star",
            "payment", "social", "facebook", "instagram", "whatsapp", "arrow", "map", "pixel", "blank", "loader")


class Grab(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.imgs, self.links, self.meta = [], [], {}

    def handle_starttag(self, tag, a):
        a = dict(a)
        if tag in ("img", "source"):
            alt = a.get("alt") or a.get("title") or ""
            cands = []
            for k in ("srcset", "data-srcset", "data-lazy-srcset"):
                if a.get(k):
                    best, top = -1, None
                    for part in a[k].split(","):
                        bits = part.strip().split()
                        if not bits:
                            continue
                        w = 0
                        if len(bits) > 1 and bits[1][:-1].replace(".", "").isdigit():
                            w = float(bits[1][:-1]) * (1000 if bits[1].endswith("x") else 1)
                        if w >= best:
                            best, top = w, bits[0]
                    if top:
                        cands.append(top)
            for k in ("data-src", "data-lazy-src", "data-original", "data-full", "data-large_image", "data-orig-file", "src"):
                if a.get(k) and not a[k].startswith("data:"):
                    cands.append(a[k])
            for c in cands[:2]:
                self.imgs.append((c, alt))
        if tag == "a" and a.get("href"):
            h = a["href"]
            if re.search(r"\.(jpe?g|png|webp)(\?|$)", h, re.I):
                self.imgs.append((h, a.get("title") or ""))
            else:
                self.links.append(h)
        if tag == "meta" and a.get("content"):
            k = a.get("property") or a.get("name") or ""
            if k in ("og:image", "og:image:url", "twitter:image"):
                self.imgs.append((a["content"], "og:image"))
        st = a.get("style") or ""
        for m in re.finditer(r"url\(['\"]?([^'\")]+)['\"]?\)", st):
            self.imgs.append((m.group(1), "background"))


def upgrade(u):
    """Ask common CMSs/CDNs for the original instead of a thumbnail."""
    u = html.unescape(u)
    u = re.sub(r"-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp))", r"\1", u, flags=re.I)  # WordPress sizes
    m = re.match(r"(https://static\.wixstatic\.com/media/[^/]+\.(?:jpe?g|png|webp))", u, re.I)
    if m:
        u = m.group(1)
    if "squarespace-cdn.com" in u or "images.squarespace" in u:
        u = re.sub(r"\?.*$", "", u) + "?format=2500w"
    if "cdn.shopify.com" in u:
        u = re.sub(r"_(\d+x\d*|\d*x\d+)(?=\.)", "", u)
    return u


def page_score(href, base_host):
    p = urllib.parse.urlsplit(href)
    if p.netloc and p.netloc.replace("www.", "") != base_host:
        return -1
    if re.search(r"\.(pdf|jpe?g|png|zip|docx?)$", p.path, re.I) or href.startswith(("mailto:", "tel:", "#", "javascript:")):
        return -1
    s = norm(p.path)
    sc = sum(3 for h in PAGE_HINTS if h in s)
    if re.search(r"/(it|de|fr|es|ja|zh|ru)(/|$)", s):
        sc -= 2  # prefer the English site, same photos anyway
    return sc


def scrape_site(r, seen, out_dir, man):
    site = r.get("website")
    if not site:
        return
    host = urllib.parse.urlsplit(site).netloc.replace("www.", "")
    queue, visited = [site] + list(r.get("pages", [])), set()
    while queue and len(visited) < MAX_PAGES and len(man) < MAX_IMAGES:
        page = queue.pop(0)
        if page in visited:
            continue
        visited.add(page)
        try:
            data, final, ctype = fetch(page, ua=BROWSER_UA, max_bytes=6_000_000)
        except PermissionError as e:
            log("  robots:", e); continue
        except Exception as e:
            log("  page failed", page, e); continue
        if "html" not in ctype:
            continue
        g = Grab()
        try:
            g.feed(data.decode("utf-8", "replace"))
        except Exception:
            pass
        # inline JSON (Wix/Squarespace/Next) often carries original image URLs
        for m in re.finditer(r'https?:\\?/\\?/[^"\'\s<>]+?\.(?:jpe?g|png|webp)', data.decode("utf-8", "replace"), re.I):
            g.imgs.append((m.group(0).replace("\\/", "/"), "inline"))
        for src, alt in g.imgs:
            u = upgrade(urllib.parse.urljoin(final, src.strip()))
            if not u.startswith("http") or any(s in norm(u) for s in SKIP_IMG) or u.lower().endswith((".svg", ".gif")):
                continue
            grab_image(u, final, alt, "restaurant_site", r.get("owner") or r["name"], "All rights reserved (restaurant's own site)", seen, out_dir, man)
            if len(man) >= MAX_IMAGES:
                break
        nxt = sorted({urllib.parse.urljoin(final, h).split("#")[0] for h in g.links}, key=lambda h: -page_score(h, host))
        for h in nxt:
            if page_score(h, host) > 0 and h not in visited and h not in queue:
                queue.append(h)
        queue.sort(key=lambda h: -page_score(h, host))


def grab_image(u, page, alt, stype, owner, licence, seen, out_dir, man, extra=None):
    if u in seen["url"]:
        return
    seen["url"].add(u)
    try:
        b, _, ctype = fetch(u, ua=BROWSER_UA, gap=1.5)
    except PermissionError:
        return
    except Exception as e:
        log("  img failed", u[:100], e); return
    w, h, fmt = image_size(b)
    if not fmt or min(w, h) < MIN_SIDE or len(b) < 30_000:
        return
    sha = hashlib.sha1(b).hexdigest()[:16]
    if sha in seen["sha"]:
        return
    seen["sha"].add(sha)
    fn = f"{sha}.{'jpg' if fmt == 'jpeg' else fmt}"
    with open(os.path.join(out_dir, fn), "wb") as f:
        f.write(b)
    e = {"file": fn, "width": w, "height": h, "bytes": len(b), "source_type": stype, "image_url": u,
         "page_url": page, "alt": alt, "owner": owner, "licence": licence}
    e.update(extra or {})
    man.append(e)
    log(f"  + {w}x{h} {stype} {u[:90]}")


def commons(r, seen, out_dir, man):
    q = r.get("commons_query") or r["name"] + " Firenze"
    api = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "format": "json", "generator": "search", "gsrsearch": q, "gsrnamespace": 6, "gsrlimit": 12,
        "prop": "imageinfo", "iiprop": "url|size|extmetadata|user", "iiurlwidth": 2400})
    try:
        j = json.loads(fetch(api, ua=UA, gap=1.0, check_robots=False)[0])
    except Exception as e:
        log("  commons failed", e); return
    for p in (j.get("query", {}).get("pages") or {}).values():
        ii = (p.get("imageinfo") or [{}])[0]
        md = ii.get("extmetadata") or {}
        lic = (md.get("LicenseShortName") or {}).get("value", "")
        artist = re.sub("<[^>]+>", "", (md.get("Artist") or {}).get("value", "")) or ii.get("user")
        u = ii.get("thumburl") or ii.get("url")
        if u and ii.get("width", 0) >= MIN_SIDE:
            grab_image(u, ii.get("descriptionurl"), p.get("title"), "wikimedia_commons", artist, lic, seen, out_dir, man,
                       {"needs_name_check": True})


def reddit_photos(r, seen, out_dir, man):
    """Photos people posted on Reddit whose post title names this restaurant (from stage 1 data)."""
    posts = load_json(os.path.join(OUT, "reddit", "posts.json"), {}) or {}
    names = [norm(a) for a in [r["name"]] + r.get("aliases", []) if len(a) > 4]
    for p in posts.values():
        t = norm(p.get("title", "") + " " + (p.get("selftext") or "")[:500])
        if not any(re.search(r"\b" + re.escape(n) + r"\b", t) for n in names):
            continue
        urls = []
        if p.get("post_hint") == "image" and p.get("url"):
            urls.append(p["url"])
        for gi in p.get("gallery") or []:
            if gi.get("src"):
                urls.append(gi["src"])
        for u in urls[:8]:
            grab_image(u, "https://www.reddit.com" + p["permalink"], p["title"], "reddit_post", "u/" + str(p.get("author")),
                       "Poster's copyright (Reddit user content)", seen, out_dir, man, {"reddit_score": p.get("score")})


def main():
    picks = load_json(os.path.join(os.path.dirname(os.path.abspath(__file__)), "picks.json"))
    only = set(sys.argv[1:])
    for r in picks:
        if only and r["slug"] not in only:
            continue
        out_dir = os.path.join(OUT, "images", r["slug"])
        mpath = os.path.join(out_dir, "manifest.json")
        if os.path.exists(mpath) and not os.environ.get("FORCE"):
            continue
        os.makedirs(out_dir, exist_ok=True)
        log(f"== {r['name']} ({r.get('website')})")
        man, seen = [], {"url": set(), "sha": set()}
        scrape_site(r, seen, out_dir, man)
        commons(r, seen, out_dir, man)
        reddit_photos(r, seen, out_dir, man)
        save_json(mpath, man)
        log(f"   {len(man)} images kept")
    shrink()


def shrink():
    """Make 1400px JPEG previews (macOS sips) so the review copy is small enough to share."""
    root = os.path.join(OUT, "images")
    for slug in sorted(os.listdir(root)):
        d = os.path.join(root, slug)
        pv = os.path.join(OUT, "previews", slug)
        os.makedirs(pv, exist_ok=True)
        for e in load_json(os.path.join(d, "manifest.json"), []) or []:
            dst = os.path.join(pv, os.path.splitext(e["file"])[0] + ".jpg")
            if os.path.exists(dst):
                continue
            try:
                subprocess.run(["sips", "-Z", "1400", "-s", "format", "jpeg", "-s", "formatOptions", "78",
                                os.path.join(d, e["file"]), "--out", dst], check=True, capture_output=True)
            except Exception as ex:
                log("  preview failed", e["file"], ex)
        m = load_json(os.path.join(d, "manifest.json"), [])
        save_json(os.path.join(pv, "manifest.json"), m)


if __name__ == "__main__":
    main()
