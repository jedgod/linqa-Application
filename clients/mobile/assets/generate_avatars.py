import os
import struct
import zlib

root = os.path.dirname(__file__)
avatar_dir = os.path.join(root, "avatars")
os.makedirs(avatar_dir, exist_ok=True)


def write_png(path: str, width: int, height: int, base: tuple[int, int, int], accent: tuple[int, int, int]) -> None:
    pixels = []
    for y in range(height):
        for x in range(width):
            r, g, b = base
            if width * 0.18 < x < width * 0.82 and height * 0.18 < y < height * 0.82:
                r, g, b = accent
            pixels.extend((r, g, b, 255))

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack("!I", len(payload))
            + tag
            + payload
            + struct.pack("!I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * width * 4 : (y + 1) * width * 4])

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack("!IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


configs = {
    "profile.png": ((40, 117, 246), (244, 192, 106)),
    "michael.png": ((62, 100, 255), (224, 157, 91)),
    "ama.png": ((82, 201, 148), (253, 204, 125)),
    "david.png": ((34, 94, 180), (249, 180, 98)),
    "p1.png": ((255, 126, 86), (244, 200, 134)),
    "p2.png": ((118, 136, 255), (255, 212, 143)),
    "p3.png": ((63, 183, 116), (255, 185, 130)),
    "p4.png": ((90, 128, 242), (252, 214, 144)),
}

for name, (base, accent) in configs.items():
    write_png(os.path.join(avatar_dir, name), 160, 160, base, accent)

print(f"Created {len(configs)} avatar assets in {avatar_dir}")
