import os
import json
import sqlite3

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "media_tracker.db")
WATCHLIST_FILE = os.path.join(BASE_DIR, "watchlist.json")

def get_db_url():
    return os.getenv("DATABASE_URL")

def get_connection():
    db_url = get_db_url()
    if db_url:
        import psycopg2
        url = db_url.strip()
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        return psycopg2.connect(url)
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

def init_db():
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        
        if db_url:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS watchlist (
                    tmdb_id INT PRIMARY KEY,
                    type VARCHAR(10) NOT NULL,
                    title TEXT NOT NULL,
                    poster_path TEXT,
                    vote_average NUMERIC,
                    release_year VARCHAR(10),
                    overview TEXT,
                    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
        else:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS watchlist (
                    tmdb_id INTEGER PRIMARY KEY,
                    type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    poster_path TEXT,
                    vote_average REAL,
                    release_year TEXT,
                    overview TEXT,
                    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
        conn.commit()

        # Migrate existing watchlist.json to DB if DB table is empty
        if os.path.exists(WATCHLIST_FILE):
            cursor.execute("SELECT COUNT(*) FROM watchlist;")
            count_res = cursor.fetchone()
            count = count_res[0] if count_res else 0
            if count == 0:
                with open(WATCHLIST_FILE, "r", encoding="utf-8") as f:
                    items = json.load(f)
                    for item in items:
                        v_avg = clean_float(item.get("vote_average"))
                        if db_url:
                            cursor.execute("""
                                INSERT INTO watchlist (tmdb_id, type, title, poster_path, vote_average, release_year, overview)
                                VALUES (%s, %s, %s, %s, %s, %s, %s)
                                ON CONFLICT (tmdb_id) DO NOTHING;
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
                                INSERT OR IGNORE INTO watchlist (tmdb_id, type, title, poster_path, vote_average, release_year, overview)
                                VALUES (?, ?, ?, ?, ?, ?, ?);
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

        conn.close()
    except Exception as e:
        print("[DB ERROR] init_db failed:", e)

def load_watchlist():
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT tmdb_id, type, title, poster_path, vote_average, release_year, overview FROM watchlist ORDER BY added_at DESC;")
        rows = cursor.fetchall()
        watchlist = []
        for row in rows:
            if isinstance(row, dict) or hasattr(row, 'keys'):
                v_avg = clean_float(row["vote_average"])
                watchlist.append({
                    "tmdb_id": row["tmdb_id"],
                    "type": row["type"],
                    "title": row["title"],
                    "poster_path": row["poster_path"],
                    "vote_average": v_avg,
                    "release_year": row["release_year"],
                    "overview": row["overview"]
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
                    "overview": row[6]
                })
        conn.close()
        return watchlist
    except Exception as e:
        print("[DB ERROR] load_watchlist failed:", e)
        if os.path.exists(WATCHLIST_FILE):
            with open(WATCHLIST_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        return []

def save_watchlist(watchlist_data):
    db_url = get_db_url()
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM watchlist;")
        for item in watchlist_data:
            v_avg = clean_float(item.get("vote_average"))
            if db_url:
                cursor.execute("""
                    INSERT INTO watchlist (tmdb_id, type, title, poster_path, vote_average, release_year, overview)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (tmdb_id) DO NOTHING;
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
                    INSERT OR IGNORE INTO watchlist (tmdb_id, type, title, poster_path, vote_average, release_year, overview)
                    VALUES (?, ?, ?, ?, ?, ?, ?);
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
        conn.close()
        print(f"[SUCCESS] Saved {len(watchlist_data)} item(s) to Database!")
    except Exception as e:
        print("[DB ERROR] save_watchlist failed:", e)
        raise e

    # Sync watchlist.json file as local backup
    try:
        with open(WATCHLIST_FILE, "w", encoding="utf-8") as f:
            json.dump(watchlist_data, f, indent=2)
    except Exception:
        pass
