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
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    output = []
    def visit(hwnd, _):
        if user.IsWindowVisible(hwnd):
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
    user.GetForegroundWindow.restype = wintypes.HWND
    user.ShowWindow(hwnd, 9)
    user.SetForegroundWindow(hwnd)
    if int(user.GetForegroundWindow() or 0) != hwnd:
        raise RuntimeError('Windows did not allow that window to receive focus.')
    return {'success': True, 'verified': True}


def focus_named(name):
    matches = [w for w in windows() if w['application'] != 'jarvis.exe' and
               (name.casefold() in w['title'].casefold() or name.casefold() in w['application'].casefold())]
    if len(matches) != 1:
        raise RuntimeError('Choose an exact window title; more than one or no window matched.')
    return {**focus(matches[0]['hwnd']), 'window': matches[0]}
