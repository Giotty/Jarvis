"""Read visible window identity and provide bounded, explicit window focus."""
import ctypes
import os
from ctypes import wintypes


def process_name(pid):
    kernel = ctypes.windll.kernel32
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        return ''
    try:
        size = wintypes.DWORD(2048)
        value = ctypes.create_unicode_buffer(2048)
        if kernel.QueryFullProcessImageNameW(handle, 0, value, ctypes.byref(size)):
            return os.path.basename(value.value).lower()
        return ''
    finally:
        kernel.CloseHandle(handle)


def windows():
    user = ctypes.windll.user32
    user.IsWindowVisible.argtypes = [wintypes.HWND]
    user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.GetWindowLongPtrW.argtypes = [wintypes.HWND,ctypes.c_int]
    user.GetWindowLongPtrW.restype = ctypes.c_ssize_t
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    output = []
    def visit(hwnd, _):
        if user.IsWindowVisible(hwnd) and not user.GetWindowLongPtrW(hwnd,-20) & (0x80 | 0x08000000):
            title = ctypes.create_unicode_buffer(1024)
            user.GetWindowTextW(hwnd, title, 1024)
            if title.value:
                pid = wintypes.DWORD()
                user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                output.append({'hwnd': int(hwnd), 'pid': pid.value, 'title': title.value, 'application': process_name(pid.value)})
        return True
    user.EnumWindows(callback_type(visit), 0)
    return output[:80]


def focus(hwnd):
    user = ctypes.windll.user32
    user.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user.SetForegroundWindow.argtypes = [wintypes.HWND]
    user.BringWindowToTop.argtypes = [wintypes.HWND]
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.AttachThreadInput.argtypes = [wintypes.DWORD,wintypes.DWORD,wintypes.BOOL]
    user.GetForegroundWindow.restype = wintypes.HWND
    user.ShowWindow(hwnd, 9)
    user.SetForegroundWindow(hwnd)
    if int(user.GetForegroundWindow() or 0) != hwnd:
        current=ctypes.windll.kernel32.GetCurrentThreadId()
        foreground_thread=user.GetWindowThreadProcessId(user.GetForegroundWindow(),None)
        attached=bool(foreground_thread and user.AttachThreadInput(current,foreground_thread,True))
        try:
            user.BringWindowToTop(hwnd)
            user.SetForegroundWindow(hwnd)
        finally:
            if attached:user.AttachThreadInput(current,foreground_thread,False)
    if int(user.GetForegroundWindow() or 0) != hwnd:
        raise RuntimeError('Windows did not allow that window to receive focus.')
    return {'success': True, 'verified': True}

def prepare_desktop(excluded_pid, preferred_hwnd=None):
    # Hiding an active Electron window can leave its hidden HWND foreground.
    # Choose a real visible window, preserving the user's focus whenever valid.
    from automation import foreground
    current=foreground()
    visible=windows()
    existing=next((w for w in visible if w['hwnd']==current['hwnd'] and w['pid']!=excluded_pid),None)
    if existing:return {'window':existing,'verified':True}
    candidates=[w for w in visible if w['pid']!=excluded_pid and w['title']!='Program Manager']
    target=next((w for w in candidates if w['hwnd']==preferred_hwnd),candidates[0] if candidates else None)
    if not target:raise RuntimeError('No visible application window is available.')
    return {**focus(target['hwnd']),'window':target}


def focus_named(name):
    matches = [w for w in windows() if w['application'] != 'jarvis.exe' and
               (name.casefold() in w['title'].casefold() or name.casefold() in w['application'].casefold())]
    if len(matches) != 1:
        raise RuntimeError('Choose an exact window title; more than one or no window matched.')
    return {**focus(matches[0]['hwnd']), 'window': matches[0]}
