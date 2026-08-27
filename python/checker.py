import os
import sys
import requests
from datetime import date, datetime

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

from db import init_db, load_watchlist, get_connection, get_db_url

DEFAULT_TMDB_API_KEY = "802b2c4b88ea1183e50e6b285a27696e"
TMDB_API_KEY = os.getenv("TMDB_API_KEY") or DEFAULT_TMDB_API_KEY
DEFAULT_NTFY_TOPIC = os.getenv("NTFY_TOPIC", "vesper-cinema-updates")
SEND_TEST = os.getenv("SEND_TEST", "").lower() in ("true", "1", "yes") or "--test" in sys.argv

# Ensure DB is initialized
init_db()

def send_push_notification(title: str, message_body: str, topic: str = DEFAULT_NTFY_TOPIC, priority: str = "high", tags: str = "clapper,tv"):
    if not topic:
        topic = DEFAULT_NTFY_TOPIC
    url = f"https://ntfy.sh/{topic}"
    
    try:
        response = requests.post(
            url,
            data=message_body.encode("utf-8"),
            headers={
                "Title": f"Release Alert: {title}",
                "Priority": priority,
                "Tags": tags
            },
            timeout=10
        )
        if response.status_code == 200:
            print(f"[SUCCESS] Push notification sent to ntfy.sh/{topic} for: '{title}'")
            return True
        else:
            print(f"[ERROR] Failed to send push notification to ntfy.sh/{topic}: HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"[ERROR] Exception sending push notification to {topic}: {e}")
        return False

def calculate_days_until(target_date_str: str):
    try:
        target = datetime.strptime(target_date_str, "%Y-%m-%d").date()
        today = date.today()
        return (target - today).days
    except Exception:
        return None

def process_release_alert(title: str, release_format: str, release_date_str: str, topic: str = DEFAULT_NTFY_TOPIC):
    days = calculate_days_until(release_date_str)
    if days is None:
        return False

    if days == 0:
        return send_push_notification(
            title,
            f"🎉 RELEASE DAY: '{title}' ({release_format}) is officially out today ({release_date_str})!",
            topic=topic,
            priority="high",
            tags="tada,clapper"
        )
    elif days == 1:
        return send_push_notification(
            title,
            f"⏰ RELEASING TOMORROW: '{title}' ({release_format}) releases tomorrow ({release_date_str})!",
            topic=topic,
            priority="high",
            tags="alarm_clock,clapper"
        )
    elif days == 3:
        return send_push_notification(
            title,
            f"📅 3 DAYS LEFT: '{title}' ({release_format}) releases in 3 days ({release_date_str})!",
            topic=topic,
            priority="default",
            tags="calendar,clapper"
        )
    elif days == 7:
        return send_push_notification(
            title,
            f"🗓️ 7 DAYS AWAY: '{title}' ({release_format}) releases in 1 week on {release_date_str}!",
            topic=topic,
            priority="default",
            tags="calendar,clapper"
        )
    else:
        if days > 0:
            print(f"   ↳ '{title}' ({release_format}) release on {release_date_str} is {days} days away (Alerts trigger at 7, 3, 1, 0 days).")
        else:
            print(f"   ↳ '{title}' ({release_format}) release date ({release_date_str}) has passed.")
        return False

def check_releases_for_user(user_id='default_user', topic=DEFAULT_NTFY_TOPIC, user_name="User"):
    watchlist = load_watchlist(user_id=user_id)
    if not watchlist:
        return 0

    print(f"\n👉 Checking {len(watchlist)} item(s) for '{user_name}' (ID: {user_id}, Topic: {topic})...")
    notifications_sent = 0

    for item in watchlist:
        tmdb_id = item.get("tmdb_id")
        title = item.get("title", "Untitled")
        media_type = item.get("type", "movie")

        print(f"   🔍 Checking '{title}' (Type: {media_type.upper()}, TMDb ID: {tmdb_id})...")

        if media_type == "movie":
            url = f"https://api.themoviedb.org/3/movie/{tmdb_id}/release_dates?api_key={TMDB_API_KEY}"
            try:
                res = requests.get(url, timeout=10).json()
                found_alerts = False

                for country in res.get("results", []):
                    if country.get("iso_3166_1") == "US":
                        for release in country.get("release_dates", []):
                            rel_date = release.get("release_date", "").split("T")[0]
                            rel_type = release.get("type")

                            if rel_date:
                                release_name = "Cinema Release" if rel_type == 3 else ("Digital Release" if rel_type == 4 else None)
                                if release_name:
                                    sent = process_release_alert(title, release_name, rel_date, topic=topic)
                                    if sent:
                                        found_alerts = True
                                        notifications_sent += 1

                if not found_alerts:
                    print(f"      ↳ No active countdown alerts (7d, 3d, 1d, 0d) for US Cinema/Digital dates today.")

            except Exception as e:
                print(f"      ↳ [ERROR] Failed to query TMDb for movie ID {tmdb_id}: {e}")

        elif media_type == "tv":
            url = f"https://api.themoviedb.org/3/tv/{tmdb_id}?api_key={TMDB_API_KEY}"
            try:
                res = requests.get(url, timeout=10).json()
                next_ep = res.get("next_episode_to_air")

                if next_ep:
                    air_date = next_ep.get("air_date")
                    season_num = next_ep.get("season_number")
                    episode_num = next_ep.get("episode_number")
                    ep_name = next_ep.get("name", "")

                    format_name = f"Season {season_num} Premiere" if episode_num == 1 else f"Season {season_num} Ep {episode_num}"
                    if ep_name:
                        format_name += f" ('{ep_name}')"

                    print(f"      ↳ Next Episode: {format_name} on {air_date}")

                    if air_date:
                        sent = process_release_alert(title, format_name, air_date, topic=topic)
                        if sent:
                            notifications_sent += 1
                else:
                    print("      ↳ No upcoming episode air dates listed on TMDb.")

            except Exception as e:
                print(f"      ↳ [ERROR] Failed to query TMDb for TV ID {tmdb_id}: {e}")

    return notifications_sent

def check_releases():
    today = str(date.today())
    print(f"==================================================")
    print(f"🚀 VESPER Media Release Checker Started")
    print(f"📅 Checking Date: {today}")
    print(f"==================================================")

    if SEND_TEST:
        print("[TEST MODE] Sending test push notification to verify ntfy configuration...")
        send_push_notification(
            "VESPER Setup",
            f"Test Notification: Your VESPER ntfy setup and countdown alerts are working! 🎉 (Date: {today})",
            topic=DEFAULT_NTFY_TOPIC
        )

    total_sent = 0
    checked_uids = set()

    # 1. Check for all registered users in database
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT uid, display_name, ntfy_topic FROM users;")
        users = cursor.fetchall()
        conn.close()

        for u in users:
            uid = u[0] if not isinstance(u, dict) and not hasattr(u, 'keys') else u["uid"]
            display_name = u[1] if not isinstance(u, dict) and not hasattr(u, 'keys') else u["display_name"]
            ntfy_topic = (u[2] if not isinstance(u, dict) and not hasattr(u, 'keys') else u["ntfy_topic"]) or DEFAULT_NTFY_TOPIC

            checked_uids.add(uid)
            total_sent += check_releases_for_user(user_id=uid, topic=ntfy_topic, user_name=display_name)
    except Exception as e:
        print("[ERROR] Failed to fetch users for release check:", e)

    # 2. Check default_user if not already checked
    if 'default_user' not in checked_uids:
        total_sent += check_releases_for_user(user_id='default_user', topic=DEFAULT_NTFY_TOPIC, user_name="Guest User")

    print(f"\n==================================================")
    print(f"✅ Check complete. Total release notifications sent today: {total_sent}")
    print(f"==================================================")
    return total_sent

if __name__ == "__main__":
    check_releases()
