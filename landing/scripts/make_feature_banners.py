from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "landing" / "src" / "assets" / "features"
ICON = ROOT / "frontend" / "src-tauri" / "icons" / "128x128.png"
FONT = "/System/Library/Fonts/SFNS.ttf"
MONO = "/System/Library/Fonts/SFNSMono.ttf"

W, H = 1920, 1080
BG = (4, 9, 12)
CYAN = (34, 211, 220)
WHITE = (244, 247, 248)
MUTED = (145, 160, 166)


def fit_font(text: str, max_width: int, start: int) -> ImageFont.FreeTypeFont:
    size = start
    while size > 28:
        font = ImageFont.truetype(FONT, size)
        if font.getbbox(text)[2] <= max_width:
            return font
        size -= 2
    return ImageFont.truetype(FONT, size)


def make_banner(source: str, output: str, eyebrow: str, lines: list[str], features: str) -> None:
    canvas = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(canvas)

    # Subtle deterministic grid and cyan ambient light.
    for x in range(0, W, 64):
        draw.line((x, 0, x, H), fill=(8, 22, 26), width=1)
    for y in range(0, H, 64):
        draw.line((0, y, W, y), fill=(8, 22, 26), width=1)
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((930, 20, 2110, 1200), fill=(0, 205, 210, 52))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(150)))
    draw = ImageDraw.Draw(canvas)

    # Brand lockup.
    icon = Image.open(ICON).convert("RGBA").resize((76, 76), Image.Resampling.LANCZOS)
    canvas.alpha_composite(icon, (70, 60))
    draw.text((166, 70), "B E A C O N", font=ImageFont.truetype(FONT, 44), fill=WHITE)

    draw.text((72, 235), eyebrow.upper(), font=ImageFont.truetype(MONO, 25), fill=CYAN)
    y = 292
    for index, line in enumerate(lines):
        font = fit_font(line, 590, 76)
        draw.text((70, y), line, font=font, fill=CYAN if index == len(lines) - 1 else WHITE)
        y += font.size + 15

    # Feature capsule.
    feature_font = fit_font(features, 570, 25)
    box = (70, 665, 640, 735)
    draw.rounded_rectangle(box, radius=14, fill=(7, 20, 24, 235), outline=(22, 127, 133), width=2)
    draw.text((94, 686), features, font=feature_font, fill=CYAN)
    draw.text((72, 900), "Open source  /  Windows, macOS & Linux", font=ImageFont.truetype(FONT, 28), fill=WHITE)
    draw.text((72, 950), "github.com/nannndev/beacon", font=ImageFont.truetype(MONO, 22), fill=MUTED)

    # Screenshot is only resized and composited; its UI pixels/content are never redrawn.
    shot = Image.open(ASSETS / source).convert("RGBA")
    target_w = 1170
    target_h = round(shot.height * target_w / shot.width)
    shot = shot.resize((target_w, target_h), Image.Resampling.LANCZOS)
    sx, sy = 700, (H - target_h) // 2
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((sx - 20, sy - 20, sx + target_w + 20, sy + target_h + 20), radius=30, fill=(0, 0, 0, 210))
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(24)))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((sx - 3, sy - 3, sx + target_w + 3, sy + target_h + 3), radius=18, fill=(18, 170, 180), width=1)
    canvas.alpha_composite(shot, (sx, sy))

    output_path = Path(output)
    if not output_path.is_absolute():
        output_path = ASSETS / output_path
    canvas.convert("RGB").save(output_path, quality=95)


make_banner(
    "workspace.png",
    str(ROOT / "assets" / "beacon-feature-banner.png"),
    "Local API testing workspace",
    ["SEND. ASSERT. SCALE.", "API & WEB REQUESTS."],
    "9 test modes  /  Scenario  /  MCP server",
)


make_banner(
    "beacon-real-response-v036.png",
    "beacon-banner-real-response-v036.png",
    "Response testing",
    ["SEE THE RESPONSE.", "PROVE THE BEHAVIOR."],
    "Assertions  •  JSON inspector  •  Auto-extract",
)
make_banner(
    "beacon-real-load-test-v036.png",
    "beacon-banner-real-load-v036.png",
    "Load & rate-limit testing",
    ["TEST THE LIMITS.", "KNOW THE NUMBERS."],
    "Concurrency  •  Live metrics  •  Rate limits",
)
make_banner(
    "beacon-real-mcp-v036.png",
    "beacon-banner-real-mcp-v036.png",
    "Built-in MCP server",
    ["YOUR API WORKSPACE.", "AGENT-READY."],
    "19 MCP tools  •  Run  •  Inspect  •  Organize",
)
