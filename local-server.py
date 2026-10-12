# Copyright 2026 Anyu. SPDX-License-Identifier: AGPL-3.0-only
from __future__ import annotations
import functools, http.server, json, os, secrets, socketserver, subprocess, sys, threading, time, urllib.request, webbrowser
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE/('app' if (HERE/'app'/'index.html').is_file() else 'dist')
STATE=HERE/'.afterimage-runtime.json'
HOST='127.0.0.1'
def health():
    try:
        state=json.loads(STATE.read_text(encoding='utf-8'))
        if Path(state['root']).resolve()!=HERE or not 4173<=state['port']<=4193:return None
        with urllib.request.urlopen(f"http://{HOST}:{state['port']}/__afterimage_health",timeout=1.2) as res:value=json.load(res)
        return state if value.get('tool')=='afterimage' and Path(value['root']).resolve()==HERE and value['pid']==state['pid'] else None
    except Exception:return None
def check():
    if not (ROOT/'index.html').is_file() or not (ROOT/'models'/'resources.json').is_file():raise RuntimeError('Missing app entry or model files; extract the complete package.')
def open_browser(url):
    if '--no-open' not in sys.argv:webbrowser.open(url)
def start():
    check();state=health()
    if not state:
        flags=getattr(subprocess,'CREATE_NO_WINDOW',0) if os.name=='nt' else 0
        with (HERE/'startup.log').open('a',encoding='utf-8') as log:
            subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'--no-open'],cwd=str(HERE),stdin=subprocess.DEVNULL,stdout=log,stderr=log,creationflags=flags,start_new_session=os.name!='nt')
        for _ in range(80):
            time.sleep(.125);state=health()
            if state:break
    if not state:raise RuntimeError('Server failed to start; ask your Agent to inspect startup.log.')
    url=f"http://{HOST}:{state['port']}/";print('READY '+url);open_browser(url)
def stop():
    state=health()
    if not state:print('No running server for this folder.');return
    req=urllib.request.Request(f"http://{HOST}:{state['port']}/__afterimage_stop",data=b'',headers={'X-Afterimage-Token':state['token']},method='POST')
    with urllib.request.urlopen(req,timeout=2.5) as response:response.read()
    print('Stopped this local tool.')
class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path=='/__afterimage_health':
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers()
            self.wfile.write(json.dumps({'tool':'afterimage','root':str(HERE),'pid':os.getpid()}).encode());return
        super().do_GET()
    def do_POST(self):
        if self.path!='/__afterimage_stop' or not secrets.compare_digest(self.headers.get('X-Afterimage-Token',''),self.server.stop_token):
            self.send_error(403);return
        self.send_response(200);self.end_headers();self.wfile.write(b'Stopped')
        def shutdown():
            try:
                if json.loads(STATE.read_text(encoding='utf-8')).get('pid')==os.getpid():STATE.unlink()
            except Exception:pass
            self.server.shutdown()
        threading.Thread(target=shutdown,daemon=True).start()
    def end_headers(self):
        self.send_header('Cache-Control','no-cache');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer');super().end_headers()
class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address=True
    daemon_threads=True
def serve():
    check();handler=functools.partial(Handler,directory=str(ROOT))
    for port in range(4173,4194):
        try:server=Server((HOST,port),handler);break
        except OSError:continue
    else:raise RuntimeError('Ports 4173-4193 are occupied.')
    server.stop_token=secrets.token_hex(24)
    with server:
        STATE.write_text(json.dumps({'root':str(HERE),'pid':os.getpid(),'port':port,'token':server.stop_token}),encoding='utf-8')
        url=f'http://{HOST}:{port}/';print('READY '+url,flush=True);open_browser(url);server.serve_forever()
if __name__=='__main__':
    try:
        if '--check' in sys.argv:check();print('OK: entry and offline model manifest present.')
        elif '--start' in sys.argv:start()
        elif '--stop' in sys.argv:stop()
        else:serve()
    except Exception as error:print(str(error),file=sys.stderr);sys.exit(1)
