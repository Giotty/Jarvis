"""Read installed Steam manifests only; never inspect live game memory/data."""
import os
import re
import winreg
from pathlib import Path


def installed():
    roots=[]
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Valve\Steam') as key:
            roots.append(Path(winreg.QueryValueEx(key,'SteamPath')[0]))
    except OSError:
        pass
    default=Path(os.environ.get('PROGRAMFILES(X86)',os.environ['PROGRAMFILES']))/'Steam'
    if default not in roots: roots.append(default)
    for root in list(roots):
        file=root/'steamapps'/'libraryfolders.vdf'
        if file.is_file():
            for value in re.findall(r'"path"\s+"([^"]+)"',file.read_text(encoding='utf-8',errors='replace')):
                library=Path(value.replace('\\\\','\\'))
                if library.is_absolute() and library not in roots: roots.append(library)
    games=[]
    for root in roots:
        for manifest in (root/'steamapps').glob('appmanifest_*.acf'):
            text=manifest.read_text(encoding='utf-8',errors='replace')[:64000]
            fields=dict(re.findall(r'"(appid|name|installdir|LastPlayed)"\s+"([^"]*)"',text,re.I))
            app=fields.get('appid','')
            directory=fields.get('installdir','')
            if app.isdigit() and fields.get('name') and directory and (root/'steamapps'/'common'/directory).is_dir():
                games.append({'id':app,'name':fields['name'],'launcher':'steam','lastPlayed':fields.get('LastPlayed')})
    return {'games':games[:200]}
