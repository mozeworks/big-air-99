# Local dev server that never lets the browser cache files, so edits to the
# ES modules in src/ show up on a plain reload.
#   python3 tools/serve.py          -> http://localhost:8090
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8090


class NoCache(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


print(f'Serving {ROOT} at http://localhost:{PORT}')
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), NoCache).serve_forever()
