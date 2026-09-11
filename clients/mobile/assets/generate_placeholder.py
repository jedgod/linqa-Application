import os, struct, zlib

root = os.path.dirname(__file__)
path = os.path.join(root, 'avatars', 'placeholder.png')
os.makedirs(os.path.dirname(path), exist_ok=True)

width = 160
height = 160
base = (18, 42, 82)
accent = (122, 150, 255)

pixels = []
for y in range(height):
    for x in range(width):
        r, g, b = base
        if 18 < x < width - 18 and 18 < y < height - 18:
            r, g, b = accent
        pixels.extend((r, g, b, 255))

raw = bytearray()
for y in range(height):
    raw.append(0)
    raw.extend(pixels[y * width * 4 : (y + 1) * width * 4])


def chunk(tag, payload):
    return struct.pack('!I', len(payload)) + tag + payload + struct.pack('!I', zlib.crc32(tag + payload) & 0xffffffff)

png = b'\x89PNG\r\n\x1a\n'
png += chunk(b'IHDR', struct.pack('!IIBBBBB', width, height, 8, 6, 0, 0, 0))
png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
png += chunk(b'IEND', b'')
with open(path, 'wb') as f:
    f.write(png)

print(f'Created {path}')
