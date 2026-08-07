import os
import sys
import requests
from datetime import date

from db import init_db, load_watchlist

TMDB_API_KEY = os.getenv("TMDB_API_KEY")
NTFY_TOPIC = os.getenv("NTFY_TOPIC")

if not TMDB_API_KEY or not NTFY_TOPIC:
    print("Error: Missing TMDB_API_KEY or NTFY_TOPIC environment variables.")
    sys.exit(1)

# Ensure DB initialized
init_db()

def send_push_notification(title: str, release_type: str):
    url = f"https://ntfy.sh/{NTFY_TOPIC}"
    message = f"'{title}' has officially been released on {release_type} today!"
    
    response = requests.post(
        url,
        data=message.encode("utf-8"),
        headers={
            "Title": f"Release Alert: {title}",
            "Priority": "high",
            "Tags": "clapper,tv"
        }
    )
    if response.status_code == 200:
        print(f"[SUCCESS] Notification sent for {title} ({release_type})")
    else:
        print(f"[ERROR] Failed to send notification: {response.status_code}")

def check_releases():
    today = str(date.today())
    print(f"Checking releases for date: {today}")

    watchlist = load_watchlist()

    if not watchlist:
        print("Watchlist is currently empty.")
        return

    for item in watchlist:
        tmdb_id = item["tmdb_id"]
        title = item["title"]
        media_type = item["type"]

        if media_type == "movie":
            url = f"https://api.themoviedb.org/3/movie/{tmdb_id}/release_dates?api_key={TMDB_API_KEY}"
            res = requests.get(url).json()

            for country in res.get("results", []):
                if country["iso_3166_1"] == "US":
                    for release in country["release_dates"]:
                        rel_date = release["release_date"].split("T")[0]
                        if rel_date == today:
                            # TMDb release types: 3 = Cinema, 4 = Digital
                            if release["type"] == 3:
                                send_push_notification(title, "Cinema")
                            elif release["type"] == 4:
                                send_push_notification(title, "Digital")

        elif media_type == "tv":
            url = f"https://api.themoviedb.org/3/tv/{tmdb_id}?api_key={TMDB_API_KEY}"
            res = requests.get(url).json()
            next_ep = res.get("next_episode_to_air")

            if next_ep and next_ep.get("air_date") == today:
                if next_ep.get("episode_number") == 1:
                    season_num = next_ep.get("season_number")
                    send_push_notification(title, f"Season {season_num} Premiere")

if __name__ == "__main__":
    check_releases()
