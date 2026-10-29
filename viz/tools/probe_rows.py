from PIL import Image
import numpy as np
cur = np.asarray(Image.open(r"C:\Users\adamp\Documents\GitHub\audioviz\viz\tools\shot_after.png").convert("RGB")).astype(np.float32)
h, w, _ = cur.shape
print("size", w, h)
def lum(a): return 0.2126*a[...,0]+0.7152*a[...,1]+0.0722*a[...,2]
L = lum(cur)
rows = L.mean(axis=1)
for k in range(20):
    y = int(h*k/20)
    band = L[y:y+max(1,h//20)]
    print(f"row {y:4d} ({100*k/20:.0f}%): mean={rows[y]:.0f}  RGB=({band[...,0].mean():.0f},{band[...,1].mean():.0f},{band[...,2].mean():.0f})")
# find the most saturated warm pixels (ribbon = orange-gold)
warm = (cur[...,0] > cur[...,2] + 30) & (cur[...,0] > 80)
ys, xs = np.where(warm)
if len(ys):
    print(f"warm px count={len(ys)} rows: {np.percentile(ys, 10):.0f}..{np.percentile(ys, 90):.0f} (median {np.median(ys):.0f} = {100*np.median(ys)/h:.0f}%)")
# top bright band check
top = L[:int(h*0.25)]
print("top-25% mean:", top.mean(), "max:", top.max())
mid = L[int(h*0.4):int(h*0.6)]
print("mid 40-60% mean:", mid.mean(), "max:", mid.max())
