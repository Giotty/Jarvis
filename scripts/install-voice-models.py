"""Download public, free speech models into this JARVIS checkout only."""
from pathlib import Path
from huggingface_hub import hf_hub_download, snapshot_download
import numpy as np

root = Path(__file__).resolve().parent.parent / 'models'
folder = root / 'kokoro'
folder.mkdir(parents=True, exist_ok=True)
repo = 'onnx-community/Kokoro-82M-v1.0-ONNX'
print('Downloading Kokoro voice model', flush=True)
hf_hub_download(repo, 'onnx/model.onnx', local_dir=folder)
voices = {}
for name in ['bm_george', 'bm_daniel', 'bm_lewis', 'bm_fable']:
    file = hf_hub_download(repo, f'voices/{name}.bin', local_dir=folder)
    voices[name] = np.fromfile(file, dtype='<f4').reshape(-1, 1, 256)
with open(folder / 'british-voices.bin', 'wb') as stream:
    np.savez(stream, **voices)
print('British voices ready. Downloading distilled Whisper.', flush=True)
snapshot_download('Systran/faster-distil-whisper-large-v3', local_dir=root / 'whisper-distil-large-v3',
                  allow_patterns=['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.json', 'preprocessor_config.json'])
print('Local voice models ready.', flush=True)
