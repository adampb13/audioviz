from PIL import Image
import numpy as np
ref = np.asarray(Image.open(r"C:\Users\adamp\AppData\Roaming\Hermes\composer-images\image_e97507.png").convert("RGB")).astype(np.float32)
cur = np.asarray(Image.open(r"C:\Users\adamp\Documents\GitHub\audioviz\viz\tools\shot_after.png").convert("RGB")).astype(np.float32)
def lum(a): return 0.2126*a[...,0]+0.7152*a[...,1]+0.0722*a[...,2]

# ribbon: warm pixels (R >> B), horizontal profile at their median row
for name, a in [("REF", ref), ("CUR", cur)]:
    h, w, _ = a.shape
    warm = (a[...,0] > a[...,2] + 30) & (a[...,0] > 80)
    ys, xs = np.where(warm)
    yc = int(np.median(ys))
    band = a[yc-8:yc+8]
    warmband = warm[yc-8:yc+8]
    print(f"=== {name} ribbon row {yc} ({100*yc/h:.0f}%)")
    # X profile of warm band max luminance
    Lb = lum(band)
    prof = np.where(warmband, Lb, 0).max(axis=0)
    sm = np.convolve(prof, np.ones(31)/31, mode='same')
    print(f"  X-profile: mean={sm.mean():.0f} max={sm.max():.0f} min={sm.min():.0f}")
    print(f"  samples: {[int(sm[i]) for i in range(0, w, max(1, w//12))]}")
    # vertical thickness at brightest column
    xc = int(np.argmax(sm))
    col = Lb[yc-40:yc+40, xc] if False else lum(a[max(0,yc-40):yc+40, xc])
    th = np.where(col > 0.5*col.max())[0]
    print(f"  thickness at x={xc}: {th[-1]-th[0]}px = {100*(th[-1]-th[0])/h:.0f}% h")
    px = a[warm]
    print(f"  warm RGB mean=({px[:,0].mean():.0f},{px[:,1].mean():.0f},{px[:,2].mean():.0f}), bright90% R={np.percentile(px[:,0],90):.0f}")
