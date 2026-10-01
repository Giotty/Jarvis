from PIL import Image, ImageDraw
from pathlib import Path
root = Path(__file__).resolve().parents[1] / 'assets'
image = Image.new('RGBA', (256, 256), (5, 18, 30, 255))
d = ImageDraw.Draw(image)
d.ellipse((18, 18, 238, 238), outline=(82, 220, 248), width=5)
d.arc((36, 36, 220, 220), 15, 290, fill=(47, 122, 161), width=8)
d.ellipse((56, 56, 200, 200), outline=(103, 229, 247), width=2)
d.line([(146, 76), (146, 153), (136, 172), (108, 172), (94, 158)], fill=(197, 247, 255), width=13)
image.save(root / 'icon.png')
image.save(root / 'icon.ico', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
