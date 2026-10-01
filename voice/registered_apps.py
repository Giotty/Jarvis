"""Resolve real desktop Start-menu IDs without passing them to a shell."""
import ctypes
import re
import subprocess
import uuid
from pathlib import Path
from ctypes import wintypes


def resolve(app_id):
    match = re.fullmatch(r'\{([0-9A-Fa-f-]{36})\}\\(.+)', app_id)
    if match:
        guid = (ctypes.c_ubyte * 16).from_buffer_copy(uuid.UUID(match[1]).bytes_le)
        output = ctypes.c_void_p()
        get_path = ctypes.windll.shell32.SHGetKnownFolderPath
        get_path.argtypes = [ctypes.c_void_p, wintypes.DWORD, wintypes.HANDLE, ctypes.POINTER(ctypes.c_void_p)]
        get_path.restype = ctypes.c_long
        free = ctypes.windll.ole32.CoTaskMemFree
        free.argtypes = [ctypes.c_void_p]
        try:
            if get_path(ctypes.byref(guid), 0, None, ctypes.byref(output)) != 0:
                raise RuntimeError('Windows could not resolve the installed app folder.')
            root = Path(ctypes.wstring_at(output)).resolve()
        finally:
            if output.value:
                free(output)
        suffix = Path(match[2])
        if suffix.is_absolute() or suffix.drive or '..' in suffix.parts:
            raise RuntimeError('Invalid registered application path.')
        executable = (root / suffix).resolve()
        if root not in executable.parents:
            raise RuntimeError('Registered application path escaped its folder.')
    elif re.match(r'^[a-z]:[\\/]', app_id, re.I):
        executable = Path(app_id).resolve()
    else:
        raise RuntimeError('Not a registered desktop path.')
    if not executable.is_file():
        raise RuntimeError('The installed application executable no longer exists.')
    return executable


def launch(app_id, risk):
    executable = resolve(app_id)
    # A Start-menu alias must not hide an installer or an executable script.
    dangerous = (executable.suffix.lower() != '.exe' or
                 re.search(r'(?:unins\d*|uninstall|install|installer|setup|updateinstaller|reset|shutdown|restart)', executable.stem, re.I))
    if dangerous and risk < 3:
        raise RuntimeError('This registered executable needs explicit installer/script confirmation.')
    if executable.suffix.lower() != '.exe':
        raise RuntimeError('Use the confirmed executable tool for scripts and installers.')
    process = subprocess.Popen([str(executable)], cwd=str(executable.parent),
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, close_fds=True)
    return {'dispatched': True, 'pid': process.pid}
