"""Narrow Windows worker. Structured JSON only; never executes arbitrary commands."""
import sys, json, subprocess, os, ctypes

def execute(tool, args):
    if sys.platform != 'win32':
        raise RuntimeError('PC control requires Windows.')
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
    elif tool == 'type_text':
        # Unicode typing uses the clipboard and restores it after Windows pastes.
        import pyperclip, time
        previous = pyperclip.paste()
        try:
            pyperclip.copy(args['text']); pg.hotkey('ctrl', 'v'); time.sleep(.3)
        finally: pyperclip.copy(previous)
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
