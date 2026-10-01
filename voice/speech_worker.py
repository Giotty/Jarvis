"""Warm local STT process. Private stdin/stdout protocol, no network listener."""
import sys, json, base64, tempfile, os
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
            model = WhisperModel(model_path, device='cpu', compute_type='int8', cpu_threads=4)
            model_name = model_path
        with tempfile.TemporaryDirectory(prefix='jarvis-') as folder:
            audio = os.path.join(folder, 'voice.webm')
            with open(audio, 'wb') as stream:
                stream.write(base64.b64decode(request['audio']))
            segments, _ = model.transcribe(audio, vad_filter=True)
            result = {'text': ' '.join(s.text for s in segments).strip()}
    except Exception as error:
        result = {'error': str(error)}
    print(json.dumps(result), flush=True)
