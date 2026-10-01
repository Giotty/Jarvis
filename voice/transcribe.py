"""Short-lived CPU/int8 STT worker; audio lives only in a temporary directory."""
import sys, json, base64, tempfile, os
try:
    from faster_whisper import WhisperModel
    request = json.load(sys.stdin)
    if request['model'] not in ['tiny', 'base', 'small', 'medium', 'large-v3', 'distil-large-v3']:
        raise RuntimeError('Unsupported STT model.')
    with tempfile.TemporaryDirectory(prefix='jarvis-') as folder:
        audio = os.path.join(folder, 'voice.webm')
        with open(audio, 'wb') as stream: stream.write(base64.b64decode(request['audio']))
        model = WhisperModel(request['model'], device='cpu', compute_type='int8', cpu_threads=4)
        segments, _ = model.transcribe(audio, vad_filter=True)
        print(json.dumps({'text': ' '.join(s.text for s in segments).strip()}))
except Exception as error:
    print(json.dumps({'error': str(error)}))
