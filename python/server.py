import os
import json
import urllib.request
import urllib.parse
import http.server
import socketserver
import threading
import time

from db import (
    init_db, get_db_status, load_watchlist, save_watchlist, add_to_watchlist, remove_from_watchlist,
    get_user, upsert_user, update_user_settings, get_public_users,
    get_user_connections, manage_connection, add_rating, get_ratings, delete_rating,
    add_comment, get_comments, get_comment, delete_comment, get_user_activity,
    add_custom_reminder, get_user_reminders, get_due_reminders, mark_reminder_sent, delete_custom_reminder
)

PORT = int(os.getenv("PORT", 8000))
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(BASE_DIR, 'web')

# Auto-load .env file if present
env_path = os.path.join(BASE_DIR, '.env')
if os.path.exists(env_path):
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())

DEFAULT_TMDB_API_KEY = "802b2c4b88ea1183e50e6b285a27696e"

_TMDB_CACHE = {}

def get_media_brief(tmdb_id, media_type="movie"):
    try:
        t_id = int(tmdb_id)
    except Exception:
        return {"title": "Media", "poster_path": None, "type": media_type}
    if t_id in _TMDB_CACHE:
        return _TMDB_CACHE[t_id]
    api_key = get_tmdb_key()
    for mtype in [media_type, "movie", "tv"]:
        try:
            url = f"https://api.themoviedb.org/3/{mtype}/{t_id}?api_key={api_key}"
            req = urllib.request.Request(url, headers={'User-Agent': 'VESPER/1.0'})
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                title = data.get('title') or data.get('name') or "Media Title"
                poster = data.get('poster_path')
                poster_url = f"https://image.tmdb.org/t/p/w500{poster}" if poster else None
                info = {"title": title, "poster_path": poster_url, "type": mtype}
                _TMDB_CACHE[t_id] = info
                return info
        except Exception:
            continue
    info = {"title": f"Media #{t_id}", "poster_path": None, "type": media_type}
    _TMDB_CACHE[t_id] = info
    return info

def get_tmdb_key():
    return os.getenv("TMDB_API_KEY") or DEFAULT_TMDB_API_KEY

# Initialize DB on server startup
init_db()

def clean_ntfy_topic(topic):
    if not topic:
        return ""
    t = str(topic).strip()
    if "ntfy.sh/" in t:
        t = t.split("ntfy.sh/")[-1]
    t = t.strip("/").replace(" ", "-")
    return t

def send_user_ntfy_detailed(ntfy_topic, title, message, tags="clapper,popcorn", priority="default", click_url=None):
    clean_topic = clean_ntfy_topic(ntfy_topic)
    if not clean_topic:
        print("[NTFY WARN] Empty or invalid ntfy topic provided.")
        return False, "Empty or invalid ntfy topic."
    url = f"https://ntfy.sh/{clean_topic}"
    headers = {
        "Title": title,
        "Priority": priority,
        "Tags": tags,
        "User-Agent": "VESPER-MediaTracker/1.0"
    }
    if click_url:
        headers["Click"] = click_url

    # 1. Try with requests library
    try:
        import requests
        resp = requests.post(url, data=message.encode("utf-8"), headers=headers, timeout=10)
        if resp.status_code == 200:
            return True, None
        else:
            print(f"[NTFY ERROR] ntfy.sh returned HTTP {resp.status_code}: {resp.text}")
    except Exception as req_err:
        print(f"[NTFY NOTICE] requests.post encountered issue ({req_err}), trying urllib fallback...")

    # 2. Fallback to standard library urllib
    try:
        req = urllib.request.Request(
            url,
            data=message.encode("utf-8"),
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                return True, None
            return False, f"ntfy.sh returned HTTP {resp.status}"
    except urllib.error.HTTPError as http_err:
        err_body = http_err.read().decode('utf-8', errors='replace') if hasattr(http_err, 'read') else ''
        print(f"[NTFY HTTP ERROR] Status {http_err.code}: {err_body}")
        return False, f"HTTP {http_err.code}: {err_body}"
    except Exception as e:
        import traceback
        print("[NTFY ERROR] Failed to send push alert:", e)
        print(traceback.format_exc())
        return False, str(e)

def send_user_ntfy(ntfy_topic, title, message, tags="clapper,popcorn", priority="default", click_url=None):
    success, _ = send_user_ntfy_detailed(ntfy_topic, title, message, tags=tags, priority=priority, click_url=click_url)
    return success

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def end_headers(self):
        # Prevent browser from caching static files
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def _send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Id')

    def _send_json_response(self, status_code, data_dict):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data_dict, indent=2, default=str).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query_params = urllib.parse.parse_qs(parsed.query)

        if path in ('/watchlist.json', '/api/watchlist'):
            user_id = query_params.get('user_id', ['default_user'])[0]
            watchlist = load_watchlist(user_id=user_id)
            self._send_json_response(200, watchlist)

        elif path == '/api/user/profile':
            uid = query_params.get('uid', [''])[0]
            user = get_user(uid)
            if user:
                self._send_json_response(200, user)
            else:
                self._send_json_response(404, {"error": "User not found."})

        elif path == '/api/users/search':
            current_uid = query_params.get('current_uid', [None])[0]
            query = query_params.get('query', [None])[0]
            users = get_public_users(current_uid=current_uid, query=query)
            self._send_json_response(200, users)

        elif path == '/api/connections':
            user_id = query_params.get('user_id', [''])[0]
            connections = get_user_connections(user_id)
            self._send_json_response(200, connections)

        elif path == '/api/watch-url':
            query = query_params.get('query', [''])[0]
            encoded_query = urllib.parse.quote(query)
            watch_url = f"https://hydrahd.ws/index.php?menu=search&query={encoded_query}"
            self._send_json_response(200, {"url": watch_url, "title": query})

        elif path == '/api/ratings':
            tmdb_id = query_params.get('tmdb_id', [None])[0]
            user_id = query_params.get('user_id', [None])[0]
            ratings = get_ratings(tmdb_id=tmdb_id, user_id=user_id)
            self._send_json_response(200, ratings)

        elif path == '/api/comments':
            tmdb_id = query_params.get('tmdb_id', [None])[0]
            target_user_id = query_params.get('target_user_id', [None])[0]
            comments = get_comments(tmdb_id=tmdb_id, target_user_id=target_user_id)
            self._send_json_response(200, comments)

        elif path == '/api/reminders':
            user_id = query_params.get('user_id', [''])[0]
            reminders = get_user_reminders(user_id)
            self._send_json_response(200, reminders)

        elif path == '/api/discover':
            tmdb_key = get_tmdb_key()
            category = query_params.get('category', ['trending'])[0]

            if category == 'popular_movies':
                url = f"https://api.themoviedb.org/3/movie/popular?api_key={tmdb_key}"
                default_type = 'movie'
            elif category == 'popular_tv':
                url = f"https://api.themoviedb.org/3/tv/popular?api_key={tmdb_key}"
                default_type = 'tv'
            elif category == 'upcoming':
                url = f"https://api.themoviedb.org/3/movie/upcoming?api_key={tmdb_key}"
                default_type = 'movie'
            elif category == 'now_playing':
                url = f"https://api.themoviedb.org/3/movie/now_playing?api_key={tmdb_key}"
                default_type = 'movie'
            else:  # trending
                url = f"https://api.themoviedb.org/3/trending/all/week?api_key={tmdb_key}"
                default_type = None

            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'MediaTracker/1.0'})
                with urllib.request.urlopen(req) as resp:
                    resp_data = json.loads(resp.read().decode('utf-8'))
                    if default_type:
                        for item in resp_data.get('results', []):
                            if 'media_type' not in item:
                                item['media_type'] = default_type
                    self._send_json_response(200, resp_data)
            except Exception as e:
                self._send_json_response(500, {"error": str(e)})

        elif path == '/api/search':
            tmdb_key = get_tmdb_key()
            query = query_params.get('query', [''])[0]

            if not query:
                self._send_json_response(400, {"error": "Missing search query parameter."})
                return

            try:
                url = f"https://api.themoviedb.org/3/search/multi?api_key={tmdb_key}&query={urllib.parse.quote(query)}"
                req = urllib.request.Request(url, headers={'User-Agent': 'MediaTracker/1.0'})
                with urllib.request.urlopen(req) as resp:
                    resp_data = json.loads(resp.read().decode('utf-8'))
                    self._send_json_response(200, resp_data)
            except Exception as e:
                self._send_json_response(500, {"error": str(e)})

        elif path == '/api/details':
            tmdb_key = get_tmdb_key()
            media_type = query_params.get('type', ['movie'])[0]
            media_id = query_params.get('id', [''])[0]

            try:
                url = f"https://api.themoviedb.org/3/{media_type}/{media_id}?api_key={tmdb_key}&append_to_response=credits,release_dates,recommendations"
                req = urllib.request.Request(url, headers={'User-Agent': 'MediaTracker/1.0'})
                with urllib.request.urlopen(req) as resp:
                    resp_data = json.loads(resp.read().decode('utf-8'))
                    self._send_json_response(200, resp_data)
            except Exception as e:
                self._send_json_response(500, {"error": str(e)})

        elif path == '/api/user/activity':
            user_id = query_params.get('user_id', [''])[0]
            if not user_id:
                self._send_json_response(400, {"error": "Missing user_id parameter."})
                return
            activity = get_user_activity(user_id)
            for r in activity.get('ratings', []):
                if not r.get('title') or not r.get('poster_path'):
                    b = get_media_brief(r['tmdb_id'], r.get('type', 'movie'))
                    if not r.get('title'): r['title'] = b['title']
                    if not r.get('poster_path'): r['poster_path'] = b['poster_path']
                    if not r.get('type'): r['type'] = b['type']
            for c in activity.get('comments', []):
                if not c.get('title') or not c.get('poster_path'):
                    b = get_media_brief(c['tmdb_id'], c.get('type', 'movie'))
                    if not c.get('title'): c['title'] = b['title']
                    if not c.get('poster_path'): c['poster_path'] = b['poster_path']
                    if not c.get('type'): c['type'] = b['type']
            self._send_json_response(200, activity)

        elif path == '/api/recommendations':
            tmdb_key = get_tmdb_key()
            media_type = query_params.get('type', ['movie'])[0]
            media_id = query_params.get('id', [''])[0]

            try:
                url = f"https://api.themoviedb.org/3/{media_type}/{media_id}/recommendations?api_key={tmdb_key}"
                req = urllib.request.Request(url, headers={'User-Agent': 'MediaTracker/1.0'})
                with urllib.request.urlopen(req) as resp:
                    resp_data = json.loads(resp.read().decode('utf-8'))
                    self._send_json_response(200, resp_data)
            except Exception as e:
                self._send_json_response(500, {"error": str(e)})

        elif path == '/api/db-status':
            status = get_db_status()
            self._send_json_response(200 if status.get('connected') else 503, status)

        elif path in ('/api/cron/check', '/api/cron/trigger'):
            reminders_sent = process_pending_reminders()
            try:
                from checker import check_releases
                check_releases()
                self._send_json_response(200, {"status": "success", "message": "Release check and reminder dispatch triggered successfully.", "reminders_sent": reminders_sent})
            except Exception as e:
                print("[CRON ERROR]:", e)
                self._send_json_response(500, {"status": "error", "error": str(e), "reminders_sent": reminders_sent})

        else:
            super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body_bytes = self.rfile.read(content_length) if content_length > 0 else b'{}'
        try:
            body = json.loads(body_bytes.decode('utf-8'))
        except Exception:
            body = {}

        path = self.path

        if path == '/api/user/sync':
            uid = body.get('uid')
            email = body.get('email')
            display_name = body.get('display_name')
            photo_url = body.get('photo_url')
            if not uid or not email:
                self._send_json_response(400, {"error": "Missing uid or email."})
                return
            user = upsert_user(uid, email, display_name, photo_url)
            self._send_json_response(200, user)

        elif path == '/api/user/settings':
            uid = body.get('uid')
            is_public = body.get('is_public')
            ntfy_topic = body.get('ntfy_topic')
            onboarded = body.get('onboarded')
            if not uid:
                self._send_json_response(400, {"error": "Missing uid."})
                return
            updated_user = update_user_settings(uid, is_public=is_public, ntfy_topic=ntfy_topic, onboarded=onboarded)
            self._send_json_response(200, updated_user)

        elif path == '/api/ntfy/test':
            topic = body.get('ntfy_topic')
            if not topic:
                self._send_json_response(400, {"error": "Missing ntfy_topic."})
                return
            sent, err = send_user_ntfy_detailed(topic, "VESPER Alert Test", "Your ntfy push notification setup is working successfully!", tags="tada,clapper", priority="high")
            if sent:
                self._send_json_response(200, {"status": "success", "message": "Test notification sent!"})
            else:
                self._send_json_response(500, {"error": f"Failed to dispatch test notification to ntfy.sh: {err or 'Unknown error'}"})

        elif path in ('/save-watchlist', '/api/watchlist'):
            try:
                # Check if bulk array or single item addition
                if isinstance(body, list):
                    user_id = self.headers.get('X-User-Id', 'default_user')
                    save_watchlist(body, user_id=user_id)
                    self._send_json_response(200, {"status": "success", "message": f"Watchlist saved for {user_id}!"})
                else:
                    user_id = body.get('user_id') or self.headers.get('X-User-Id', 'default_user')
                    item = body.get('item') or body
                    copied_from_uid = body.get('copied_from_uid')
                    
                    success = add_to_watchlist(item, user_id=user_id)
                    
                    # Notify original owner if copied from another user's watchlist
                    if success and copied_from_uid:
                        try:
                            original_user = get_user(copied_from_uid)
                            copier_user = get_user(user_id)
                            copier_name = copier_user.get('display_name') if copier_user else "A friend"
                            if original_user and original_user.get('ntfy_topic'):
                                send_user_ntfy(
                                    original_user['ntfy_topic'],
                                    "Watchlist Activity",
                                    f"'{copier_name}' added '{item.get('title')}' from your watchlist into theirs!",
                                    tags="sparkles,clapper"
                                )
                        except Exception as e_ntfy:
                            print("[NOTICE] Ntfy notification skipped:", e_ntfy)

                    if success:
                        self._send_json_response(200, {"status": "success", "message": "Item added to watchlist."})
                    else:
                        self._send_json_response(500, {"error": "Failed to add item to watchlist."})
            except Exception as e:
                print("[ERROR] /api/watchlist POST failed:", e)
                self._send_json_response(500, {"error": str(e)})

        elif path == '/api/watchlist/remove':
            user_id = body.get('user_id') or self.headers.get('X-User-Id', 'default_user')
            tmdb_id = body.get('tmdb_id')
            if not tmdb_id:
                self._send_json_response(400, {"error": "Missing tmdb_id."})
                return
            success = remove_from_watchlist(tmdb_id, user_id=user_id)
            if success:
                self._send_json_response(200, {"status": "success", "message": "Item removed from watchlist."})
            else:
                self._send_json_response(500, {"error": "Failed to remove item."})

        elif path == '/api/connections':
            requester_id = body.get('requester_id')
            receiver_id = body.get('receiver_id')
            action = body.get('action', 'request')
            if not requester_id or not receiver_id:
                self._send_json_response(400, {"error": "Missing requester_id or receiver_id."})
                return
            success = manage_connection(requester_id, receiver_id, action)
            if success and action == "request":
                receiver = get_user(receiver_id)
                requester = get_user(requester_id)
                req_name = requester.get('display_name') if requester else "A user"
                if receiver and receiver.get('ntfy_topic'):
                    send_user_ntfy(
                        receiver['ntfy_topic'],
                        "New Connection Request",
                        f"'{req_name}' connected with you on VESPER!",
                        tags="handshake,busts_in_silhouette"
                    )
            self._send_json_response(200, {"status": "success", "message": "Connection updated."})

        elif path == '/api/ratings':
            user_id = body.get('user_id')
            tmdb_id = body.get('tmdb_id')
            score = body.get('score')
            review = body.get('review', '')
            if not user_id or not tmdb_id or score is None:
                self._send_json_response(400, {"error": "Missing user_id, tmdb_id, or score."})
                return
            success = add_rating(user_id, tmdb_id, score, review)
            self._send_json_response(200, {"status": "success" if success else "error"})

        elif path == '/api/comments':
            user_id = body.get('user_id')
            tmdb_id = body.get('tmdb_id')
            content = body.get('content')
            target_user_id = body.get('target_user_id')
            parent_id = body.get('parent_id')
            media_title = body.get('media_title', 'Media')
            if not user_id or not tmdb_id or not content:
                self._send_json_response(400, {"error": "Missing user_id, tmdb_id, or content."})
                return
            success = add_comment(user_id, tmdb_id, content, target_user_id=target_user_id, parent_id=parent_id)
            if success:
                commenter = get_user(user_id)
                c_name = commenter.get('display_name') if commenter else "Someone"
                if parent_id:
                    parent_comm = get_comment(parent_id)
                    if parent_comm and parent_comm.get('user_id') != user_id:
                        parent_user = get_user(parent_comm['user_id'])
                        if parent_user and parent_user.get('ntfy_topic'):
                            send_user_ntfy(
                                parent_user['ntfy_topic'],
                                f"New Reply from {c_name}",
                                f"{c_name} replied: \"{content[:60]}\"",
                                tags="speech_balloon,clapper"
                            )
                elif target_user_id and target_user_id != user_id:
                    target_user = get_user(target_user_id)
                    if target_user and target_user.get('ntfy_topic'):
                        send_user_ntfy(
                            target_user['ntfy_topic'],
                            f"New Comment from {c_name}",
                            f"{c_name} commented on {media_title}: \"{content[:60]}\"",
                            tags="speech_balloon,clapper"
                        )
            self._send_json_response(200, {"status": "success" if success else "error"})

        elif path == '/api/ratings/delete':
            user_id = body.get('user_id')
            rating_id = body.get('rating_id')
            if not user_id or not rating_id:
                self._send_json_response(400, {"error": "Missing user_id or rating_id."})
                return
            success = delete_rating(rating_id, user_id)
            self._send_json_response(200, {"status": "success" if success else "error"})

        elif path == '/api/comments/delete':
            user_id = body.get('user_id')
            comment_id = body.get('comment_id')
            if not user_id or not comment_id:
                self._send_json_response(400, {"error": "Missing user_id or comment_id."})
                return
            success = delete_comment(comment_id, user_id)
            self._send_json_response(200, {"status": "success" if success else "error"})

        elif path == '/api/reminders':
            user_id = body.get('user_id')
            tmdb_id = body.get('tmdb_id')
            media_title = body.get('media_title')
            media_type = body.get('media_type', 'movie')
            poster_path = body.get('poster_path', '')
            remind_at = body.get('remind_at')
            note = body.get('note', '')

            if not user_id or not tmdb_id or not media_title or not remind_at:
                self._send_json_response(400, {"error": "Missing required fields (user_id, tmdb_id, media_title, remind_at)."})
                return

            res = add_custom_reminder(user_id, tmdb_id, media_title, media_type, poster_path, remind_at, note)
            if res:
                self._send_json_response(200, res)
            else:
                self._send_json_response(500, {"error": "Failed to create reminder."})

        elif path == '/api/reminders/delete':
            user_id = body.get('user_id')
            reminder_id = body.get('reminder_id')
            if not user_id or not reminder_id:
                self._send_json_response(400, {"error": "Missing user_id or reminder_id."})
                return
            success = delete_custom_reminder(reminder_id, user_id)
            self._send_json_response(200, {"status": "success" if success else "error"})

        elif path == '/api/check-releases':
            try:
                from checker import check_releases
                threading.Thread(target=check_releases, daemon=True).start()
                self._send_json_response(200, {"status": "success", "message": "Release check started in background."})
            except Exception as e:
                self._send_json_response(500, {"error": f"Failed to run release checker: {e}"})

        else:
            self._send_json_response(404, {"error": "Endpoint not found."})

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query_params = urllib.parse.parse_qs(parsed.query)

        if path == '/api/watchlist':
            user_id = query_params.get('user_id', ['default_user'])[0]
            tmdb_id = query_params.get('tmdb_id', [''])[0]
            if not tmdb_id:
                self._send_json_response(400, {"error": "Missing tmdb_id query parameter."})
                return
            success = remove_from_watchlist(tmdb_id, user_id=user_id)
            self._send_json_response(200, {"status": "success" if success else "error"})
        elif path == '/api/ratings':
            user_id = query_params.get('user_id', [''])[0]
            rating_id = query_params.get('rating_id', [''])[0]
            if not user_id or not rating_id:
                self._send_json_response(400, {"error": "Missing user_id or rating_id parameter."})
                return
            success = delete_rating(rating_id, user_id)
            self._send_json_response(200, {"status": "success" if success else "error"})
        elif path == '/api/comments':
            user_id = query_params.get('user_id', [''])[0]
            comment_id = query_params.get('comment_id', [''])[0]
            if not user_id or not comment_id:
                self._send_json_response(400, {"error": "Missing user_id or comment_id parameter."})
                return
            success = delete_comment(comment_id, user_id)
            self._send_json_response(200, {"status": "success" if success else "error"})
        elif path == '/api/reminders':
            user_id = query_params.get('user_id', [''])[0]
            reminder_id = query_params.get('reminder_id', [''])[0]
            if not user_id or not reminder_id:
                self._send_json_response(400, {"error": "Missing user_id or reminder_id parameter."})
                return
            success = delete_custom_reminder(reminder_id, user_id)
            self._send_json_response(200, {"status": "success" if success else "error"})
        else:
            self._send_json_response(404, {"error": "Endpoint not found."})

def process_pending_reminders():
    sent_count = 0
    try:
        due_reminders = get_due_reminders()
        for rem in due_reminders:
            user = get_user(rem['user_id'])
            if user and user.get('ntfy_topic'):
                topic = user['ntfy_topic'].strip()
                title = f"⏰ Time to Watch: {rem['media_title']}"
                msg = rem['note'] if rem.get('note') else f"Your scheduled watch reminder for '{rem['media_title']}' is here! Enjoy the show."
                mtype = rem.get('media_type', 'movie')
                click_url = f"https://hydrahd.ws/index.php?menu=search&query={urllib.parse.quote(rem['media_title'])}"
                send_user_ntfy(
                    ntfy_topic=topic,
                    title=title,
                    message=msg,
                    tags="alarm_clock,movie_camera",
                    priority="high",
                    click_url=click_url
                )
                sent_count += 1
                print(f"[REMINDER SENT] Sent watch reminder to '{topic}' for {rem['media_title']}")
            mark_reminder_sent(rem['id'])
    except Exception as e:
        print("[REMINDERS PROCESS ERROR]:", e)
    return sent_count

def start_release_checker_daemon():
    def _checker_loop():
        time.sleep(3)
        while True:
            try:
                print("[DAEMON] Running scheduled VESPER release countdown check...")
                from checker import check_releases
                check_releases()
            except Exception as e:
                print("[DAEMON ERROR] Release check error:", e)
            # Repeat every 6 hours
            time.sleep(6 * 3600)

    def _reminders_loop():
        time.sleep(2)
        while True:
            process_pending_reminders()
            # Check every 20 seconds
            time.sleep(20)

    t1 = threading.Thread(target=_checker_loop, daemon=True)
    t1.start()

    t2 = threading.Thread(target=_reminders_loop, daemon=True)
    t2.start()

if __name__ == "__main__":
    print(f"UI & Database Server running at: http://localhost:{PORT}")
    print("Press Ctrl+C to stop.")

    start_release_checker_daemon()

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        httpd.serve_forever()

