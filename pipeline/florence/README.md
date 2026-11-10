# Florence restaurant asset pipeline

Builds a reviewed set of Florence restaurant assets (facts, the evidence for each pick, and
high quality photos with their source and owner). Claude in the TravelBuddy project thread is the
orchestrator: it reads the evidence, makes the picks and judges the photos itself, so the pipeline
makes no paid LLM API calls. Scripts only do the mechanical work: fetching, counting, downloading.

Fetching runs on joe's Mac because the cloud sandbox can't reach Reddit or restaurant sites.

| Stage | Script | Runs on | Output |
|---|---|---|---|
| 1. Harvest what people say | `harvest_reddit.py` | Mac | `out/reddit/posts.json`, `comments.jsonl` |
| 2. Count mentions, gather evidence | `mentions.py` + Claude's judgement | cloud | `evidence/`, `picks.json` |
| 3. Collect photos | `scrape_sites.py` | Mac | `out/images/<slug>/` + `manifest.json`, `out/previews/` |
| 4. Judge photos, write the assets | `contact_sheets.py` + Claude's judgement | cloud | `/mnt/project-files/florence-assets/` |

Stage 1 uses Reddit's official Data API (a free "script" app from https://www.reddit.com/prefs/apps,
credentials in `~/.travelbuddy-reddit.env`), because Reddit's robots.txt forbids crawling the site.
Stage 3 checks every site's robots.txt and waits 3 s between pages on a host.

Raw data travels from the Mac to the cloud on the `florence-assets-raw` branch (text plus 1400px
previews only; originals stay on the Mac). That branch is never merged into `main`.

Photo rights: images from restaurant sites and Reddit belong to their owners. Each manifest entry
records `owner`, `licence`, `image_url` and `page_url` so permission can be sorted out before the
app shows a photo publicly. Wikimedia Commons photos carry their free licence and author.
