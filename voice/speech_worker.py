"""Warm local STT process. Private stdin/stdout protocol, no network listener."""
import sys, json, base64, io, os
model = None
model_name = None
for line in sys.stdin:
    try:
        request = json.loads(line)
        name = request['model']
        if name not in ['tiny', 'base', 'small', 'medium', 'large-v3', 'distil-large-v3']:
            raise RuntimeError('Unsupported STT model.')
        model_path = request.get('modelPath') or name
        if model is None or model_name != model_path:
            from faster_whisper import WhisperModel
            model = WhisperModel(model_path, device='cpu', compute_type='int8', cpu_threads=min(8, os.cpu_count() or 4))
            model_name = model_path
        if request.get('operation') == 'prepare':
            result = {'ready': True}
        else:
            audio = io.BytesIO(base64.b64decode(request['audio']))
            language = request.get('language', 'en')
            segments, _ = model.transcribe(audio, language=None if language == 'auto' else 'en',
                                          beam_size=1, best_of=1, condition_on_previous_text=False,
                                          vad_filter=True, vad_parameters={'min_silence_duration_ms': 350},
                                          hotwords='Jarvis, Roblox, YouTube, MrBeast', temperature=0)
            result = {'text': ' '.join(s.text for s in segments).strip()}
    except Exception as error:
        result = {'error': str(error)}
    print(json.dumps(result), flush=True)
