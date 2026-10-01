"""Narrow Windows worker. Structured JSON only; never executes arbitrary commands."""
import sys, json, subprocess, os, ctypes
from pathlib import Path

def roblox_executable():
    # Prefer the installed protocol's current client, never the installer.
    import winreg
    root = Path(os.environ['LOCALAPPDATA']) / 'Roblox' / 'Versions'
    candidates = []
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Classes\roblox\shell\open\command') as key:
            command = winreg.QueryValueEx(key, None)[0]
            if command.startswith('"'):
                candidates.append(Path(command.split('"')[1]))
    except OSError:
        pass
    if root.is_dir():
        candidates.extend(sorted(root.glob('version-*/RobloxPlayerBeta.exe'), key=lambda p: p.stat().st_mtime, reverse=True))
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved.name == 'RobloxPlayerBeta.exe' and root.resolve() in resolved.parents and resolved.is_file():
            return str(resolved)
    raise RuntimeError('Roblox is not installed. Install it yourself, then try again.')

def execute(tool, args):
    if sys.platform != 'win32':
        raise RuntimeError('PC control requires Windows.')
    if tool == 'list_ui_elements':
        from accessibility import describe
        return describe()
    if tool == 'locate_accessible_element':
        from accessibility import locate
        return locate(args['label'])
    if tool in ['type_text', 'fill_search']:
        from accessibility import fill
        return fill(args['text'], args.get('label'), search=tool == 'fill_search')
    if tool == 'navigate_ui':
        from accessibility import navigate
        return navigate(args['label'])
    if tool == 'launch_roblox_game':
        place_id = args['placeId']
        if not isinstance(place_id, int) or place_id <= 0:
            raise RuntimeError('Invalid Roblox place ID.')
        roblox_executable()  # Refuse to trigger an uninstalled protocol's installer.
        os.startfile('roblox://placeId=' + str(place_id))
        return {'dispatched': True, 'joined': False}
    if tool == 'get_foreground_window':
        from ctypes import wintypes
        ctypes.windll.user32.GetForegroundWindow.restype = wintypes.HWND
        window = ctypes.windll.user32.GetForegroundWindow()
        title = ctypes.create_unicode_buffer(1024)
        ctypes.windll.user32.GetWindowTextW(window, title, 1024)
        rect = wintypes.RECT()
        ctypes.windll.user32.GetWindowRect(window, ctypes.byref(rect))
        return {'title': title.value, 'bounds': {'x': rect.left, 'y': rect.top, 'width': rect.right - rect.left, 'height': rect.bottom - rect.top}}
    if tool == 'close_application':
        import pygetwindow
        windows = [w for w in pygetwindow.getWindowsWithTitle(args['name']) if w.title and 'JARVIS' not in w.title.upper()]
        if not windows:
            raise RuntimeError('No matching application window found.')
        for window in windows:
            window.close()
        return {'success': True, 'requested_close': len(windows)}
    if tool == 'open_application':
        name = args['name']
        if name == 'roblox':
            # Roblox's installed client uses --app for its home screen.
            process = subprocess.Popen([roblox_executable(), '--app'])
            return {'success': True, 'pid': process.pid}
        apps = {'notepad': ['notepad.exe'], 'calculator': ['calc.exe'], 'explorer': ['explorer.exe'],
                'spotify': [os.path.join(os.environ['APPDATA'], 'Spotify', 'Spotify.exe')],
                'chrome': [os.path.join(os.environ['PROGRAMFILES'], 'Google', 'Chrome', 'Application', 'chrome.exe')],
                'edge': [os.path.join(os.environ.get('PROGRAMFILES(X86)', os.environ['PROGRAMFILES']), 'Microsoft', 'Edge', 'Application', 'msedge.exe')]}
        process = subprocess.Popen(apps[name])
        return {'success': True, 'pid': process.pid}
    if tool == 'run_powershell':
        if args['command'] not in ['Get-Date', 'Get-ComputerInfo', 'Get-PSDrive']:
            raise RuntimeError('Command not allowlisted.')
        result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', args['command']], capture_output=True, text=True, timeout=20, creationflags=0x08000000)
        if result.returncode:
            raise RuntimeError('PowerShell failed.')
        return {'output': result.stdout[:10000]}
    if tool == 'lock_pc':
        ctypes.windll.user32.LockWorkStation()
        return {'success': True}
    import pyautogui as pg
    pg.FAILSAFE = True
    pg.PAUSE = .15
    if tool == 'move_mouse': pg.moveTo(args['x'], args['y'], duration=.2)
    elif tool == 'click_mouse':
        pg.moveTo(args['x'], args['y'], duration=.2)
        if args['button'] == 'double': pg.doubleClick()
        else: pg.click(button=args['button'])
    elif tool == 'scroll': pg.scroll(args['amount'])
    elif tool == 'hotkey': pg.hotkey(*args['keys'])
    elif tool == 'media': pg.press(args['key'])
    elif tool == 'window_control':
        actions = {'close': ['alt', 'f4'], 'minimize': ['win', 'down'], 'maximize': ['win', 'up'], 'switch': ['alt', 'tab']}
        pg.hotkey(*actions[args['action']])
    else: raise RuntimeError('Unsupported action.')
    return {'success': True}

if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        print(json.dumps(execute(request['tool'], request['args'])))
    except Exception as error:
        print(json.dumps({'error': str(error)}))
