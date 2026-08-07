import os
import json
import sqlite3

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "media_tracker.db")
DATABASE_URL = os.getenv("DATABASE_URL")
WATCHLIST_FILE = os.path.join(BASE_DIR, "watchlist.json")

def get_connection():
    if DATABASE_URL:
        import psycopg2
        return psycopg2.connect(DATABASE_URL)
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn

def init_db():
    try:
        conn = get_connection()
        cursor = conn.cursor()
        
        if DATABASE_URL:
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
                        if DATABASE_URL:
                            cursor.execute("""
                                INSERT INTO watchlist (tmdb_id, type, title, poster_path, vote_average, release_year, overview)
                                VALUES (%s, %s, %s, %s, %s, %s, %s)
                                ON CONFLICT (tmdb_id) DO NOTHING;
                            """, (
                                item.get("tmdb_id"),
                                item.get("type", "movie"),
                                item.get("title", ""),
                                item.get("poster_path", ""),
                                item.get("vote_average"),
                                item.get("release_year", ""),
                                item.get("overview", "")
                            ))
                        else:
                            cursor.execute("""
                                INSERT OR IGNORE INTO watchlist (tmdb_id, type, title, poster_path, vote_average, release_year, overview)
                                VALUES (?, ?, ?, ?, ?, ?, ?);
                            """, (
                                item.get("tmdb_id"),
                                item.get("type", "movie"),
                                item.get("title", ""),
                                item.get("poster_path", ""),
                                item.get("vote_average"),
                                item.get("release_year", ""),
                                item.get("overview", "")
                            ))
                    conn.commit()
                print("[SUCCESS] Migrated watchlist.json into Database!")

        conn.close()
    except Exception as e:
        print("Database init note:", e)

def load_watchlist():
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT tmdb_id, type, title, poster_path, vote_average, release_year, overview FROM watchlist ORDER BY added_at DESC;")
        rows = cursor.fetchall()
        watchlist = []
        for row in rows:
            if isinstance(row, dict) or hasattr(row, 'keys'):
                watchlist.append({
                    "tmdb_id": row["tmdb_id"],
                    "type": row["type"],
                    "title": row["title"],
                    "poster_path": row["poster_path"],
                    "vote_average": row["vote_average"],
                    "release_year": row["release_year"],
                    "overview": row["overview"]
                })
            else:
                watchlist.append({
                    "tmdb_id": row[0],
                    "type": row[1],
                    "title": row[2],
                    "poster_path": row[3],
                    "vote_average": row[4],
                    "release_year": row[5],
                    "overview": row[6]
                })
        conn.close()
        return watchlist
    except Exception as e:
        print("Database load fallback to file:", e)
        if os.path.exists(WATCHLIST_FILE):
            with open(WATCHLIST_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        return []

def save_watchlist(watchlist_data):
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM watchlist;")
        for item in watchlist_data:
            if DATABASE_URL:
                cursor.execute("""
                    INSERT INTO watchlist (tmdb_id, type, title, poster_path, vote_average, release_year, overview)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (tmdb_id) DO NOTHING;
                """, (
                    item.get("tmdb_id"),
                    item.get("type", "movie"),
                    item.get("title", ""),
                    item.get("poster_path", ""),
                    item.get("vote_average"),
                    item.get("release_year", ""),
                    item.get("overview", "")
                ))
            else:
                cursor.execute("""
                    INSERT OR IGNORE INTO watchlist (tmdb_id, type, title, poster_path, vote_average, release_year, overview)
                    VALUES (?, ?, ?, ?, ?, ?, ?);
                """, (
                    item.get("tmdb_id"),
                    item.get("type", "movie"),
                    item.get("title", ""),
                    item.get("poster_path", ""),
                    item.get("vote_average"),
                    item.get("release_year", ""),
                    item.get("overview", "")
                ))
        conn.commit()
        conn.close()
    except Exception as e:
        print("Database save note:", e)

    # Sync watchlist.json file as backup
    try:
        with open(WATCHLIST_FILE, "w", encoding="utf-8") as f:
            json.dump(watchlist_data, f, indent=2)
    except Exception:
        pass
