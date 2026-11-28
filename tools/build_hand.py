"""Build a skinned right hand (with a short piece of forearm) from the MakeHuman base mesh and default rig (CC0).

Output: hand-r.bin (positions f32x3, skin indices u8x4, skin weights u8x4 normalised, tags u8x4 (nail, crease, palm,
        hair), triangle indices u32, detail f32x4 (nail u, nail v, crease t, crease weight))
        hand-r.json (counts, bones in the hand frame, anatomy for the IK), all in white-key units (23.5 mm).
The hand frame: origin at the middle finger's knuckle, x toward the little finger, y up (back of the hand), z back
toward the wrist.
"""
import json, sys, numpy as np

SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = sys.argv[2] if len(sys.argv) > 2 else '.'
LEVELS = int(sys.argv[3]) if len(sys.argv) > 3 else 2

V, F, cur = [], [], None
for line in open(f'{SRC}/base.obj'):
    if line.startswith('v '): V.append([float(x) for x in line.split()[1:4]])
    elif line.startswith('g '): cur = line.split()[1]
    elif line.startswith('f ') and cur == 'body': F.append([int(t.split('/')[0]) - 1 for t in line.split()[1:]])
V = np.array(V); F = np.array(F)
skel = json.load(open(f'{SRC}/default.mhskel'))
W = json.load(open(f'{SRC}/default_weights.mhw'))['weights']
J = {k: V[v].mean(0) for k, v in skel['joints'].items()}

BONES = ['lowerarm02', 'wrist'] + [f'metacarpal{i}' for i in range(1, 5)] + [f'finger{f}-{s}' for f in range(1, 6) for s in range(1, 4)]
idx = {b: i for i, b in enumerate(BONES)}
head = lambda b: J[skel['bones'][b + '.R']['head']]
tail = lambda b: J[skel['bones'][b + '.R']['tail']]

# weights: our bones; anything else on the arm goes to the forearm
nv = len(V)
WM = np.zeros((nv, len(BONES)))
for b, lst in W.items():
    if not b.endswith('.R'): continue
    name = b[:-2]
    col = idx.get(name, 0 if name.startswith(('lowerarm', 'upperarm', 'elbow', 'shoulder', 'clavicle')) else None)
    if col is None: continue
    for i, x in lst: WM[i, col] += x
tot = WM.sum(1)

# keep the hand and about 10 cm of forearm
wr = head('wrist'); el = head('lowerarm02'); ax = (el - wr) / np.linalg.norm(el - wr)
along = (V - wr) @ ax
keepv = (tot > 0.95) & (along < 1.0) & (V[:, 0] < -2.0)
F = F[keepv[F].all(1)]
used = np.unique(F); remap = -np.ones(nv, int); remap[used] = np.arange(len(used))
P = V[used]; WM = WM[used] / WM[used].sum(1, keepdims=True); F = remap[F]
print('base', len(P), 'verts', len(F), 'quads')

def subdivide(P, A, F):
    """Catmull-Clark on a quad mesh with open boundaries; A = extra attributes carried along linearly."""
    X = np.hstack([P, A]); nv = len(X); nf = len(F)
    e = np.stack([F, np.roll(F, -1, 1)], 2).reshape(-1, 2); es = np.sort(e, 1)
    uniq, inv, cnt = np.unique(es, axis=0, return_inverse=True, return_counts=True)
    inv = inv.reshape(nf, 4); ne = len(uniq)
    fp = X[F].mean(1)
    # edge points
    efs = np.zeros((ne, X.shape[1])); np.add.at(efs, inv.reshape(-1), np.repeat(fp, 4, 0))
    mid = (X[uniq[:, 0]] + X[uniq[:, 1]]) / 2
    bnd = cnt == 1
    ep = np.where(bnd[:, None], mid, (X[uniq[:, 0]] + X[uniq[:, 1]] + efs) / np.maximum(cnt, 1)[:, None] / 1.0)
    ep[~bnd] = (X[uniq[~bnd, 0]] + X[uniq[~bnd, 1]] + efs[~bnd]) / 4
    # vertex points
    Q = np.zeros_like(X); qn = np.zeros(nv); np.add.at(Q, F.reshape(-1), np.repeat(fp, 4, 0)); np.add.at(qn, F.reshape(-1), 1)
    R = np.zeros_like(X); val = np.zeros(nv)
    for c in (0, 1): np.add.at(R, uniq[:, c], mid); np.add.at(val, uniq[:, c], 1)
    n = val
    vp = (Q / qn[:, None] + 2 * R / n[:, None] + (n - 3)[:, None] * X) / n[:, None]
    bv = np.zeros(nv, bool); bv[uniq[bnd].reshape(-1)] = True
    Bs = np.zeros_like(X); np.add.at(Bs, uniq[bnd, 0], X[uniq[bnd, 1]]); np.add.at(Bs, uniq[bnd, 1], X[uniq[bnd, 0]])
    vp[bv] = 0.75 * X[bv] + 0.125 * Bs[bv]
    NX = np.vstack([vp, ep, fp])
    E0, FP0 = nv, nv + ne
    nf2 = []
    for k in range(4):
        nf2.append(np.stack([F[:, k], E0 + inv[:, k], FP0 + np.arange(nf), E0 + inv[:, (k - 1) % 4]], 1))
    return NX[:, :3], NX[:, 3:], np.vstack(nf2)

for _ in range(LEVELS): P, WM, F = subdivide(P, WM, F)
print('subdivided', len(P), 'verts', len(F), 'quads')

# the hand frame (MakeHuman decimetres -> white keys); scaled so wrist crease to middle fingertip is 8.3 keys (19.5 cm)
O = head('finger3-1')
xa = head('finger5-1') - head('finger2-1'); xa /= np.linalg.norm(xa)
fwd = O - head('wrist'); za = -fwd; za -= xa * (za @ xa); za /= np.linalg.norm(za)
ya = np.cross(za, xa)
hand_len = np.linalg.norm(tail('finger3-3') - head('wrist'))
S = 8.3 / hand_len
Mh = np.stack([xa, ya, za])          # rows: world(mh) -> hand
toH = lambda p: (np.asarray(p) - O) @ Mh.T * S
P = toH(P)
# slimmer, more defined fingers (the base mesh's are a little puffy)
for f in range(1, 6):
    for s in range(1, 4):
        b = f'finger{f}-{s}'; h, t = toH(head(b)), toH(tail(b)); d = t - h; L = np.linalg.norm(d); d /= L
        w = WM[:, idx[b]][:, None]
        q = P - h; along_ = q @ d; rad = q - np.outer(along_, d)
        P = P - w * rad * 0.04

# rest normals (for the nail raise, hair, which side faces up)
def vnormals(P, F):
    N = np.zeros_like(P)
    for a, b, c in ((0, 1, 2), (0, 2, 3)):
        fn = np.cross(P[F[:, b]] - P[F[:, a]], P[F[:, c]] - P[F[:, a]])
        for k in (a, b, c): np.add.at(N, F[:, k], fn)
    return N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-12)
NRM = vnormals(P, F)

# tags: r = nail, g = crease/knuckle redness, b = palm side, a = hair density
tags = np.zeros((len(P), 4))
for f in range(1, 6):
    b = f'finger{f}-3'; h, t = toH(head(b)), toH(tail(b)); d = t - h; L = np.linalg.norm(d); d /= L
    up = np.array([0, 1, 0.]) if f > 1 else np.array([-0.55, 0.83, 0.])
    up = up - d * (up @ d); up /= np.linalg.norm(up)
    q = P - h; a = (q @ d) / L; rad = q - np.outer(q @ d, d); rn = np.linalg.norm(rad, axis=1) + 1e-9
    c = (rad @ up) / rn
    w = WM[:, idx[b]]
    m = np.clip((c - 0.45) / 0.25, 0, 1) * np.clip((a - 0.38) / 0.12, 0, 1) * np.clip((1.12 - a) / 0.1, 0, 1) * np.clip((w - 0.5) / 0.3, 0, 1)
    tags[:, 0] = np.maximum(tags[:, 0], m)
for f in range(1, 6):
    for s in (2, 3):
        b = f'finger{f}-{s}'; h = toH(head(b))
        dd = np.linalg.norm(P - h, axis=1)
        tags[:, 1] = np.maximum(tags[:, 1], np.exp(-(dd / 0.28) ** 2))
    h = toH(head(f'finger{f}-1')); dd = np.linalg.norm(P - h, axis=1)
    tags[:, 1] = np.maximum(tags[:, 1], 0.7 * np.exp(-(dd / 0.45) ** 2))
tags[:, 2] = np.clip(-(P[:, 1] + 0.1) / 0.5, 0, 1) * (P[:, 2] > -0.3)

# detail: nail (u from the cuticle to the free edge, v across), knuckle creases (t along the finger from the joint,
# weight on the back of the finger)
detail = np.zeros((len(P), 4)); detail[:, 0] = -1
for f in range(1, 6):
    b = f'finger{f}-3'; h, t = toH(head(b)), toH(tail(b)); d = t - h; L = np.linalg.norm(d); d /= L
    up = np.array([0, 1, 0.]) if f > 1 else np.array([-0.55, 0.83, 0.])
    up = up - d * (up @ d); up /= np.linalg.norm(up); side = np.cross(d, up)
    q = P - h; a = (q @ d) / L; rad = q - np.outer(q @ d, d); rn = np.linalg.norm(rad, axis=1) + 1e-9
    w = WM[:, idx[b]]
    sel = (w > 0.5) & ((rad @ up) / rn > 0.2) & (a > 0.3)
    detail[sel, 0] = np.clip((a[sel] - 0.4) / 0.64, -0.2, 1.2)
    detail[sel, 1] = (rad[sel] @ side) / rn[sel]
best = np.full(len(P), 9.0)
joints = [(f'finger{f}-{s}', f'finger{f}-{s}') for f in range(1, 6) for s in (2, 3)] + [(f'finger{f}-1', f'finger{f}-1') for f in range(2, 6)]
for jb, db in joints:
    Jp = toH(head(jb)); d = toH(tail(db)) - Jp; d /= np.linalg.norm(d)
    f = int(jb[6])
    up = np.array([0, 1, 0.]) if f > 1 else np.array([-0.55, 0.83, 0.]); up = up - d * (up @ d); up /= np.linalg.norm(up)
    q = P - Jp; tt = q @ d; rad = q - np.outer(tt, d); rn = np.linalg.norm(rad, axis=1) + 1e-9
    dist = np.abs(tt) + 0.5 * np.maximum(0, rn - 0.5)
    m = dist < best
    best[m] = dist[m]
    dors = np.clip(((rad @ up) / rn - 0.1) / 0.5, 0, 1)
    detail[m, 2] = tt[m]
    detail[m, 3] = dors[m] * np.exp(-(tt[m] / (0.3 if jb.endswith('-1') else 0.22)) ** 2)

# hair: thick on the forearm, lighter on the back of the hand and the first finger bones, none on the palm or tips
upn = NRM[:, 1]
fore = np.clip((P[:, 2] - 3.6) / 0.8, 0, 1) * np.clip((upn + 0.55) / 0.5, 0, 1)
backh = np.clip((P[:, 2] - 0.9) / 0.8, 0, 1) * np.clip((upn - 0.25) / 0.4, 0, 1) * 0.42
prox = sum(WM[:, idx[f'finger{f}-1']] for f in range(2, 6)) * np.clip((upn - 0.4) / 0.4, 0, 1) * 0.3 * (detail[:, 3] < 0.5)
tags[:, 3] = np.clip(np.maximum(np.maximum(fore, backh), prox), 0, 1) * (1 - tags[:, 2])

# the nails stand a little proud of the skin
P = P + NRM * (0.028 * np.clip(tags[:, 0] * 1.6 - 0.3, 0, 1))[:, None]

# top-4 skin weights
order = np.argsort(-WM, 1)[:, :4]
ww = np.take_along_axis(WM, order, 1); ww /= ww.sum(1, keepdims=True)
wq = np.round(ww * 255).astype(int); wq[:, 0] += 255 - wq.sum(1)
tri = np.vstack([F[:, [0, 1, 2]], F[:, [0, 2, 3]]]).astype(np.uint32)

with open(f'{OUT}/hand-r.bin', 'wb') as fo:
    fo.write(P.astype(np.float32).tobytes())
    fo.write(order.astype(np.uint8).tobytes())
    fo.write(wq.astype(np.uint8).tobytes())
    fo.write(np.round(tags * 255).astype(np.uint8).tobytes())
    fo.write(tri.tobytes())
    fo.write(detail.astype(np.float32).tobytes())
parent = {'lowerarm02': None, 'wrist': 'lowerarm02', 'metacarpal1': 'wrist', 'metacarpal2': 'wrist', 'metacarpal3': 'wrist', 'metacarpal4': 'wrist', 'finger1-1': 'wrist'}
for f in range(2, 6): parent[f'finger{f}-1'] = f'metacarpal{f - 1}'
for f in range(1, 6): parent[f'finger{f}-2'] = f'finger{f}-1'; parent[f'finger{f}-3'] = f'finger{f}-2'
bones = [{'name': b, 'head': toH(head(b)).round(4).tolist(), 'tail': toH(tail(b)).round(4).tolist(), 'parent': parent[b]} for b in BONES]
seg = [[round(float(np.linalg.norm(toH(tail(f'finger{f}-{s}')) - toH(head(f'finger{f}-{s}')))), 4) for s in (1, 2, 3)] for f in range(1, 6)]
info = {'source': 'MakeHuman 1.x base mesh and default rig/weights (CC0 1.0, makehumancommunity/makehuman)', 'verts': len(P), 'tris': len(tri), 'bones': bones,
        'anatomy': {'mcp': [toH(head(f'finger{f}-1')).round(4).tolist() for f in range(1, 6)], 'cmc': toH(head('finger1-1')).round(4).tolist(),
                    'wrist': toH(head('wrist')).round(4).tolist(), 'seg': seg}}
json.dump(info, open(f'{OUT}/hand-r.json', 'w'), indent=1)
print(json.dumps(info['anatomy']))
print('bbox', P.min(0).round(2), P.max(0).round(2), 'scale', S)

# ---- hair: thin tapered strands rooted in the skin, leaning toward the fingers, each skinned like the skin it grows from
rng = np.random.default_rng(7)
NRM2 = vnormals(P, F)
TF = np.vstack([F[:, [0, 1, 2]], F[:, [0, 2, 3]]])
A_ = P[TF[:, 1]] - P[TF[:, 0]]; B_ = P[TF[:, 2]] - P[TF[:, 0]]
area = np.linalg.norm(np.cross(A_, B_), axis=1) / 2
dens = tags[TF, 3].mean(1) ** 1.5
prob = area * dens; prob /= prob.sum()
NH = 2200
pick = rng.choice(len(TF), NH, p=prob)
r1, r2 = rng.random(NH), rng.random(NH)
flip = r1 + r2 > 1; r1[flip], r2[flip] = 1 - r1[flip], 1 - r2[flip]
bary = np.stack([1 - r1 - r2, r1, r2], 1)
tv = TF[pick]
root = (P[tv] * bary[:, :, None]).sum(1)
nr = (NRM2[tv] * bary[:, :, None]).sum(1); nr /= np.linalg.norm(nr, axis=1, keepdims=True)
dmask = (tags[tv, 3] * bary).sum(1)
comb = np.array([0, 0, -1.0]) + rng.normal(0, 0.35, (NH, 3))
comb -= nr * (comb * nr).sum(1, keepdims=True); comb /= np.linalg.norm(comb, axis=1, keepdims=True)
fore = root[:, 2] > 4.0
L = np.where(fore, 0.22 + 0.2 * rng.random(NH), 0.1 + 0.12 * rng.random(NH)) * (0.6 + 0.4 * dmask)
side = np.cross(comb, nr)
K = 4  # points along a hair
ts = np.linspace(0, 1, K)
lift = np.array([0, 0.16, 0.17, 0.1])
curl = rng.normal(0, 0.25, NH)
hv, huv, hidx, hsi, hsw = [], [], [], [], []
best = bary.argmax(1); bvert = tv[np.arange(NH), best]
for h in range(NH):
    for k in range(K):
        c = root[h] + comb[h] * L[h] * ts[k] + nr[h] * L[h] * lift[k] + side[h] * L[h] * curl[h] * ts[k] ** 2 * 0.3
        w = (0.0042 - 0.003 * ts[k])
        hv.append(c - side[h] * w); hv.append(c + side[h] * w)
        huv.append([0, ts[k]]); huv.append([1, ts[k]])
    b = h * K * 2
    for k in range(K - 1):
        i0 = b + k * 2; hidx += [i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2]
hv = np.array(hv, np.float32); huv = np.array(huv, np.float32); hidx = np.array(hidx, np.uint32)
hsi = np.repeat(order[bvert], K * 2, 0).astype(np.uint8); hsw = np.repeat(wq[bvert], K * 2, 0).astype(np.uint8)
hn = np.repeat(nr, K * 2, 0).astype(np.float32)
with open(f'{OUT}/hair-r.bin', 'wb') as fo:
    for arr in (hv, hn, huv, hsi, hsw, hidx): fo.write(arr.tobytes())
json.dump({'verts': len(hv), 'tris': len(hidx) // 3, 'hairs': NH}, open(f'{OUT}/hair-r.json', 'w'))
print('hair', NH, 'strands', len(hv), 'verts')
