from audio_separator.separator import Separator

separator = Separator()

# 1. Szukanie z uwzględnieniem 'reverb', 'echo' oraz 'dereverb'
dereverb_models = [
    m for m in separator.model_filenames 
    if any(keyword in m.lower() for keyword in ['reverb', 'echo', 'dereverb'])
]

print("=== Znalezione modele De-Reverb / De-Echo ===")
if dereverb_models:
    for m in dereverb_models:
        print(f"- {m}")
else:
    print("Brak modeli pasujących do wzorca 'reverb'/'echo'.")
    print("\n=== Przykładowe nazwy modeli z Twojej biblioteki (pierwsze 20) ===")
    for m in separator.model_filenames[:20]:
        print(f"- {m}")