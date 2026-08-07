import os
import json
import urllib.request
import urllib.parse
import http.server
import socketserver

from db import init_db, load_watchlist, save_watchlist

PORT = int(os.getenv("PORT", 8000))
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(BASE_DIR, 'web')

# Initialize DB on server startup
init_db()

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def _send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query_params = urllib.parse.parse_qs(parsed.query)

        if path == '/watchlist.json' or path == '/api/watchlist':
            watchlist = load_watchlist()
            data = json.dumps(watchlist, indent=2, default=lambda o: float(o) if hasattr(o, '__float__') else str(o)).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(data)

        elif path == '/api/search':
            tmdb_key = os.getenv("TMDB_API_KEY")
            query = query_params.get('query', [''])[0]

            if not tmdb_key:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(b'{"error": "TMDB_API_KEY environment variable is not set on the server."}')
                return

            if not query:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(b'{"error": "Missing search query parameter."}')
                return

            try:
                url = f"https://api.themoviedb.org/3/search/multi?api_key={tmdb_key}&query={urllib.parse.quote(query)}"
                req = urllib.request.Request(url, headers={'User-Agent': 'MediaTracker/1.0'})
                with urllib.request.urlopen(req) as resp:
                    resp_data = resp.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(resp_data)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))

        elif path == '/api/details':
            tmdb_key = os.getenv("TMDB_API_KEY")
            media_type = query_params.get('type', ['movie'])[0]
            media_id = query_params.get('id', [''])[0]

            if not tmdb_key:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(b'{"error": "TMDB_API_KEY environment variable is not set on the server."}')
                return

            try:
                url = f"https://api.themoviedb.org/3/{media_type}/{media_id}?api_key={tmdb_key}&append_to_response=credits,release_dates"
                req = urllib.request.Request(url, headers={'User-Agent': 'MediaTracker/1.0'})
                with urllib.request.urlopen(req) as resp:
                    resp_data = resp.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(resp_data)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))

        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/save-watchlist' or self.path == '/api/watchlist':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8'))
                save_watchlist(data)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(b'{"status": "success", "message": "Watchlist saved to database!"}')
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        else:
            self.send_error(404)

if __name__ == "__main__":
    print(f"🚀 UI & Database Server running at: http://localhost:{PORT}")
    print("Press Ctrl+C to stop.")

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        httpd.serve_forever()
