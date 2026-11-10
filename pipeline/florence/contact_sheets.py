"""Stage 4 helper: numbered contact sheets of each restaurant's candidate photos so Claude can judge them.
Usage: python3 contact_sheets.py <previews_dir> <out_dir>   (needs Pillow)"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont, ImageOps

TILE, COLS, PER = 360, 4, 16


def main(src, dst):
    os.makedirs(dst, exist_ok=True)
    font = ImageFont.load_default(size=18)
    for slug in sorted(os.listdir(src)):
        mp = os.path.join(src, slug, "manifest.json")
        if not os.path.exists(mp):
            continue
        man = json.load(open(mp))
        for page in range(0, len(man), PER):
            chunk = man[page:page + PER]
            rows = (len(chunk) + COLS - 1) // COLS
            sheet = Image.new("RGB", (COLS * TILE, rows * (TILE + 26)), "white")
            d = ImageDraw.Draw(sheet)
            for i, e in enumerate(chunk):
                p = os.path.join(src, slug, os.path.splitext(e["file"])[0] + ".jpg")
                if not os.path.exists(p):
                    continue
                im = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
                im.thumbnail((TILE - 6, TILE - 6))
                x, y = (i % COLS) * TILE, (i // COLS) * (TILE + 26)
                sheet.paste(im, (x + (TILE - im.width) // 2, y + (TILE - im.height) // 2))
                d.text((x + 4, y + TILE + 2), f"#{page + i} {e['source_type'][:10]} {e['width']}x{e['height']}", fill="black", font=font)
            sheet.save(os.path.join(dst, f"{slug}-{page // PER}.jpg"), quality=80)
            print(slug, page // PER, len(chunk))


if __name__ == "__main__":
    main(*sys.argv[1:3])
