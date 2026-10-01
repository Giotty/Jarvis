"""Piper synthesis to an in-memory WAV; never stores speech content on disk."""
import sys, json, io, wave, base64
try:
    from piper import PiperVoice, SynthesisConfig
    request = json.load(sys.stdin)
    voice = PiperVoice.load(request['voice'])
    audio = io.BytesIO()
    with wave.open(audio, 'wb') as wav:
        voice.synthesize_wav(request['text'], wav, syn_config=SynthesisConfig(length_scale=1/request.get('speed', 1), volume=request.get('volume', 0.8)))
    print(json.dumps({'audio': base64.b64encode(audio.getvalue()).decode('ascii')}))
except Exception as error:
    print(json.dumps({'error': str(error)}))
