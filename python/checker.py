import os
import sys
import requests
from datetime import date

from db import init_db, load_watchlist

TMDB_API_KEY = os.getenv("TMDB_API_KEY")
NTFY_TOPIC = os.getenv("NTFY_TOPIC")
SEND_TEST = os.getenv("SEND_TEST", "").lower() in ("true", "1", "yes") or "--test" in sys.argv

if not TMDB_API_KEY or not NTFY_TOPIC:
    print("[ERROR] Missing TMDB_API_KEY or NTFY_TOPIC environment variables.")
    print("Please add TMDB_API_KEY and NTFY_TOPIC secrets in GitHub Repository Settings -> Secrets and variables -> Actions.")
    sys.exit(1)

# Ensure DB is initialized
init_db()

def send_push_notification(title: str, message_body: str):
    url = f"https://ntfy.sh/{NTFY_TOPIC}"
    
    response = requests.post(
        url,
        data=message_body.encode("utf-8"),
        headers={
            "Title": f"Release Alert: {title}",
            "Priority": "high",
            "Tags": "clapper,tv"
        }
    )
    if response.status_code == 200:
        print(f"[SUCCESS] Push notification sent to ntfy.sh/{NTFY_TOPIC} for: '{title}'")
    else:
        print(f"[ERROR] Failed to send push notification: HTTP {response.status_code}")

def check_releases():
    today = str(date.today())
    print(f"==================================================")
    print(f"🚀 Media Release Checker Started")
    print(f"📅 Checking Date: {today}")
    print(f"🔔 ntfy Topic: {NTFY_TOPIC}")
    print(f"==================================================")

    # Optional test notification trigger for manual workflow runs
    if SEND_TEST:
        print("[TEST MODE] Sending test push notification to verify ntfy configuration...")
        send_push_notification(
            "Media Tracker Test",
            f"Test Notification: Your ntfy setup and GitHub Action are working perfectly! 🎉 (Date: {today})"
        )

    watchlist = load_watchlist()

    if not watchlist:
        print("[INFO] Watchlist is currently empty. Add items via the web UI to monitor releases.")
        return

    print(f"[INFO] Monitoring {len(watchlist)} item(s) in your watchlist:\n")
    notifications_sent = 0

    for item in watchlist:
        tmdb_id = item.get("tmdb_id")
        title = item.get("title", "Untitled")
        media_type = item.get("type", "movie")

        print(f"👉 Checking '{title}' (Type: {media_type.upper()}, TMDb ID: {tmdb_id})...")

        if media_type == "movie":
            url = f"https://api.themoviedb.org/3/movie/{tmdb_id}/release_dates?api_key={TMDB_API_KEY}"
            try:
                res = requests.get(url).json()
                found_release_today = False

                for country in res.get("results", []):
                    if country.get("iso_3166_1") == "US":
                        for release in country.get("release_dates", []):
                            rel_date = release.get("release_date", "").split("T")[0]
                            rel_type = release.get("type")

                            if rel_date == today:
                                found_release_today = True
                                if rel_type == 3:
                                    send_push_notification(title, f"'{title}' has officially premiered in Cinemas today ({today})!")
                                    notifications_sent += 1
                                elif rel_type == 4:
                                    send_push_notification(title, f"'{title}' is officially available on Digital/Streaming today ({today})!")
                                    notifications_sent += 1
                
                if not found_release_today:
                    print(f"   ↳ No Cinema (type 3) or Digital (type 4) releases matching today's date ({today}).")

            except Exception as e:
                print(f"   ↳ [ERROR] Failed to query TMDb for movie ID {tmdb_id}: {e}")

        elif media_type == "tv":
            url = f"https://api.themoviedb.org/3/tv/{tmdb_id}?api_key={TMDB_API_KEY}"
            try:
                res = requests.get(url).json()
                next_ep = res.get("next_episode_to_air")

                if next_ep:
                    air_date = next_ep.get("air_date")
                    season_num = next_ep.get("season_number")
                    episode_num = next_ep.get("episode_number")
                    ep_name = next_ep.get("name", "")

                    print(f"   ↳ Next Episode: Season {season_num} Ep {episode_num} ('{ep_name}') on {air_date}")

                    if air_date == today and episode_num == 1:
                        send_push_notification(title, f"'{title}' Season {season_num} Premiere airs today ({today})!")
                        notifications_sent += 1
                    elif air_date == today:
                        send_push_notification(title, f"'{title}' Season {season_num} Episode {episode_num} ('{ep_name}') airs today ({today})!")
                        notifications_sent += 1
                else:
                    print("   ↳ No upcoming episode air dates listed on TMDb.")

            except Exception as e:
                print(f"   ↳ [ERROR] Failed to query TMDb for TV ID {tmdb_id}: {e}")

    print(f"\n==================================================")
    print(f"✅ Check complete. Total release notifications sent today: {notifications_sent}")
    print(f"==================================================")

if __name__ == "__main__":
    check_releases()
