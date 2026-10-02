"""Generic browser navigation verified against browser-chrome address controls."""
import ctypes
import time
from urllib.parse import urlparse, parse_qs
from windows_context import windows, focus
from youtube import value

BROWSERS = ['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe']


def address_control(root):
    import uiautomation as ui
    began = time.monotonic()
    # Never accept a web-page form field as the trusted browser address bar.
    stack = [(root, 0)]
    count = 0
    while stack and count < 500 and time.monotonic() - began < 2.5:
        control, depth = stack.pop()
        count += 1
        try:
            kind = control.ControlTypeName
            if kind == 'DocumentControl':
                continue
            if kind == 'EditControl' and not control.IsPassword:
                content = value(control).strip()
                label = control.Name.casefold()
                if ('address' in label or 'adresse' in label or 'url' in label or
                    'omnibox' in control.AutomationId.casefold() or
                    urlparse(content if '://' in content else 'https://' + content).hostname and '.' in content.split('/')[0]):
                    return control
            if depth < 14:
                stack.extend((child, depth + 1) for child in reversed(control.GetChildren()))
        except Exception:
            continue
    return None


def state():
    import uiautomation as ui
    candidates = [w for w in windows() if w['application'] in BROWSERS]
    # Foreground first; inspection never switches focus or touches the clipboard.
    from ctypes import wintypes
    ctypes.windll.user32.GetForegroundWindow.restype = wintypes.HWND
    front = int(ctypes.windll.user32.GetForegroundWindow() or 0)
    candidates.sort(key=lambda w: w['hwnd'] != front)
    output = []
    for window in candidates[:4]:
        root = ui.ControlFromHandle(window['hwnd'])
        control = address_control(root)
        address = value(control) if control else ''
        output.append({**window, 'url': address, 'foreground': window['hwnd'] == front})
    return {'windows': output, 'observedAt': time.time() * 1000}


def valid_url(url):
    parsed = urlparse(url)
    if parsed.scheme not in ['http', 'https'] or not parsed.hostname or parsed.username or parsed.password:
        raise RuntimeError('Only ordinary web URLs can be navigated automatically.')


def navigate(url, new_tab=False):
    import uiautomation as ui
    import pyautogui as pg
    valid_url(url)
    current = state()['windows']
    if not current:
        raise RuntimeError('No browser window is available for the alternate navigation method.')
    target = next((w for w in current if w['foreground']), current[0])
    focus(target['hwnd'])
    pg.FAILSAFE = True
    if new_tab:
        pg.hotkey('ctrl', 't')
        time.sleep(.15)
    pg.hotkey('ctrl', 'l')
    time.sleep(.1)
    root = ui.ControlFromHandle(target['hwnd'])
    control = address_control(root)
    if not control or not control.HasKeyboardFocus:
        raise RuntimeError('The browser address field could not be focused. No URL was typed.')
    pattern = control.GetValuePattern()
    if not pattern or pattern.IsReadOnly:
        raise RuntimeError('This browser does not expose a verifiable address field.')
    pattern.SetValue(url)
    if value(control).strip() != url:
        raise RuntimeError('The browser address field did not contain the requested URL.')
    from automation import foreground
    if foreground()['hwnd'] != target['hwnd'] or not control.HasKeyboardFocus:
        raise RuntimeError('Browser focus changed before navigation. No Enter key was sent.')
    pg.press('enter')
    return {'dispatched': True, 'destination': url, 'browser': target['application']}


def control(action, index=1):
    import pyautogui as pg
    current = state()['windows']
    if not current:
        raise RuntimeError('No browser window is open.')
    target = next((w for w in current if w['foreground']), current[0])
    focus(target['hwnd'])
    keys = {'back': ['alt', 'left'], 'forward': ['alt', 'right'], 'refresh': ['ctrl', 'r'],
            'close_tab': ['ctrl', 'w'], 'new_tab': ['ctrl', 't']}
    if action == 'switch_tab':
        if not 1 <= index <= 9:
            raise RuntimeError('Tab position must be between 1 and 9.')
        pg.hotkey('ctrl', str(index))
    elif action in keys:
        pg.hotkey(*keys[action])
    else:
        raise RuntimeError('Unknown browser control.')
    time.sleep(.2)
    return {'dispatched': True, 'observed_result': state(), 'verified': False}
