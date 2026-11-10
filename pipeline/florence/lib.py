"""Shared helpers for the Florence asset pipeline. Python 3 standard library only."""
import json, os, re, struct, time, unicodedata, urllib.parse, urllib.request, urllib.robotparser, http.client

UA = os.environ.get("PIPELINE_UA", "TravelBuddyFlorenceResearch/0.1 (personal research; contact via github.com/JoeL377)")
BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("PIPELINE_OUT", os.path.join(HERE, "out"))

_last = {}
_robots = {}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def wait_turn(host, gap):
    t = _last.get(host, 0) + gap - time.time()
    if t > 0:
        time.sleep(t)
    _last[host] = time.time()


def robots_ok(url, ua=UA):
    p = urllib.parse.urlsplit(url)
    base = f"{p.scheme}://{p.netloc}"
    if base not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            req = urllib.request.Request(base + "/robots.txt", headers={"User-Agent": ua})
            with urllib.request.urlopen(req, timeout=15) as r:
                rp.parse(r.read().decode("utf-8", "replace").splitlines())
        except Exception:
            rp.parse([])  # no robots.txt reachable: allowed
        _robots[base] = rp
    return _robots[base].can_fetch(ua, url)


def fetch(url, gap=3.0, ua=UA, accept=None, max_bytes=25_000_000, tries=3, check_robots=True):
    """GET with per-host politeness delay, robots.txt check and retries. Returns (bytes, final_url, content_type)."""
    if check_robots and not robots_ok(url, ua):
        raise PermissionError(f"robots.txt disallows {url}")
    host = urllib.parse.urlsplit(url).netloc
    err = None
    for i in range(tries):
        wait_turn(host, gap)
        try:
            h = {"User-Agent": ua, "Accept-Language": "en,it;q=0.8"}
            if accept:
                h["Accept"] = accept
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read(max_bytes + 1)
                if len(data) > max_bytes:
                    raise ValueError("too large")
                return data, r.geturl(), r.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            err = e
            if e.code == 429 or e.code >= 500:
                time.sleep(gap * (4 ** (i + 1)))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, http.client.HTTPException, ConnectionError) as e:
            err = e
            time.sleep(gap * (2 ** (i + 1)))
    raise err


def fetch_json(url, **kw):
    data, _, _ = fetch(url, accept="application/json", **kw)
    return json.loads(data)


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("’", "'").replace("`", "'").lower()
    return s


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", norm(s)).strip("-")


def image_size(b):
    """(width, height, format) from image header bytes, or (0, 0, None)."""
    try:
        if b[:8] == b"\x89PNG\r\n\x1a\n":
            w, h = struct.unpack(">II", b[16:24]); return w, h, "png"
        if b[:2] == b"\xff\xd8":
            i = 2
            while i < len(b) - 9:
                if b[i] != 0xFF:
                    i += 1; continue
                m = b[i + 1]
                if m in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    h, w = struct.unpack(">HH", b[i + 5:i + 9]); return w, h, "jpeg"
                if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
                    i += 2; continue
                i += 2 + struct.unpack(">H", b[i + 2:i + 4])[0]
        if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
            c = b[12:16]
            if c == b"VP8 ":
                w, h = struct.unpack("<HH", b[26:30]); return w & 0x3FFF, h & 0x3FFF, "webp"
            if c == b"VP8L":
                v = int.from_bytes(b[21:25], "little"); return (v & 0x3FFF) + 1, ((v >> 14) & 0x3FFF) + 1, "webp"
            if c == b"VP8X":
                return int.from_bytes(b[24:27], "little") + 1, int.from_bytes(b[27:30], "little") + 1, "webp"
        if b[4:12] in (b"ftypavif", b"ftypheic", b"ftypmif1"):
            j = b.find(b"ispe")
            if j > 0:
                w, h = struct.unpack(">II", b[j + 8:j + 16]); return w, h, "avif"
    except Exception:
        pass
    return 0, 0, None


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
