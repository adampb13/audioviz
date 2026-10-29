from PIL import Image
import numpy as np
ref = np.asarray(Image.open(r"C:\Users\adamp\AppData\Roaming\Hermes\composer-images\image_e97507.png").convert("RGB")).astype(np.float32)
cur = np.asarray(Image.open(r"C:\Users\adamp\Documents\GitHub\audioviz\viz\tools\shot_after.png").convert("RGB")).astype(np.float32)
def lum(a): return 0.2126*a[...,0]+0.7152*a[...,1]+0.0722*a[...,2]
for name, a in [("REF", ref), ("CUR", cur)]:
    h, w, _ = a.shape
    L = lum(a); rows = L.mean(axis=1)
    upper = rows[:int(h*0.65)]; thr = upper.max()*0.75
    ys = [i for i, r in enumerate(upper) if r > thr]
    yc = int(upper.argmax())
    line = L[max(0,yc-2):yc+3].max(axis=0); sm = np.convolve(line, np.ones(9)/9, mode='same')
    print(f"=== {name} {w}x{h}")
    print(f"  ribbon rows {ys[0]}..{ys[-1]} = {100*ys[0]/h:.0f}%..{100*ys[-1]/h:.0f}% h (peak {100*yc/h:.0f}%), th {100*(ys[-1]-ys[0])/h:.0f}% h")
    print(f"  X-profile mean={sm.mean():.0f} max={sm.max():.0f} min={sm.min():.0f}")
    print(f"  row means (10%): {[int(rows[int(h*k/10)]) for k in range(10)]}")
    cy, cx = int(h*0.62), w//2
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot((xx-cx)*1.0, (yy-cy)*1.35)
    pr = [L[(r >= i) & (r < i+2)].mean() for i in range(0, int(h*0.7), 4)]
    print(f"  floor radial: {[int(v) for v in pr[:20]]} ... {[int(v) for v in pr[40:60]]}")
