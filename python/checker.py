import os
import sys
import requests
from datetime import date, datetime

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

def send_push_notification(title: str, message_body: str, priority: str = "high", tags: str = "clapper,tv"):
    url = f"https://ntfy.sh/{NTFY_TOPIC}"
    
    response = requests.post(
        url,
        data=message_body.encode("utf-8"),
        headers={
            "Title": f"Release Alert: {title}",
            "Priority": priority,
            "Tags": tags
        }
    )
    if response.status_code == 200:
        print(f"[SUCCESS] Push notification sent to ntfy.sh/{NTFY_TOPIC} for: '{title}'")
    else:
        print(f"[ERROR] Failed to send push notification: HTTP {response.status_code}")

def calculate_days_until(target_date_str: str):
    try:
        target = datetime.strptime(target_date_str, "%Y-%m-%d").date()
        today = date.today()
        return (target - today).days
    except Exception:
        return None

def process_release_alert(title: str, release_format: str, release_date_str: str):
    days = calculate_days_until(release_date_str)
    if days is None:
        return False

    if days == 0:
        send_push_notification(
            title,
            f"🎉 RELEASE DAY: '{title}' ({release_format}) is officially out today ({release_date_str})!",
            priority="high",
            tags="tada,clapper"
        )
        return True
    elif days == 1:
        send_push_notification(
            title,
            f"⏰ RELEASING TOMORROW: '{title}' ({release_format}) releases tomorrow ({release_date_str})!",
            priority="high",
            tags="alarm_clock,clapper"
        )
        return True
    elif days == 3:
        send_push_notification(
            title,
            f"📅 3 DAYS LEFT: '{title}' ({release_format}) releases in 3 days ({release_date_str})!",
            priority="default",
            tags="calendar,clapper"
        )
        return True
    elif days == 7:
        send_push_notification(
            title,
            f"🗓️ 7 DAYS AWAY: '{title}' ({release_format}) releases in 1 week on {release_date_str}!",
            priority="default",
            tags="calendar,clapper"
        )
        return True
    else:
        if days > 0:
            print(f"   ↳ '{title}' ({release_format}) release on {release_date_str} is {days} days away (Alerts trigger at 7, 3, 1, 0 days).")
        else:
            print(f"   ↳ '{title}' ({release_format}) release date ({release_date_str}) has passed.")
        return False

def check_releases():
    today = str(date.today())
    print(f"==================================================")
    print(f"🚀 Media Release Checker Started")
    print(f"📅 Checking Date: {today}")
    print(f"🔔 ntfy Topic: {NTFY_TOPIC}")
    print(f"==================================================")

    if SEND_TEST:
        print("[TEST MODE] Sending test push notification to verify ntfy configuration...")
        send_push_notification(
            "Media Tracker Setup",
            f"Test Notification: Your ntfy setup and countdown alerts are working! 🎉 (Date: {today})"
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
                found_alerts = False

                for country in res.get("results", []):
                    if country.get("iso_3166_1") == "US":
                        for release in country.get("release_dates", []):
                            rel_date = release.get("release_date", "").split("T")[0]
                            rel_type = release.get("type")

                            if rel_date:
                                release_name = "Cinema Release" if rel_type == 3 else ("Digital Release" if rel_type == 4 else None)
                                if release_name:
                                    sent = process_release_alert(title, release_name, rel_date)
                                    if sent:
                                        found_alerts = True
                                        notifications_sent += 1

                if not found_alerts:
                    print(f"   ↳ No active countdown alerts (7d, 3d, 1d, 0d) for US Cinema/Digital dates today.")

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

                    format_name = f"Season {season_num} Premiere" if episode_num == 1 else f"Season {season_num} Ep {episode_num}"
                    if ep_name:
                        format_name += f" ('{ep_name}')"

                    print(f"   ↳ Next Episode: {format_name} on {air_date}")

                    if air_date:
                        sent = process_release_alert(title, format_name, air_date)
                        if sent:
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
