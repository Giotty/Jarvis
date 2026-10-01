"""Warm, local-only speech synthesis. Audio lives in memory, never in logs."""
import sys, json, io, wave, base64, re

engine = None
engine_key = None
for line in sys.stdin:
    try:
        request = json.loads(line)
        kind = request.get('engine', 'piper')
        key = (kind, request.get('model'), request.get('voices'), request.get('voice'))
        if engine is None or engine_key != key:
            if kind == 'kokoro':
                import onnxruntime as rt
                from kokoro_onnx import Kokoro
                options = rt.SessionOptions()
                options.intra_op_num_threads = 4
                options.inter_op_num_threads = 1
                session = rt.InferenceSession(request['model'], sess_options=options, providers=['CPUExecutionProvider'])
                engine = Kokoro.from_session(session, request['voices'])
                if request['voice'] not in engine.get_voices():
                    raise RuntimeError('Selected British voice is missing from the voice pack.')
            elif kind == 'piper':
                from piper import PiperVoice
                engine = PiperVoice.load(request['voice'])
            else:
                raise RuntimeError('Unsupported local speech engine.')
            engine_key = key
        if request.get('operation') == 'prepare':
            result = {'ready': True}
        else:
            text = re.sub(r'\[([^]]+)\]\([^)]+\)', r'\1', request['text'])
            text = re.sub(r'[`*_#]', '', text).strip()
            audio = io.BytesIO()
            with wave.open(audio, 'wb') as wav:
                if kind == 'kokoro':
                    import numpy as np
                    samples, rate = engine.create(text, voice=request['voice'], speed=request.get('speed', 1), lang='en-gb')
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(rate)
                    pcm = (np.clip(samples * request.get('volume', .8), -1, 1) * 32767).astype('<i2')
                    wav.writeframes(pcm.tobytes())
                else:
                    from piper import SynthesisConfig
                    engine.synthesize_wav(text, wav, syn_config=SynthesisConfig(length_scale=1/request.get('speed', 1), volume=request.get('volume', .8)))
            result = {'audio': base64.b64encode(audio.getvalue()).decode('ascii')}
    except Exception as error:
        result = {'error': str(error)}
    print(json.dumps(result), flush=True)
