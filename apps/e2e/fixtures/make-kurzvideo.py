from PIL import Image, ImageDraw
import sys, io
W, H, FPS, SECS = 320, 180, 10, 18
out = sys.stdout.buffer
for i in range(FPS * SECS):
    t = i / FPS
    img = Image.new("RGB", (W, H), (18, 24, 38))
    d = ImageDraw.Draw(img)
    # A bar that fills over the whole clip, so a human looking at a trace can
    # see how far the player actually got.
    d.rectangle([10, H - 30, 10 + int((W - 20) * (i + 1) / (FPS * SECS)), H - 12],
                fill=(90, 190, 140))
    d.text((12, 12), "DS Test", fill=(235, 240, 250))
    d.text((12, 34), "%.1fs / %ds" % (t, SECS), fill=(160, 180, 210))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    out.write(buf.getvalue())
