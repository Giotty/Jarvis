"""Control the real default Windows playback endpoint and read back its state."""
import math

def endpoint():
    from pycaw.pycaw import AudioUtilities
    device = AudioUtilities.GetSpeakers()
    if device is None:
        raise RuntimeError('No default Windows playback device is available.')
    return device.EndpointVolume

def state(volume=None):
    volume = volume if volume is not None else endpoint()
    return {'volume': round(volume.GetMasterVolumeLevelScalar() * 100, 2),
            'muted': bool(volume.GetMute())}

def control(args, volume=None):
    volume = volume if volume is not None else endpoint()
    before = state(volume)
    action = args['action']
    percent = args.get('percent', 10)
    if not isinstance(percent, (float, int)) or isinstance(percent, bool) or not math.isfinite(percent) or not 0 <= percent <= 100:
        raise ValueError('Volume must be between 0 and 100 percent.')
    target = before['volume']
    mute = before['muted']
    if action == 'set': target = percent
    elif action == 'lower': target = max(0, target - percent)
    elif action == 'raise': target = min(100, target + percent)
    elif action == 'mute': mute = True
    elif action == 'unmute': mute = False
    elif action == 'toggle_mute': mute = not mute
    else: raise ValueError('Unknown volume action.')
    if action in ['set', 'lower', 'raise']:
        volume.SetMasterVolumeLevelScalar(target / 100, None)
    else:
        volume.SetMute(int(mute), None)
    after = state(volume)
    verified = abs(after['volume'] - target) <= .6 and after['muted'] == mute
    return {'success': verified, 'verified': verified, 'retryable': False,
            'observed_result': after, 'before': before,
            'message': f"Volume is {after['volume']:g}%" + (' (muted).' if after['muted'] else '.')}
