from PIL import Image
import numpy as np

ref = np.asarray(Image.open(r"C:\Users\adamp\AppData\Roaming\Hermes\composer-images\image_e97507.png").convert("RGB")).astype(np.float32)
cur = np.asarray(Image.open(r"C:\Users\adamp\AppData\Roaming\Hermes\composer-images\image_664a78.png").convert("RGB")).astype(np.float32)

def lum(a):
    return 0.2126*a[...,0]+0.7152*a[...,1]+0.0722*a[...,2]

for name, a in [("REF", ref), ("CUR", cur)]:
    h, w, _ = a.shape
    L = lum(a)
    rows = L.mean(axis=1)
    print(f"--- {name} {w}x{h} mean={L.mean():.1f} max={L.max():.0f}")
    upper = rows[:int(h*0.62)]
    thr = upper.max()*0.72
    ys = [i for i, r in enumerate(upper) if r > thr]
    if ys:
        yc = int(upper.argmax())
        print(f"  ribbon band rows: {ys[0]}..{ys[-1]} ({100*ys[0]/h:.0f}%..{100*ys[-1]/h:.0f}% h, peak row {yc} = {100*yc/h:.0f}%)")
        line = L[max(0,yc-2):yc+3].max(axis=0)
        print(f"  band X-profile: mean={line.mean():.0f} max={line.max():.0f} min={line.min():.0f}")
        print(f"  x-samples: {[int(line[i]) for i in range(0, w, max(1, w//10))]}")
    for fy, fx in [(int(h*0.15), w//2), (int(h*0.45), w//2), (int(h*0.62), w//4), (int(h*0.62), w//2), (int(h*0.82), w//2), (int(h*0.35), w//8)]:
        y, x = min(fy, h-1), min(fx, w-1)
        print(f"  px({x:4d},{y:4d}) = RGB({a[y,x,0]:.0f},{a[y,x,1]:.0f},{a[y,x,2]:.0f})")
    # ring regularity: radial profile from center of lower half
    cy, cx = int(h*0.62), w//2
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot((xx-cx)*1.0, (yy-cy)*1.35)
    pr = [L[(r >= i) & (r < i+2)].mean() for i in range(0, int(h*0.6), 4)]
    print("  radial profile (r step 4):", [int(v) for v in pr])
    print()
