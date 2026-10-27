import os
from pathlib import Path
from audio_separator.separator import Separator

def process_audio_with_dereverb(file_path):
    path = Path(file_path)
    if not path.is_file():
        print(f"Błąd: Plik '{file_path}' nie istnieje.")
        return

    output_dir = path.parent / path.stem
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Ścieżka do pliku z wokalu z etapu 1
    vocal_file_path = output_dir / f"{path.stem}_(Vocals)_wokal_z_poglosem.flac"

    # Inicjalizacja separatora
    separator = Separator(
        output_dir=str(output_dir),
        output_format="FLAC",
        normalization_threshold=0.9,
        sample_rate=44100
    )

    # ---------------------------------------------------------
    # ETAP 1: SEPARACJA WOKALU (Z WARUNKIEM POMIJANIA)
    # ---------------------------------------------------------
    # Szukamy dowolnego istniejącego pliku z frazą 'wokal_z_poglosem' w folderze
    existing_vocal = list(output_dir.glob("*wokal_z_poglosem*.flac"))

    if existing_vocal:
        print(f"\n[Etap 1/2] Pomijam! Znaleziono gotowy wokal z pierwszego etapu:\n -> {existing_vocal[0].name}")
        vocal_file_path = existing_vocal[0]
    else:
        vocal_model = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"
        print(f"\n[Etap 1/2] Wyodrębnianie wokalu ({vocal_model})...")
        separator.load_model(model_filename=vocal_model)
        
        stage1_files = separator.separate(
            str(path), 
            custom_output_names={"Vocals": "wokal_z_poglosem", "Instrumental": "podklad"}
        )
        
        vocal_filename = next((f for f in stage1_files if "wokal_z_poglosem" in f), None)
        if not vocal_filename:
            print("Błąd: Nie udało się wygenerować pliku z wokalem.")
            return
        vocal_file_path = output_dir / vocal_filename

    # ---------------------------------------------------------
    # ETAP 2: USUWANIE POGŁOSU (GWARANTOWANY MODEL)
    # ---------------------------------------------------------
    # Niezawodny model ONNX obecny w każdej wersji biblioteki
    dereverb_model = "UVR-DeEcho-DeReverb.onnx"
    
    print(f"\n[Etap 2/2] Usuwanie pogłosu za pomocą modelu: {dereverb_model}...")
    separator.load_model(model_filename=dereverb_model)
    
    stage2_files = separator.separate(
        str(vocal_file_path),
        custom_output_names={"No Reverb": "wokal_czysty_dry", "Reverb": "sam_poglos_tail"}
    )

    print("\nProces zakończony! Pliki w folderze wyjściowym:")
    for file in output_dir.glob("*.flac"):
        print(f"- {file.name}")

if __name__ == "__main__":
    target_file = os.path.join("data", "silence.wav")
    process_audio_with_dereverb(target_file)