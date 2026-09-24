"""Dev preview server: serves the repo root (screenshots, release artifacts)
with / mapped to preview/index.html. Range requests supported for downloads.
Usage: python3 preview/serve.py [port]
"""
import os
import re
import sys
import mimetypes
import posixpath
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
INDEX = os.path.join(ROOT, 'preview', 'index.html')


class Handler(BaseHTTPRequestHandler):
    def _path(self):
        name = urllib.parse.unquote(self.path.split('?')[0])
        if name in ('/', '/index.html'):
            return INDEX
        p = os.path.realpath(posixpath.normpath(os.path.join(ROOT, name.lstrip('/'))))
        return p if (p == ROOT or p.startswith(ROOT + os.sep)) and os.path.isfile(p) else None

    def do_HEAD(self):
        self.do_GET(headers_only=True)

    def do_GET(self, headers_only=False):
        target = self._path()
        if not target:
            self.send_response(404)
            self.end_headers()
            return
        try:
            size = os.path.getsize(target)
        except OSError:
            self.send_response(404)
            self.end_headers()
            return
        start, end = 0, size - 1
        status = 200
        rng = self.headers.get('Range')
        m = re.match(r'bytes=(\d*)-(\d*)', rng or '')
        if rng and m and (m.group(1) or m.group(2)):
            start = int(m.group(1) or 0)
            end = int(m.group(2)) if m.group(2) else size - 1
            end = min(end, size - 1)
            if start > end:
                self.send_response(416)
                self.end_headers()
                return
            status = 206
        ctype = mimetypes.guess_type(target)[0] or 'application/octet-stream'
        length = end - start + 1
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(length))
        self.send_header('Accept-Ranges', 'bytes')
        if status == 206:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if headers_only:
            return
        with open(target, 'rb') as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(65536, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                remaining -= len(chunk)

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
