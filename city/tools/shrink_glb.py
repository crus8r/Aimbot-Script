"""Downscale the textures inside a .glb so showcase-grade assets fit a web page.

Khronos sample models ship 2-4K PBR textures (a refrigerator is 10MB). At the
size a prop occupies on screen here, 512-1024px is indistinguishable and the
file drops ~10x. Geometry is untouched.

usage: python3 tools/shrink_glb.py in.glb out.glb [max_px] [jpeg_quality]
"""
import io, json, struct, sys
from PIL import Image

def main(src, dst, max_px=1024, q=85):
    data = open(src, 'rb').read()
    magic, version, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67, 'not a glb'
    off = 12
    chunks = []
    while off < length:
        clen, ctype = struct.unpack_from('<II', data, off)
        chunks.append((ctype, data[off + 8: off + 8 + clen]))
        off += 8 + clen
    gltf = json.loads(chunks[0][1])
    binc = chunks[1][1] if len(chunks) > 1 else b''
    views = gltf['bufferViews']
    image_views = {}
    for i, img in enumerate(gltf.get('images', [])):
        if 'bufferView' in img:
            image_views[img['bufferView']] = i
    new_bin = bytearray()
    for vi, v in enumerate(views):
        raw = binc[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
        if vi in image_views:
            img = gltf['images'][image_views[vi]]
            im = Image.open(io.BytesIO(raw))
            has_alpha = im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info)
            scale = min(1.0, max_px / max(im.size))
            if scale < 1.0:
                im = im.resize((max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))), Image.LANCZOS)
            out = io.BytesIO()
            if has_alpha:
                im.save(out, 'PNG', optimize=True)
                img['mimeType'] = 'image/png'
            else:
                im.convert('RGB').save(out, 'JPEG', quality=q, optimize=True)
                img['mimeType'] = 'image/jpeg'
            raw = out.getvalue()
        while len(new_bin) % 4:
            new_bin.append(0)
        v['byteOffset'] = len(new_bin)
        v['byteLength'] = len(raw)
        new_bin += raw
    while len(new_bin) % 4:
        new_bin.append(0)
    gltf['buffers'][0]['byteLength'] = len(new_bin)
    # KTX/webp extensions are not used by these assets; nothing else to rewrite.
    js = json.dumps(gltf, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    total = 12 + 8 + len(js) + 8 + len(new_bin)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(new_bin), 0x004E4942)); f.write(new_bin)
    print(f'{src}: {len(data)/1e6:.1f}MB -> {total/1e6:.2f}MB')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1024, int(sys.argv[4]) if len(sys.argv) > 4 else 85)
