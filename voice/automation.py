"""Narrow Windows worker. Structured JSON only; never executes arbitrary commands."""
import sys, json, subprocess, os, ctypes
from pathlib import Path

def foreground():
    from ctypes import wintypes
    user = ctypes.windll.user32
    user.GetForegroundWindow.restype = wintypes.HWND
    user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    window = user.GetForegroundWindow()
    title = ctypes.create_unicode_buffer(1024)
    user.GetWindowTextW(window, title, 1024)
    rect, pid = wintypes.RECT(), wintypes.DWORD()
    user.GetWindowRect(window, ctypes.byref(rect))
    user.GetWindowThreadProcessId(window, ctypes.byref(pid))
    from windows_context import process_name
    point = wintypes.POINT()
    user.GetCursorPos(ctypes.byref(point))
    return {'hwnd': int(window or 0), 'pid': pid.value, 'title': title.value, 'application': process_name(pid.value),
            'mouse': {'x': point.x, 'y': point.y},
            'bounds': {'x': rect.left, 'y': rect.top, 'width': rect.right - rect.left, 'height': rect.bottom - rect.top}}

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
    # UI Automation, monitor captures and input all use physical desktop pixels.
    try:
        ctypes.windll.user32.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except (AttributeError, OSError):
        ctypes.windll.user32.SetProcessDPIAware()
    if tool == 'launch_registered_app':
        from registered_apps import launch
        return launch(args['appId'], args['risk'])
    if tool == 'application_inventory':
        from registered_apps import inventory
        return inventory()
    if tool in ['browser_state', 'browser_navigate', 'browser_control']:
        import browser_control
        if tool == 'browser_state': return browser_control.state()
        if tool == 'browser_navigate': return browser_control.navigate(args['url'], args.get('newTab', False))
        return browser_control.control(args['action'], args.get('index', 1))
    if tool == 'list_windows':
        from windows_context import windows
        return {'windows': windows()}
    if tool == 'prepare_desktop':
        from windows_context import prepare_desktop
        return prepare_desktop(args['excludedPid'], args.get('preferredHwnd'))
    if tool == 'list_installed_games':
        from installed_games import installed
        return installed()
    if tool == 'verify_application':
        from windows_context import windows, process_name
        name=args['name'].casefold()
        found=[w for w in windows() if w['application']!='jarvis.exe' and
               (name in w['title'].casefold() or name.replace(' ','') in w['application'].replace(' ','').casefold())]
        if found: return {'verified':True,'observed_result':found[0]}
        pid=args.get('pid')
        if pid and process_name(pid): return {'verified':True,'observed_result':{'pid':pid,'application':process_name(pid)}}
        return {'verified':False,'observed_result':None}
    if tool == 'focus_browser':
        from windows_context import windows, focus
        from browser_control import BROWSERS
        if not any(w['hwnd']==args['hwnd'] and w['application'] in BROWSERS for w in windows()):
            raise RuntimeError('That browser window is no longer available.')
        return focus(args['hwnd'])
    if tool == 'focus_application':
        from windows_context import focus_named
        return focus_named(args['name'])
    if tool == 'list_ui_elements':
        from accessibility import describe
        return describe()
    if tool == 'locate_accessible_element':
        from accessibility import locate
        return locate(args['label'])
    if tool in ['type_text', 'fill_search']:
        from accessibility import fill
        return fill(args['text'], args.get('label'), search=tool == 'fill_search', allow_sensitive=args.get('allowSensitive', False), allow_mouse_focus=args.get('allowMouseFocus', False))
    if tool == 'navigate_ui':
        from accessibility import navigate
        return navigate(args['label'])
    if tool == 'open_youtube_result':
        from youtube import open_result
        return open_result(args['index'])
    if tool == 'launch_roblox_game':
        place_id = args['placeId']
        if not isinstance(place_id, int) or place_id <= 0:
            raise RuntimeError('Invalid Roblox place ID.')
        roblox_executable()  # Refuse to trigger an uninstalled protocol's installer.
        os.startfile('roblox://placeId=' + str(place_id))
        return {'dispatched': True, 'joined': False}
    if tool == 'get_foreground_window':
        return foreground()
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
    if tool == 'click_verified':
        from ctypes import wintypes
        current = foreground()
        identity = ['hwnd', 'pid', 'title', 'bounds', 'application']
        if any(current.get(k) != args['window'].get(k) for k in identity):
            raise RuntimeError('The target window changed; no click was performed. Ask again.')
        pg.moveTo(args['x'], args['y'], duration=.15)
        user = ctypes.windll.user32
        user.WindowFromPoint.argtypes = [wintypes.POINT]
        user.WindowFromPoint.restype = wintypes.HWND
        user.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
        user.GetAncestor.restype = wintypes.HWND
        hit = user.GetAncestor(user.WindowFromPoint(wintypes.POINT(args['x'], args['y'])), 2)
        after = foreground()
        if int(hit or 0) != current['hwnd'] or any(after.get(k) != current.get(k) for k in identity):
            raise RuntimeError('The target is covered or its window changed; no click was performed.')
        pg.click()
        return {'dispatched': True, 'verified_target': True, 'page_change_verified': False}
    if tool == 'move_mouse': pg.moveTo(args['x'], args['y'], duration=.2)
    elif tool == 'click_mouse':
        pg.moveTo(args['x'], args['y'], duration=.2)
        if args['button'] == 'double': pg.doubleClick()
        else: pg.click(button=args['button'])
    elif tool == 'scroll': pg.scroll(args['amount'])
    elif tool == 'drag_mouse':
        pg.moveTo(args['x'],args['y'],duration=.2)
        pg.dragTo(args['toX'],args['toY'],duration=.4,button='left')
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
