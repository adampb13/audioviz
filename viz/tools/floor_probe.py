from PIL import Image
import numpy as np
ref = np.asarray(Image.open(r"C:\Users\adamp\AppData\Roaming\Hermes\composer-images\image_e97507.png").convert("RGB")).astype(np.float32)
cur = np.asarray(Image.open(r"C:\Users\adamp\Documents\GitHub\audioviz\viz\tools\shot_after.png").convert("RGB")).astype(np.float32)
h, w = ref.shape[:2]
h2, w2 = cur.shape[:2]

# REF: sample the lower half structure - is there a ring pattern?
for name, a in [("REF", ref), ("CUR", cur)]:
    H, W = a.shape[:2]
    print(f"=== {name} {W}x{H}")
    # horizontal slice at floor level (75% h): look for ring structure along X
    y = int(H*0.75)
    line = 0.2126*a[y, :, 0] + 0.7152*a[y, :, 1] + 0.0722*a[y, :, 2]
    sm = np.convolve(line, np.ones(51)/51, mode='same')
    print(f"  floor row {y}: mean={sm.mean():.0f} min={sm.min():.0f} max={sm.max():.0f}")
    print(f"  X-samples: {[int(sm[i]) for i in range(0, W, max(1, W//16))]}")
    # vertical slice through center: floor structure
    x = W//2
    col = 0.2126*a[:, x, 0] + 0.7152*a[:, x, 1] + 0.0722*a[:, x, 2]
    print(f"  Y-samples (each 5% h): {[int(col[int(H*k/20)]) for k in range(20)]}")
