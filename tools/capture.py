# Receives frames and clips POSTed from the game page (film mode) and writes
# them to a folder: PNG data URLs become capture-N.png, raw bodies sent to
# /?name=clip.mp4 are written as-is.
#   python3 tools/capture.py OUT_DIR        -> listens on 127.0.0.1:8091
import base64
import http.server
import os
import sys
import urllib.parse

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(OUT, exist_ok=True)


class Receiver(http.server.BaseHTTPRequestHandler):
    n = 0

    def do_POST(self):
        body = self.rfile.read(int(self.headers['Content-Length']))
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if 'name' in query:
            path, data = os.path.join(OUT, os.path.basename(query['name'][0])), body
        else:
            path = os.path.join(OUT, f'capture-{Receiver.n}.png')
            Receiver.n += 1
            data = base64.b64decode(body.decode().split(',', 1)[1])
        with open(path, 'wb') as f:
            f.write(data)
        print('saved', path, len(data), flush=True)
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

    def log_message(self, *args):
        pass


http.server.HTTPServer(('127.0.0.1', 8091), Receiver).serve_forever()
