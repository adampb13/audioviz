import os
from pathlib import Path
from audio_separator.separator import Separator

def process_audio(file_path):
    path = Path(file_path)
    
    # 1. Weryfikacja czy plik wejściowy istnieje
    if not path.is_file():
        print(f"Błąd: Plik '{file_path}' nie istnieje.")
        return

    # 2. Tworzenie podfolderu 'data/x' (gdzie 'x' to nazwa pliku bez rozszerzenia)
    # Dla pliku data/familyties.wav utworzy się folder data/familyties/
    output_dir = path.parent / path.stem
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Pliki wyjściowe zostaną zapisane w: {output_dir}")

    # 3. Inicjalizacja separatora ze wskazaniem utworzonego folderu docelowego
    separator = Separator(output_dir=str(output_dir))

    # ---------------------------------------------------------
    # WYBÓR MODELU I NAZW PLIKÓW WYJŚCIOWYCH
    # ---------------------------------------------------------
    
    # OPCJA 1: Model podziału na 4 ścieżki (Wokal, Bas, Bębny, Inne)
    model_name = "htdemucs_ft.yaml"
    output_names = {
        "Vocals": "wokal",
        "Bass": "bas",
        "Drums": "bebny",
        "Other": "inne"
    }
    
    # OPCJA 2: Wskazany przez Ciebie model (podział tylko na Wokal i Podkład)
    # Aby go użyć, zakomentuj OPCJĘ 1 i odkomentuj linie poniżej:
    # model_name = "UVR_MDX_NET_Inst_HQ_3.onnx"
    # output_names = {
    #     "Vocals": "wokal",
    #     "Instrumental": "podklad"
    # }

    # 4. Pobieranie (jeśli to pierwsze użycie) i ładowanie modelu
    print(f"Ładowanie modelu '{model_name}'...")
    separator.load_model(model_filename=model_name)

    # 5. Wykonanie separacji
    # Słownik 'output_names' gwarantuje, że pliki wyjściowe otrzymają wskazane przez nas polskie nazwy
    print(f"Rozpoczynam podział pliku {path.name}... (to może chwilę potrwać)")
    output_files = separator.separate(str(path), output_names)

    # 6. Podsumowanie
    print("\nProces zakończony pomyślnie! Wygenerowane ścieżki:")
    for file in output_files:
        print(f"- {output_dir / file}")

if __name__ == "__main__":
    # Ścieżka do docelowego pliku audio
    target_file = os.path.join("data", "silence.wav")
    process_audio(target_file)