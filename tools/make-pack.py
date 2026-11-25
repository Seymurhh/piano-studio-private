"""Make a sound pack for the studio (assets/sounds/<name>.pack) from a folder of MP3 notes named like the FluidR3 GM notes
of the npm package soundfont-for-samplers (A0.mp3, Bb0.mp3, ... C8.mp3). Every third note from A0 (MIDI 21) to C8 (108) is
kept, as in the other FluidR3 packs; the studio plays the notes between by shifting the nearest one. The MP3 files are
copied unchanged.

Format: 4 bytes (length of the index, little-endian), a JSON index {files:[{p: MIDI pitch, l: loudness layer, o: offset,
n: bytes}]}, then the MP3 files end to end.

usage: python3 tools/make-pack.py <folder of mp3 notes> <out.pack>
"""
import sys, os, json, struct

NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']


def note_file(folder, p):
    return os.path.join(folder, f'{NAMES[p % 12]}{p // 12 - 1}.mp3')


if __name__ == '__main__':
    folder, out = sys.argv[1], sys.argv[2]
    files, blobs, off = [], [], 0
    for p in range(21, 109, 3):
        f = note_file(folder, p)
        if not os.path.exists(f): sys.exit(f'missing {f}')
        b = open(f, 'rb').read()
        if b[:3] != b'ID3' and not (b[0] == 0xFF and (b[1] & 0xE0) == 0xE0): sys.exit(f'not an MP3: {f}')
        files.append({'p': p, 'l': 0, 'o': off, 'n': len(b)}); blobs.append(b); off += len(b)
    head = json.dumps({'files': files}, separators=(',', ':')).encode()
    with open(out, 'wb') as fh:
        fh.write(struct.pack('<I', len(head))); fh.write(head)
        for b in blobs: fh.write(b)
    print(f'{out}: {len(files)} notes, {os.path.getsize(out) / 1e6:.2f} MB')
