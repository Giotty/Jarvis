"""Warm local STT process. Private stdin/stdout protocol, no network listener."""
import sys, json, base64, io, os
from pathlib import Path
# Load NVIDIA DLLs only inside this worker; no machine-wide PATH changes.
dll_handles = []
if sys.platform == 'win32':
    folders = sorted({p.parent for p in (Path(sys.prefix) / 'Lib/site-packages/nvidia').glob('**/*.dll')})
    for folder in folders:
        dll_handles.append(os.add_dll_directory(str(folder)))
    if folders:
        os.environ['PATH'] = os.pathsep.join(map(str, folders)) + os.pathsep + os.environ.get('PATH', '')
model = None
model_name = None
device = 'cpu'

def load(path, preferred):
    global device
    import ctranslate2
    from faster_whisper import WhisperModel
    device = 'cuda' if preferred != 'cpu' and ctranslate2.get_cuda_device_count() else 'cpu'
    try:
        return WhisperModel(path, device=device, compute_type='int8_float16' if device == 'cuda' else 'int8', cpu_threads=min(6, os.cpu_count() or 4))
    except RuntimeError:
        if preferred == 'cuda' or device == 'cpu':
            raise
        device = 'cpu'
        return WhisperModel(path, device='cpu', compute_type='int8', cpu_threads=min(6, os.cpu_count() or 4))

def recognize(audio, language, warm=False):
    segments, _ = model.transcribe(audio, language=None if language == 'auto' else 'en',
                                  beam_size=1, best_of=1, condition_on_previous_text=False,
                                  vad_filter=not warm, vad_parameters={'min_silence_duration_ms': 250},
                                  without_timestamps=True, max_new_tokens=1 if warm else 256,
                                  hotwords=None if warm else 'Jarvis, Roblox, YouTube, MrBeast', temperature=0)
    return ' '.join(s.text for s in segments).strip()
for line in sys.stdin:
    try:
        request = json.loads(line)
        name = request['model']
        if name not in ['tiny', 'base', 'small', 'small.en', 'medium', 'large-v3', 'distil-large-v3']:
            raise RuntimeError('Unsupported STT model.')
        model_path = request.get('modelPath') or name
        preferred = request.get('device', 'auto')
        if preferred not in ['auto', 'cpu', 'cuda']:
            raise RuntimeError('Unsupported speech device.')
        if model is None or model_name != (model_path, preferred):
            model = load(model_path, preferred)
            model_name = (model_path, preferred)
        warm = request.get('operation') == 'prepare'
        import numpy as np
        decoded = np.zeros(16000, dtype=np.float32) if warm else io.BytesIO(base64.b64decode(request['audio']))
        try:
            text = recognize(decoded, request.get('language', 'en'), warm)
        except RuntimeError:
            if preferred != 'auto' or device != 'cuda':
                raise
            # GPU memory can be occupied by a game. Retain a working CPU path.
            model = None
            model = load(model_path, 'cpu')
            if not warm:
                decoded.seek(0)
            text = recognize(decoded, request.get('language', 'en'), warm)
        if request.get('operation') == 'prepare':
            result = {'ready': True, 'device': device}
        else:
            result = {'text': text, 'device': device}
    except Exception as error:
        result = {'error': str(error)}
    print(json.dumps(result), flush=True)
