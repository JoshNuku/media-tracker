import os
import json
import sqlite3

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "media_tracker.db")
WATCHLIST_FILE = os.path.join(BASE_DIR, "watchlist.json")

def get_db_url():
    url = os.getenv("DATABASE_URL")
    if url and url.strip():
        return url.strip()
    return None

def get_masked_db_url():
    url = get_db_url()
    if not url:
        return f"SQLite ({DB_PATH})"
    try:
        # Mask user:password in postgres://user:pass@host/db
        parts = url.split('@')
        if len(parts) == 2:
            prefix = parts[0].split('//')[0] + "//***:***"
            return f"{prefix}@{parts[1]}"
    except Exception:
        pass
    return "PostgreSQL (Configured)"

def get_connection():
    db_url = get_db_url()
    if db_url:
        import psycopg2
        url = db_url.strip()
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        
        # Connect to PostgreSQL (try direct, fallback to sslmode='require')
        try:
            if "sslmode=" not in url and ("render.com" in url or "dpg-" in url or "amazonaws.com" in url or "supabase" in url):
                conn = psycopg2.connect(url, sslmode='require', connect_timeout=10)
            else:
                conn = psycopg2.connect(url, connect_timeout=10)
            return conn
        except Exception as e:
            try:
                conn = psycopg2.connect(url, sslmode='require', connect_timeout=10)
                return conn
            except Exception as e2:
                print(f"[VESPER DB FATAL] Failed to connect to PostgreSQL: {e2}")
                raise e2
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn

def clean_float(val):
    if val is None or val == "" or val == "N/A" or val == "null":
        return None
    try:
        f = float(val)
        return f if f == f else None  # Filter out NaN
    except (ValueError, TypeError):
        return None

def get_db_status():
    db_url = get_db_url()
    status = {
        "engine": "postgresql" if db_url else "sqlite",
        "database_url_configured": bool(db_url),
        "target": get_masked_db_url(),
        "connected": False,
        "users_count": 0,
        "watchlist_count": 0,
        "error": None
    }
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM users;")
        u_row = cursor.fetchone()
        status["users_count"] = u_row[0] if u_row else 0
        
        cursor.execute("SELECT COUNT(*) FROM watchlist;")
        w_row = cursor.fetchone()
        status["watchlist_count"] = w_row[0] if w_row else 0
        
        status["connected"] = True
        conn.close()
    except Exception as e:
        status["error"] = str(e)
    return status

def init_db():
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        
        # 1. Users table
        if db_url:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    uid VARCHAR(128) PRIMARY KEY,
                    email TEXT,
                    display_name TEXT,
                    photo_url TEXT,
                    is_public BOOLEAN DEFAULT TRUE,
                    ntfy_topic TEXT,
                    onboarded BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
        else:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    uid TEXT PRIMARY KEY,
                    email TEXT,
                    display_name TEXT,
                    photo_url TEXT,
                    is_public INTEGER DEFAULT 1,
                    ntfy_topic TEXT,
                    onboarded INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

        # 2. Watchlist table
        if db_url:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS watchlist (
                    user_id VARCHAR(128) DEFAULT 'default_user',
                    tmdb_id INT NOT NULL,
                    type VARCHAR(10) NOT NULL,
                    title TEXT NOT NULL,
                    poster_path TEXT,
                    vote_average NUMERIC,
                    release_year VARCHAR(10),
                    overview TEXT,
                    status VARCHAR(20) DEFAULT 'plan_to_watch',
                    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, tmdb_id)
                );
            """)
        else:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS watchlist (
                    user_id TEXT DEFAULT 'default_user',
                    tmdb_id INTEGER NOT NULL,
                    type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    poster_path TEXT,
                    vote_average REAL,
                    release_year TEXT,
                    overview TEXT,
                    status TEXT DEFAULT 'plan_to_watch',
                    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, tmdb_id)
                );
            """)

        # Safe Column migrations for existing watchlist tables without aborting transactions
        try:
            if db_url:
                cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'watchlist' AND column_name = 'user_id';")
                if not cursor.fetchone():
                    cursor.execute("ALTER TABLE watchlist ADD COLUMN user_id VARCHAR(128) DEFAULT 'default_user';")
                
                cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'watchlist' AND column_name = 'status';")
                if not cursor.fetchone():
                    cursor.execute("ALTER TABLE watchlist ADD COLUMN status VARCHAR(20) DEFAULT 'plan_to_watch';")
            else:
                cursor.execute("PRAGMA table_info(watchlist);")
                cols = [row[1] for row in cursor.fetchall()]
                if 'user_id' not in cols:
                    cursor.execute("ALTER TABLE watchlist ADD COLUMN user_id TEXT DEFAULT 'default_user';")
                if 'status' not in cols:
                    cursor.execute("ALTER TABLE watchlist ADD COLUMN status TEXT DEFAULT 'plan_to_watch';")
        except Exception as e:
            print("[DB NOTICE] Watchlist column migration check:", e)

        # 3. Connections table
        if db_url:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS connections (
                    requester_id VARCHAR(128) NOT NULL,
                    receiver_id VARCHAR(128) NOT NULL,
                    status VARCHAR(20) DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (requester_id, receiver_id)
                );
            """)
        else:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS connections (
                    requester_id TEXT NOT NULL,
                    receiver_id TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (requester_id, receiver_id)
                );
            """)

        # 4. Ratings table
        if db_url:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ratings (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(128) NOT NULL,
                    tmdb_id INT NOT NULL,
                    score NUMERIC NOT NULL,
                    review TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (user_id, tmdb_id)
                );
            """)
        else:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ratings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    tmdb_id INTEGER NOT NULL,
                    score REAL NOT NULL,
                    review TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (user_id, tmdb_id)
                );
            """)

        # 5. Comments table
        if db_url:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS comments (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(128) NOT NULL,
                    tmdb_id INT NOT NULL,
                    target_user_id VARCHAR(128),
                    parent_id INT DEFAULT NULL,
                    content TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
        else:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS comments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    tmdb_id INTEGER NOT NULL,
                    target_user_id TEXT,
                    parent_id INTEGER DEFAULT NULL,
                    content TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

        # 6. Custom Reminders table
        if db_url:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS custom_reminders (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(128) NOT NULL,
                    tmdb_id INT NOT NULL,
                    media_title TEXT NOT NULL,
                    media_type VARCHAR(20) DEFAULT 'movie',
                    poster_path TEXT DEFAULT '',
                    remind_at TIMESTAMP NOT NULL,
                    note TEXT DEFAULT '',
                    is_sent BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
        else:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS custom_reminders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    tmdb_id INTEGER NOT NULL,
                    media_title TEXT NOT NULL,
                    media_type TEXT DEFAULT 'movie',
                    poster_path TEXT DEFAULT '',
                    remind_at TEXT NOT NULL,
                    note TEXT DEFAULT '',
                    is_sent INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

        # 7. Safe Unique Index Migrations (ensures ON CONFLICT works even on upgraded schemas)
        try:
            cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS watchlist_user_tmdb_uq_idx ON watchlist (user_id, tmdb_id);")
            cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS ratings_user_tmdb_uq_idx ON ratings (user_id, tmdb_id);")
            conn.commit()
        except Exception as e:
            print("[DB NOTICE] Index setup notice:", e)

        conn.commit()

        # Migrate existing watchlist.json to DB if DB watchlist for default_user is empty
        if os.path.exists(WATCHLIST_FILE):
            cursor.execute("SELECT COUNT(*) FROM watchlist WHERE user_id = 'default_user';")
            count_res = cursor.fetchone()
            count = count_res[0] if count_res else 0
            if count == 0:
                with open(WATCHLIST_FILE, "r", encoding="utf-8") as f:
                    items = json.load(f)
                    for item in items:
                        v_avg = clean_float(item.get("vote_average"))
                        if db_url:
                            cursor.execute("""
                                INSERT INTO watchlist (user_id, tmdb_id, type, title, poster_path, vote_average, release_year, overview)
                                VALUES ('default_user', %s, %s, %s, %s, %s, %s, %s)
                                ON CONFLICT (user_id, tmdb_id) DO NOTHING;
                            """, (
                                int(item.get("tmdb_id")),
                                str(item.get("type", "movie")),
                                str(item.get("title", "")),
                                str(item.get("poster_path") or ""),
                                v_avg,
                                str(item.get("release_year") or ""),
                                str(item.get("overview") or "")
                            ))
                        else:
                            cursor.execute("""
                                INSERT OR IGNORE INTO watchlist (user_id, tmdb_id, type, title, poster_path, vote_average, release_year, overview)
                                VALUES ('default_user', ?, ?, ?, ?, ?, ?, ?);
                            """, (
                                int(item.get("tmdb_id")),
                                str(item.get("type", "movie")),
                                str(item.get("title", "")),
                                str(item.get("poster_path") or ""),
                                v_avg,
                                str(item.get("release_year") or ""),
                                str(item.get("overview") or "")
                            ))
                    conn.commit()
                print("[SUCCESS] Migrated watchlist.json into Database!")

        # Migrate old mediatracker- ntfy topics to vesper-
        try:
            cursor.execute("UPDATE users SET ntfy_topic = REPLACE(ntfy_topic, 'mediatracker-', 'vesper-') WHERE ntfy_topic LIKE 'mediatracker-%';")
            conn.commit()
        except Exception:
            pass

        conn.close()
    except Exception as e:
        print("[DB ERROR] init_db failed:", e)

def get_user(uid):
    if not uid:
        return None
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        if db_url:
            cursor.execute("SELECT uid, email, display_name, photo_url, is_public, ntfy_topic, onboarded, created_at FROM users WHERE uid = %s;", (uid,))
        else:
            cursor.execute("SELECT uid, email, display_name, photo_url, is_public, ntfy_topic, onboarded, created_at FROM users WHERE uid = ?;", (uid,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            return None
        if hasattr(row, 'keys'):
            return dict(row)
        else:
            return {
                "uid": row[0],
                "email": row[1],
                "display_name": row[2],
                "photo_url": row[3],
                "is_public": bool(row[4]),
                "ntfy_topic": row[5],
                "onboarded": bool(row[6]),
                "created_at": str(row[7])
            }
    except Exception as e:
        print("[DB ERROR] get_user failed:", e)
        return None

def upsert_user(uid, email, display_name=None, photo_url=None):
    if not uid:
        return None
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        existing = get_user(uid)
        default_topic = f"vesper-{uid[:8]}"
        if not existing:
            if db_url:
                cursor.execute("""
                    INSERT INTO users (uid, email, display_name, photo_url, ntfy_topic)
                    VALUES (%s, %s, %s, %s, %s);
                """, (uid, email, display_name or email.split('@')[0], photo_url or "", default_topic))
            else:
                cursor.execute("""
                    INSERT INTO users (uid, email, display_name, photo_url, ntfy_topic)
                    VALUES (?, ?, ?, ?, ?);
                """, (uid, email, display_name or email.split('@')[0], photo_url or "", default_topic))
        else:
            if db_url:
                cursor.execute("""
                    UPDATE users SET email = %s, display_name = COALESCE(%s, display_name), photo_url = COALESCE(%s, photo_url)
                    WHERE uid = %s;
                """, (email, display_name, photo_url, uid))
            else:
                cursor.execute("""
                    UPDATE users SET email = ?, display_name = COALESCE(?, display_name), photo_url = COALESCE(?, photo_url)
                    WHERE uid = ?;
                """, (email, display_name, photo_url, uid))
        conn.commit()
        conn.close()
        return get_user(uid)
    except Exception as e:
        print("[DB ERROR] upsert_user failed:", e)
        return None

def update_user_settings(uid, is_public=None, ntfy_topic=None, onboarded=None):
    if not uid:
        return None
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        user = get_user(uid)
        if not user:
            return None
        
        new_public = is_public if is_public is not None else user["is_public"]
        new_topic = ntfy_topic.strip() if ntfy_topic is not None and ntfy_topic.strip() else user["ntfy_topic"]
        new_onboarded = onboarded if onboarded is not None else user["onboarded"]

        if db_url:
            cursor.execute("""
                UPDATE users SET is_public = %s, ntfy_topic = %s, onboarded = %s WHERE uid = %s;
            """, (new_public, new_topic, new_onboarded, uid))
        else:
            cursor.execute("""
                UPDATE users SET is_public = ?, ntfy_topic = ?, onboarded = ? WHERE uid = ?;
            """, (1 if new_public else 0, new_topic, 1 if new_onboarded else 0, uid))
        conn.commit()
        conn.close()
        return get_user(uid)
    except Exception as e:
        print("[DB ERROR] update_user_settings failed:", e)
        return None

def load_watchlist(user_id='default_user'):
    try:
        conn = get_connection()
        cursor = conn.cursor()
        db_url = get_db_url()
        if db_url:
            cursor.execute("SELECT tmdb_id, type, title, poster_path, vote_average, release_year, overview, status, added_at FROM watchlist WHERE user_id = %s ORDER BY added_at DESC;", (user_id,))
        else:
            cursor.execute("SELECT tmdb_id, type, title, poster_path, vote_average, release_year, overview, status, added_at FROM watchlist WHERE user_id = ? ORDER BY added_at DESC;", (user_id,))
        rows = cursor.fetchall()
        watchlist = []
        for row in rows:
            if isinstance(row, dict) or hasattr(row, 'keys'):
                r_dict = dict(row)
                v_avg = clean_float(r_dict.get("vote_average"))
                watchlist.append({
                    "tmdb_id": r_dict.get("tmdb_id"),
                    "type": r_dict.get("type", "movie"),
                    "title": r_dict.get("title", ""),
                    "poster_path": r_dict.get("poster_path", ""),
                    "vote_average": v_avg,
                    "release_year": r_dict.get("release_year", ""),
                    "overview": r_dict.get("overview", ""),
                    "status": r_dict.get("status", "plan_to_watch")
                })
            else:
                v_avg = clean_float(row[4])
                watchlist.append({
                    "tmdb_id": row[0],
                    "type": row[1],
                    "title": row[2],
                    "poster_path": row[3],
                    "vote_average": v_avg,
                    "release_year": row[5],
                    "overview": row[6],
                    "status": row[7] if len(row) > 7 else "plan_to_watch"
                })
        conn.close()
        return watchlist
    except Exception as e:
        print("[DB ERROR] load_watchlist failed:", e)
        if user_id == 'default_user' and os.path.exists(WATCHLIST_FILE):
            with open(WATCHLIST_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        return []

def add_to_watchlist(item, user_id='default_user'):
    if not isinstance(item, dict):
        return False
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        raw_id = item.get("tmdb_id")
        if raw_id is None:
            raw_id = item.get("id")
        if raw_id is None:
            raw_id = item.get("tmdbId")
        
        if raw_id is None or raw_id == "" or raw_id == "NaN" or str(raw_id).lower() == "none":
            print("[DB ERROR] add_to_watchlist missing valid tmdb_id in item:", item)
            return False

        tmdb_id = int(raw_id)
        v_avg = clean_float(item.get("vote_average"))
        media_type = str(item.get("type") or item.get("media_type") or "movie")
        title = str(item.get("title") or item.get("name") or "Untitled")
        poster_path = str(item.get("poster_path") or "")
        raw_rel = item.get("release_year") or item.get("release_date") or ""
        release_year = str(raw_rel)[:4] if raw_rel else ""
        overview = str(item.get("overview") or "")
        status = str(item.get("status", "plan_to_watch"))

        if db_url:
            try:
                cursor.execute("""
                    INSERT INTO watchlist (user_id, tmdb_id, type, title, poster_path, vote_average, release_year, overview, status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (user_id, tmdb_id) DO UPDATE SET
                        type = EXCLUDED.type,
                        title = EXCLUDED.title,
                        poster_path = EXCLUDED.poster_path,
                        vote_average = EXCLUDED.vote_average,
                        release_year = EXCLUDED.release_year,
                        overview = EXCLUDED.overview,
                        status = EXCLUDED.status;
                """, (user_id, tmdb_id, media_type, title, poster_path, v_avg, release_year, overview, status))
            except Exception as e_conflict:
                conn.rollback()
                cursor.execute("DELETE FROM watchlist WHERE user_id = %s AND tmdb_id = %s;", (user_id, tmdb_id))
                cursor.execute("""
                    INSERT INTO watchlist (user_id, tmdb_id, type, title, poster_path, vote_average, release_year, overview, status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s);
                """, (user_id, tmdb_id, media_type, title, poster_path, v_avg, release_year, overview, status))
        else:
            cursor.execute("""
                INSERT OR REPLACE INTO watchlist (user_id, tmdb_id, type, title, poster_path, vote_average, release_year, overview, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (user_id, tmdb_id, media_type, title, poster_path, v_avg, release_year, overview, status))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print("[DB ERROR] add_to_watchlist failed:", e)
        return False

def remove_from_watchlist(tmdb_id, user_id='default_user'):
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        if db_url:
            cursor.execute("DELETE FROM watchlist WHERE user_id = %s AND tmdb_id = %s;", (user_id, int(tmdb_id)))
        else:
            cursor.execute("DELETE FROM watchlist WHERE user_id = ? AND tmdb_id = ?;", (user_id, int(tmdb_id)))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print("[DB ERROR] remove_from_watchlist failed:", e)
        return False

def save_watchlist(watchlist_data, user_id='default_user'):
    if not isinstance(watchlist_data, list):
        return False
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        if db_url:
            cursor.execute("DELETE FROM watchlist WHERE user_id = %s;", (user_id,))
            for item in watchlist_data:
                if not isinstance(item, dict):
                    continue
                raw_id = item.get("tmdb_id") or item.get("id") or item.get("tmdbId")
                if raw_id is None or raw_id == "" or raw_id == "NaN" or str(raw_id).lower() == "none":
                    continue
                tmdb_id = int(raw_id)
                v_avg = clean_float(item.get("vote_average"))
                media_type = str(item.get("type") or item.get("media_type") or "movie")
                title = str(item.get("title") or item.get("name") or "Untitled")
                poster_path = str(item.get("poster_path") or "")
                raw_rel = item.get("release_year") or item.get("release_date") or ""
                release_year = str(raw_rel)[:4] if raw_rel else ""
                overview = str(item.get("overview") or "")
                status = str(item.get("status", "plan_to_watch"))

                cursor.execute("""
                    INSERT INTO watchlist (user_id, tmdb_id, type, title, poster_path, vote_average, release_year, overview, status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (user_id, tmdb_id) DO UPDATE SET
                        type = EXCLUDED.type,
                        title = EXCLUDED.title,
                        poster_path = EXCLUDED.poster_path,
                        vote_average = EXCLUDED.vote_average,
                        release_year = EXCLUDED.release_year,
                        overview = EXCLUDED.overview,
                        status = EXCLUDED.status;
                """, (user_id, tmdb_id, media_type, title, poster_path, v_avg, release_year, overview, status))
        else:
            cursor.execute("DELETE FROM watchlist WHERE user_id = ?;", (user_id,))
            for item in watchlist_data:
                if not isinstance(item, dict):
                    continue
                raw_id = item.get("tmdb_id") or item.get("id") or item.get("tmdbId")
                if raw_id is None or raw_id == "" or raw_id == "NaN" or str(raw_id).lower() == "none":
                    continue
                tmdb_id = int(raw_id)
                v_avg = clean_float(item.get("vote_average"))
                media_type = str(item.get("type") or item.get("media_type") or "movie")
                title = str(item.get("title") or item.get("name") or "Untitled")
                poster_path = str(item.get("poster_path") or "")
                raw_rel = item.get("release_year") or item.get("release_date") or ""
                release_year = str(raw_rel)[:4] if raw_rel else ""
                overview = str(item.get("overview") or "")
                status = str(item.get("status", "plan_to_watch"))

                cursor.execute("""
                    INSERT OR REPLACE INTO watchlist (user_id, tmdb_id, type, title, poster_path, vote_average, release_year, overview, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
                """, (user_id, tmdb_id, media_type, title, poster_path, v_avg, release_year, overview, status))

        conn.commit()
        conn.close()
        print(f"[SUCCESS] Saved {len(watchlist_data)} item(s) to Database for {user_id}!")
    except Exception as e:
        print("[DB ERROR] save_watchlist failed:", e)
        raise e

    if user_id == 'default_user':
        try:
            with open(WATCHLIST_FILE, "w", encoding="utf-8") as f:
                json.dump(watchlist_data, f, indent=2)
        except Exception:
            pass

def get_public_users(current_uid=None, query=None):
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        sql = "SELECT uid, display_name, photo_url, ntfy_topic FROM users WHERE (is_public = 1 OR is_public = true)"
        params = []
        if current_uid:
            sql += " AND uid != %s" if db_url else " AND uid != ?"
            params.append(current_uid)
        if query:
            sql += " AND (LOWER(display_name) LIKE %s OR LOWER(email) LIKE %s)" if db_url else " AND (LOWER(display_name) LIKE ? OR LOWER(email) LIKE ?)"
            q_like = f"%{query.lower()}%"
            params.extend([q_like, q_like])
        sql += " ORDER BY display_name ASC LIMIT 50;"
        cursor.execute(sql, tuple(params))
        rows = cursor.fetchall()
        users = []
        for r in rows:
            if isinstance(r, dict) or hasattr(r, 'keys'):
                users.append({"uid": r["uid"], "display_name": r["display_name"], "photo_url": r["photo_url"], "ntfy_topic": r["ntfy_topic"]})
            else:
                users.append({"uid": r[0], "display_name": r[1], "photo_url": r[2], "ntfy_topic": r[3]})
        conn.close()
        return users
    except Exception as e:
        print("[DB ERROR] get_public_users failed:", e)
        return []

def get_user_connections(user_id):
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        sql = """
            SELECT u.uid, u.display_name, u.photo_url, c.status, c.requester_id
            FROM connections c
            JOIN users u ON (u.uid = CASE WHEN c.requester_id = %s THEN c.receiver_id ELSE c.requester_id END)
            WHERE c.requester_id = %s OR c.receiver_id = %s;
        """ if db_url else """
            SELECT u.uid, u.display_name, u.photo_url, c.status, c.requester_id
            FROM connections c
            JOIN users u ON (u.uid = CASE WHEN c.requester_id = ? THEN c.receiver_id ELSE c.requester_id END)
            WHERE c.requester_id = ? OR c.receiver_id = ?;
        """
        cursor.execute(sql, (user_id, user_id, user_id))
        rows = cursor.fetchall()
        connections = []
        for r in rows:
            if isinstance(r, dict) or hasattr(r, 'keys'):
                connections.append({
                    "uid": r["uid"], "display_name": r["display_name"], "photo_url": r["photo_url"],
                    "status": r["status"], "is_incoming": r["requester_id"] != user_id
                })
            else:
                connections.append({
                    "uid": r[0], "display_name": r[1], "photo_url": r[2],
                    "status": r[3], "is_incoming": r[4] != user_id
                })
        conn.close()
        return connections
    except Exception as e:
        print("[DB ERROR] get_user_connections failed:", e)
        return []

def manage_connection(requester_id, receiver_id, action="request"):
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        if action == "request":
            if db_url:
                cursor.execute("INSERT INTO connections (requester_id, receiver_id, status) VALUES (%s, %s, 'accepted') ON CONFLICT DO NOTHING;", (requester_id, receiver_id))
            else:
                cursor.execute("INSERT OR REPLACE INTO connections (requester_id, receiver_id, status) VALUES (?, ?, 'accepted');", (requester_id, receiver_id))
        elif action == "remove":
            if db_url:
                cursor.execute("DELETE FROM connections WHERE (requester_id = %s AND receiver_id = %s) OR (requester_id = %s AND receiver_id = %s);", (requester_id, receiver_id, receiver_id, requester_id))
            else:
                cursor.execute("DELETE FROM connections WHERE (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?);", (requester_id, receiver_id, receiver_id, requester_id))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print("[DB ERROR] manage_connection failed:", e)
        return False

def add_rating(user_id, tmdb_id, score, review=""):
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        score = float(score)
        if db_url:
            cursor.execute("""
                INSERT INTO ratings (user_id, tmdb_id, score, review)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (user_id, tmdb_id) DO UPDATE SET score = EXCLUDED.score, review = EXCLUDED.review, updated_at = CURRENT_TIMESTAMP;
            """, (user_id, int(tmdb_id), score, review))
        else:
            cursor.execute("""
                INSERT OR REPLACE INTO ratings (user_id, tmdb_id, score, review)
                VALUES (?, ?, ?, ?);
            """, (user_id, int(tmdb_id), score, review))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print("[DB ERROR] add_rating failed:", e)
        return False

def get_ratings(tmdb_id=None, user_id=None):
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        sql = "SELECT r.id, r.user_id, r.tmdb_id, r.score, r.review, r.updated_at, u.display_name, u.photo_url FROM ratings r LEFT JOIN users u ON r.user_id = u.uid"
        params = []
        where = []
        if tmdb_id:
            where.append("r.tmdb_id = %s" if db_url else "r.tmdb_id = ?")
            params.append(int(tmdb_id))
        if user_id:
            where.append("r.user_id = %s" if db_url else "r.user_id = ?")
            params.append(user_id)
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY r.updated_at DESC LIMIT 50;"
        cursor.execute(sql, tuple(params))
        rows = cursor.fetchall()
        ratings = []
        for r in rows:
            if isinstance(r, dict) or hasattr(r, 'keys'):
                ratings.append({
                    "id": r["id"], "user_id": r["user_id"], "tmdb_id": r["tmdb_id"],
                    "score": clean_float(r["score"]), "review": r["review"],
                    "updated_at": str(r["updated_at"]), "user_name": r["display_name"] or "User",
                    "user_photo": r["photo_url"]
                })
            else:
                ratings.append({
                    "id": r[0], "user_id": r[1], "tmdb_id": r[2],
                    "score": clean_float(r[3]), "review": r[4],
                    "updated_at": str(r[5]), "user_name": r[6] or "User",
                    "user_photo": r[7]
                })
        conn.close()
        return ratings
    except Exception as e:
        print("[DB ERROR] get_ratings failed:", e)
        return []

def delete_rating(rating_id, user_id):
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        sql = "DELETE FROM ratings WHERE id = %s AND user_id = %s;" if db_url else "DELETE FROM ratings WHERE id = ? AND user_id = ?;"
        cursor.execute(sql, (int(rating_id), str(user_id)))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print("[DB ERROR] delete_rating failed:", e)
        return False

def delete_comment(comment_id, user_id):
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        # Cascade delete child replies
        sql_replies = "DELETE FROM comments WHERE parent_id = %s;" if db_url else "DELETE FROM comments WHERE parent_id = ?;"
        cursor.execute(sql_replies, (int(comment_id),))
        
        # Delete comment
        sql = "DELETE FROM comments WHERE id = %s AND user_id = %s;" if db_url else "DELETE FROM comments WHERE id = ? AND user_id = ?;"
        cursor.execute(sql, (int(comment_id), str(user_id)))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print("[DB ERROR] delete_comment failed:", e)
        return False

def add_comment(user_id, tmdb_id, content, target_user_id=None, parent_id=None):
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        parent_id_val = int(parent_id) if parent_id is not None and str(parent_id).isdigit() else None
        if db_url:
            cursor.execute("""
                INSERT INTO comments (user_id, tmdb_id, target_user_id, parent_id, content)
                VALUES (%s, %s, %s, %s, %s);
            """, (user_id, int(tmdb_id), target_user_id, parent_id_val, content))
        else:
            cursor.execute("""
                INSERT INTO comments (user_id, tmdb_id, target_user_id, parent_id, content)
                VALUES (?, ?, ?, ?, ?);
            """, (user_id, int(tmdb_id), target_user_id, parent_id_val, content))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print("[DB ERROR] add_comment failed:", e)
        return False

def get_comment(comment_id):
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        sql = "SELECT c.id, c.user_id, c.tmdb_id, c.content, u.display_name, u.ntfy_topic FROM comments c LEFT JOIN users u ON c.user_id = u.uid WHERE c.id = %s" if db_url else "SELECT c.id, c.user_id, c.tmdb_id, c.content, u.display_name, u.ntfy_topic FROM comments c LEFT JOIN users u ON c.user_id = u.uid WHERE c.id = ?"
        cursor.execute(sql, (int(comment_id),))
        r = cursor.fetchone()
        conn.close()
        if not r:
            return None
        if isinstance(r, dict) or hasattr(r, 'keys'):
            return dict(r)
        return {
            "id": r[0], "user_id": r[1], "tmdb_id": r[2], "content": r[3], "display_name": r[4], "ntfy_topic": r[5]
        }
    except Exception as e:
        print("[DB ERROR] get_comment failed:", e)
        return None

def get_comments(tmdb_id=None, target_user_id=None, user_id=None):
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        sql = "SELECT c.id, c.user_id, c.tmdb_id, c.target_user_id, c.parent_id, c.content, c.created_at, u.display_name, u.photo_url FROM comments c LEFT JOIN users u ON c.user_id = u.uid"
        params = []
        where = []
        if tmdb_id:
            where.append("c.tmdb_id = %s" if db_url else "c.tmdb_id = ?")
            params.append(int(tmdb_id))
        if target_user_id:
            where.append("c.target_user_id = %s" if db_url else "c.target_user_id = ?")
            params.append(target_user_id)
        if user_id:
            where.append("c.user_id = %s" if db_url else "c.user_id = ?")
            params.append(user_id)
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY c.created_at DESC LIMIT 200;"
        cursor.execute(sql, tuple(params))
        rows = cursor.fetchall()
        comments = []
        for r in rows:
            if isinstance(r, dict) or hasattr(r, 'keys'):
                comments.append({
                    "id": r["id"], "user_id": r["user_id"], "tmdb_id": r["tmdb_id"],
                    "target_user_id": r["target_user_id"], "parent_id": r["parent_id"],
                    "content": r["content"],
                    "created_at": str(r["created_at"]), "user_name": r["display_name"] or "User",
                    "user_photo": r["photo_url"]
                })
            else:
                comments.append({
                    "id": r[0], "user_id": r[1], "tmdb_id": r[2],
                    "target_user_id": r[3], "parent_id": r[4], "content": r[5],
                    "created_at": str(r[6]), "user_name": r[7] or "User",
                    "user_photo": r[8]
                })
        conn.close()
        return comments
    except Exception as e:
        print("[DB ERROR] get_comments failed:", e)
        return []

def get_user_activity(user_id):
    ratings = get_ratings(user_id=user_id)
    comments = get_comments(user_id=user_id)
    
    # Lookup title/poster from watchlist if available
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT tmdb_id, title, poster_path, type FROM watchlist;")
        w_rows = cursor.fetchall()
        conn.close()
        w_map = {}
        for row in w_rows:
            if isinstance(row, dict) or hasattr(row, 'keys'):
                w_map[int(row["tmdb_id"])] = {
                    "title": row["title"],
                    "poster_path": row["poster_path"],
                    "type": row["type"]
                }
            else:
                w_map[int(row[0])] = {
                    "title": row[1],
                    "poster_path": row[2],
                    "type": row[3]
                }
    except Exception as e:
        print("[DB ERROR] get_user_activity lookup failed:", e)
        w_map = {}
        
    for r in ratings:
        t_id = int(r["tmdb_id"])
        if t_id in w_map:
            r["title"] = w_map[t_id]["title"]
            r["poster_path"] = w_map[t_id]["poster_path"]
            r["type"] = w_map[t_id]["type"]
            
    for c in comments:
        t_id = int(c["tmdb_id"])
        if t_id in w_map:
            c["title"] = w_map[t_id]["title"]
            c["poster_path"] = w_map[t_id]["poster_path"]
            c["type"] = w_map[t_id]["type"]
            
    return {"ratings": ratings, "comments": comments}

def add_custom_reminder(user_id, tmdb_id, media_title, media_type='movie', poster_path='', remind_at='', note=''):
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        if db_url:
            cursor.execute("""
                INSERT INTO custom_reminders (user_id, tmdb_id, media_title, media_type, poster_path, remind_at, note)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id;
            """, (user_id, int(tmdb_id), str(media_title), str(media_type or 'movie'), str(poster_path or ''), str(remind_at), str(note or '')))
            new_id = cursor.fetchone()[0]
        else:
            cursor.execute("""
                INSERT INTO custom_reminders (user_id, tmdb_id, media_title, media_type, poster_path, remind_at, note)
                VALUES (?, ?, ?, ?, ?, ?, ?);
            """, (user_id, int(tmdb_id), str(media_title), str(media_type or 'movie'), str(poster_path or ''), str(remind_at), str(note or '')))
            new_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return {
            "id": new_id,
            "user_id": user_id,
            "tmdb_id": tmdb_id,
            "media_title": media_title,
            "media_type": media_type,
            "poster_path": poster_path,
            "remind_at": remind_at,
            "note": note,
            "is_sent": False
        }
    except Exception as e:
        print("[DB ERROR] add_custom_reminder failed:", e)
        return None

def get_user_reminders(user_id):
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        if db_url:
            cursor.execute("""
                SELECT id, user_id, tmdb_id, media_title, media_type, poster_path, remind_at, note, is_sent, created_at
                FROM custom_reminders
                WHERE user_id = %s AND is_sent = FALSE
                ORDER BY remind_at ASC;
            """, (user_id,))
        else:
            cursor.execute("""
                SELECT id, user_id, tmdb_id, media_title, media_type, poster_path, remind_at, note, is_sent, created_at
                FROM custom_reminders
                WHERE user_id = ? AND is_sent = 0
                ORDER BY remind_at ASC;
            """, (user_id,))
        rows = cursor.fetchall()
        reminders = []
        for r in rows:
            if isinstance(r, dict) or hasattr(r, 'keys'):
                reminders.append({
                    "id": r["id"], "user_id": r["user_id"], "tmdb_id": r["tmdb_id"],
                    "media_title": r["media_title"], "media_type": r["media_type"],
                    "poster_path": r["poster_path"], "remind_at": str(r["remind_at"]),
                    "note": r["note"], "is_sent": bool(r["is_sent"]), "created_at": str(r["created_at"])
                })
            else:
                reminders.append({
                    "id": r[0], "user_id": r[1], "tmdb_id": r[2],
                    "media_title": r[3], "media_type": r[4],
                    "poster_path": r[5], "remind_at": str(r[6]),
                    "note": r[7], "is_sent": bool(r[8]), "created_at": str(r[9])
                })
        conn.close()
        return reminders
    except Exception as e:
        print("[DB ERROR] get_user_reminders failed:", e)
        return []

def get_due_reminders():
    from datetime import datetime
    now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    now_t = datetime.now().strftime("%Y-%m-%dT%H:%M")
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        if db_url:
            cursor.execute("""
                SELECT id, user_id, tmdb_id, media_title, media_type, poster_path, remind_at, note
                FROM custom_reminders
                WHERE is_sent = FALSE AND (remind_at <= %s OR remind_at <= %s);
            """, (now_iso, now_t))
        else:
            cursor.execute("""
                SELECT id, user_id, tmdb_id, media_title, media_type, poster_path, remind_at, note
                FROM custom_reminders
                WHERE is_sent = 0 AND (remind_at <= ? OR remind_at <= ?);
            """, (now_iso, now_t))
        rows = cursor.fetchall()
        due = []
        for r in rows:
            if isinstance(r, dict) or hasattr(r, 'keys'):
                due.append({
                    "id": r["id"], "user_id": r["user_id"], "tmdb_id": r["tmdb_id"],
                    "media_title": r["media_title"], "media_type": r["media_type"],
                    "poster_path": r["poster_path"], "remind_at": str(r["remind_at"]),
                    "note": r["note"]
                })
            else:
                due.append({
                    "id": r[0], "user_id": r[1], "tmdb_id": r[2],
                    "media_title": r[3], "media_type": r[4],
                    "poster_path": r[5], "remind_at": str(r[6]),
                    "note": r[7]
                })
        conn.close()
        return due
    except Exception as e:
        print("[DB ERROR] get_due_reminders failed:", e)
        return []

def mark_reminder_sent(reminder_id):
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        if db_url:
            cursor.execute("UPDATE custom_reminders SET is_sent = TRUE WHERE id = %s;", (reminder_id,))
        else:
            cursor.execute("UPDATE custom_reminders SET is_sent = 1 WHERE id = ?;", (reminder_id,))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print("[DB ERROR] mark_reminder_sent failed:", e)
        return False

def delete_custom_reminder(reminder_id, user_id):
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        if db_url:
            cursor.execute("DELETE FROM custom_reminders WHERE id = %s AND user_id = %s;", (reminder_id, user_id))
        else:
            cursor.execute("DELETE FROM custom_reminders WHERE id = ? AND user_id = ?;", (reminder_id, user_id))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print("[DB ERROR] delete_custom_reminder failed:", e)
        return False

