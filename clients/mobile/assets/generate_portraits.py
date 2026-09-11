import os
from math import sin, cos, pi

from PIL import Image, ImageDraw, ImageFilter

root = os.path.dirname(__file__)
avatar_dir = os.path.join(root, 'avatars')
os.makedirs(avatar_dir, exist_ok=True)


def add_noise(draw, box, color, alpha=80):
    pass


def draw_portrait(path, bg1, bg2, skin, hair, shirt, accent, eye_color):
    img = Image.new('RGBA', (160, 160), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background gradient
    for y in range(160):
        t = y / 159
        r = int(bg1[0] * (1 - t) + bg2[0] * t)
        g = int(bg1[1] * (1 - t) + bg2[1] * t)
        b = int(bg1[2] * (1 - t) + bg2[2] * t)
        for x in range(160):
            img.putpixel((x, y), (r, g, b, 255))

    # Soft vignette
    vignette = Image.new('RGBA', (160, 160), (0, 0, 0, 0))
    vdraw = ImageDraw.Draw(vignette)
    vdraw.ellipse((10, 10, 150, 150), fill=(0, 0, 0, 110))
    img = Image.alpha_composite(img, vignette)

    # Shirt/body
    shirt_mask = Image.new('L', (160, 160), 0)
    sdraw = ImageDraw.Draw(shirt_mask)
    sdraw.ellipse((30, 88, 130, 160), fill=255)
    shirt_img = Image.new('RGBA', (160, 160), (0, 0, 0, 0))
    sdraw2 = ImageDraw.Draw(shirt_img)
    sdraw2.ellipse((30, 88, 130, 160), fill=shirt)
    img = Image.alpha_composite(img, shirt_img)

    # Neck and head
    neck = (68, 105, 92, 138)
    draw.rectangle(neck, fill=skin)

    # Face
    head = (38, 34, 122, 114)
    draw.ellipse(head, fill=skin)

    # Hair
    hair_top = (40, 28, 120, 80)
    draw.ellipse(hair_top, fill=hair)
    draw.rounded_rectangle((32, 28, 128, 84), radius=18, fill=hair)
    draw.rectangle((42, 30, 118, 70), fill=hair)

    # Ears
    draw.ellipse((27, 72, 34, 92), fill=skin)
    draw.ellipse((126, 72, 133, 92), fill=skin)

    # Eyes
    eye_y = 68
    eye_r = 3
    eye_left = (60, eye_y)
    eye_right = (98, eye_y)
    draw.ellipse((eye_left[0]-eye_r, eye_left[1]-eye_r, eye_left[0]+eye_r, eye_left[1]+eye_r), fill=eye_color)
    draw.ellipse((eye_right[0]-eye_r, eye_right[1]-eye_r, eye_right[0]+eye_r, eye_right[1]+eye_r), fill=eye_color)

    # Nose and mouth
    draw.line((80, 78, 80, 86), fill=(165, 112, 84), width=2)
    draw.arc((68, 90, 92, 110), 0, 180, fill=(160, 95, 90), width=2)

    # Cheeks and brows
    draw.arc((52, 62, 70, 72), 190, 350, fill=(0, 0, 0, 50), width=2)
    draw.arc((90, 62, 108, 72), 190, 350, fill=(0, 0, 0, 50), width=2)

    # Forehead highlight
    draw.ellipse((58, 40, 75, 52), fill=(255, 255, 255, 24))

    # subtle portrait shadow
    shadow = Image.new('RGBA', (160, 160), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.ellipse((38, 32, 122, 118), outline=(0, 0, 0, 70), width=2)
    img = Image.alpha_composite(img, shadow)

    # subtle border around portrait
    border = Image.new('RGBA', (160, 160), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(border)
    bdraw.rounded_rectangle((8, 8, 152, 152), radius=18, outline=(255, 255, 255, 40), width=2)
    img = Image.alpha_composite(img, border)

    img = img.resize((160, 160), Image.Resampling.LANCZOS)
    img.save(path)


configs = [
    ('profile.png', ((48, 92, 175), (18, 36, 72), (240, 188, 120), (26, 26, 34), (30, 78, 168), (72, 144, 255), (32, 38, 52))),
    ('michael.png', ((66, 116, 205), (21, 39, 70), (233, 178, 110), (20, 22, 30), (32, 72, 176), (78, 163, 255), (17, 20, 24))),
    ('ama.png', ((88, 166, 112), (18, 40, 54), (225, 182, 130), (34, 44, 44), (37, 110, 80), (78, 183, 128), (37, 38, 38))),
    ('david.png', ((52, 92, 160), (16, 28, 52), (216, 171, 116), (24, 18, 22), (26, 72, 132), (72, 149, 242), (21, 22, 26))),
    ('p1.png', ((112, 88, 175), (15, 28, 52), (227, 180, 123), (30, 28, 32), (62, 98, 168), (90, 142, 255), (17, 22, 28))),
    ('p2.png', ((65, 108, 198), (22, 42, 72), (236, 184, 124), (26, 30, 38), (42, 90, 164), (90, 142, 255), (18, 24, 32))),
    ('p3.png', ((88, 154, 120), (18, 40, 54), (224, 174, 120), (30, 38, 36), (54, 110, 92), (108, 192, 142), (23, 28, 34))),
    ('p4.png', ((82, 118, 204), (12, 34, 62), (232, 179, 120), (20, 20, 34), (43, 92, 178), (86, 140, 255), (18, 24, 30))),
    ('placeholder.png', ((19, 44, 82), (10, 24, 48), (205, 170, 120), (30, 30, 38), (48, 94, 148), (134, 160, 255), (10, 14, 20))),
]

for filename, palette in configs:
    draw_portrait(os.path.join(avatar_dir, filename), *palette)

print(f'Created {len(configs)} portrait assets in {avatar_dir}')
