"""Physical desktop checks restricted to JARVIS's own disposable control window."""
import sys,json,base64,ctypes
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'voice'))
from automation import execute
request=json.load(sys.stdin)
window=execute('get_foreground_window',{})
if window['title']!='JARVIS control sandbox':raise RuntimeError('The disposable sandbox is not foreground.')
if request.get('operation')=='close':
    from ctypes import wintypes
    ctypes.windll.user32.PostMessageW.argtypes=[wintypes.HWND,wintypes.UINT,wintypes.WPARAM,wintypes.LPARAM]
    ctypes.windll.user32.PostMessageW(window['hwnd'],16,0,0)
    print(json.dumps({'closed':True}))
else:
    from PIL import ImageGrab
    rect=window['bounds']
    image=ImageGrab.grab(bbox=(rect['x'],rect['y'],rect['x']+rect['width'],rect['y']+rect['height']),all_screens=True)
    print(json.dumps({'bounds':rect,'width':image.width,'height':image.height,
                      'pixels':base64.b64encode(image.resize((32,18)).convert('RGB').tobytes()).decode()}))
