"""Choose an ordinal video from the live browser accessibility tree."""
import ctypes
import os
import re
import time
from urllib.parse import urlparse, parse_qs


def youtube_url(value):
    try:
        url = urlparse(value if '://' in value else 'https://' + value)
        return url if url.scheme in ['http', 'https'] and url.hostname in ['youtube.com', 'www.youtube.com', 'm.youtube.com'] else None
    except (ValueError, TypeError):
        return None


def watch_url(value):
    url = youtube_url(value)
    video = parse_qs(url.query).get('v', [''])[0] if url else ''
    if url and url.path == '/watch' and re.fullmatch(r'[A-Za-z0-9_-]{11}', video):
        return 'https://www.youtube.com/watch?v=' + video
    return None


def browser_process(pid):
    from ctypes import wintypes
    kernel = ctypes.windll.kernel32
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        return False
    try:
        size = wintypes.DWORD(2048)
        path = ctypes.create_unicode_buffer(size.value)
        return bool(kernel.QueryFullProcessImageNameW(handle, 0, path, ctypes.byref(size))) and os.path.basename(path.value).lower() in ['chrome.exe', 'msedge.exe', 'firefox.exe']
    finally:
        kernel.CloseHandle(handle)


def value(control):
    for getter in ['GetValuePattern', 'GetLegacyIAccessiblePattern']:
        try:
            pattern = getattr(control, getter)()
            if pattern and pattern.Value:
                return pattern.Value
        except Exception:
            pass
    return ''


def candidates(rows):
    # Thumbnails and titles can expose the same link. Prefer the named title;
    # order results by their actual screen position, excluding shorts/channels.
    unique = {}
    for row in rows:
        url = watch_url(row['url'])
        if (not url and (not row['titleLink'] or row['url'])) or row['width'] <= 0 or row['height'] <= 0:
            continue
        key = url or row['name']
        old = unique.get(key)
        if old is None or row['titleLink'] and not old['titleLink']:
            unique[key] = {**row, 'url': url}
    return sorted(unique.values(), key=lambda r: (r['top'], r['left']))


def open_result(index):
    import uiautomation as ui
    if not isinstance(index, int) or not 1 <= index <= 10:
        raise RuntimeError('Video position must be between 1 and 10.')
    root = ui.GetForegroundControl()
    if not browser_process(root.ProcessId):
        raise RuntimeError('Bring the YouTube browser window to the front, then ask again. No click was performed.')
    rows = []
    trusted_page = False
    began = time.monotonic()
    for count, (control, _) in enumerate(ui.WalkControl(root, includeTop=False, maxDepth=22)):
        if count >= 1800 or time.monotonic() - began > 5:
            break
        try:
            kind = control.ControlTypeName
            if kind == 'EditControl':
                # Only the browser address bar (outside a web document) can
                # establish the origin; page-controlled form fields cannot.
                parent = control.GetParentControl()
                inside_document = False
                for _ in range(24):
                    if not parent:
                        break
                    if parent.ControlTypeName == 'DocumentControl':
                        inside_document = True
                        break
                    if ui.ControlsAreSame(parent, root):
                        break
                    parent = parent.GetParentControl()
                if not inside_document and youtube_url(value(control)):
                    trusted_page = True
            if kind != 'HyperlinkControl' or control.IsOffscreen or not control.IsEnabled:
                continue
            url = value(control)
            title_link = control.AutomationId == 'video-title' and bool(control.Name.strip())
            if not watch_url(url) and (not title_link or url):
                continue
            bounds = control.BoundingRectangle
            rows.append({'url': url, 'name': control.Name[:200], 'top': bounds.top, 'left': bounds.left,
                         'width': bounds.right - bounds.left, 'height': bounds.bottom - bounds.top,
                         'titleLink': title_link, 'control': control})
        except Exception:
            continue
    if not trusted_page:
        raise RuntimeError('Could not verify YouTube in the browser address bar. Bring its page to the front; no click was performed.')
    videos = candidates(rows)
    if index > len(videos):
        raise RuntimeError(f'I found {len(videos)} visible YouTube video links. Scroll the results into view and ask again. No guessed click was performed.')
    selected = videos[index - 1]
    # Opening the exact live link avoids overlapping overlays and stale bounds.
    if selected['url']:
        os.startfile(selected['url'])
    else:
        control = selected['control']
        pattern = control.GetInvokePattern()
        if pattern:
            pattern.Invoke()
        else:
            legacy = control.GetLegacyIAccessiblePattern()
            if not legacy:
                raise RuntimeError('This browser did not expose an accessible video action. No click was performed.')
            legacy.DoDefaultAction()
    return {'dispatched': True, 'verified_target': True, 'playback_verified': False,
            'url': selected['url'], 'title': selected['name'],
            'message': f"Opened video {index}: {selected['name'] or 'YouTube video'}. Playback has not been verified."}
