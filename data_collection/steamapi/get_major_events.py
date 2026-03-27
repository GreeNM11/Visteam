import requests
import json
import csv
import time
import os
import argparse
from datetime import datetime

NEWS_URL = "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/"
STORE_URL = "https://store.steampowered.com/api/appdetails"

MAJOR_KEYWORDS = [
    "major update", "season", "expansion", "v1.", "v2.", "v3.", "release", 
    "mega update", "content update", "acts", "chapter", "anniversary"
]

MINOR_KEYWORDS = ["hotfix", "bug fix", "small patch", "minor update", "stability"]

class SteamEventCollector:
    def __init__(self, output_file="data/game_events.csv"):
        self.output_file = output_file
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "VisteamEventCollector/1.0"})
        os.makedirs(os.path.dirname(output_file), exist_ok=True)

    def get_release_date(self, appid):
        """Fetches the official release date from the Steam Store API."""
        params = {"appids": appid}
        try:
            response = self.session.get(STORE_URL, params=params, timeout=10)
            if response.status_code == 200:
                data = response.json()
                if str(appid) in data and data[str(appid)]["success"]:
                    release_info = data[str(appid)]["data"].get("release_date", {})
                    return release_info.get("date")
        except Exception as e:
            print(f"  Error fetching release date for {appid}: {e}")
        return None

    def is_major_event(self, item):
        """Heuristic to determine if a news item is a major event."""
        title = item.get("title", "").lower()
        tags = item.get("tags", [])
        if tags is None: tags = []
        
        if any(tag in ["patchnotes", "major_update", "mod_tradeable"] for tag in tags):
            if not any(kw in title for kw in ["hotfix", "bug fix"]):
                return True
        
        if any(kw in title for kw in MAJOR_KEYWORDS):
             if not any(kw in title for kw in MINOR_KEYWORDS):
                return True
                
        return False

    def get_major_updates(self, appid, count=100):
        """Fetches and filters news items for major updates."""
        params = {
            "appid": appid,
            "count": count,
            "maxlength": 1,
            "format": "json"
        }
        events = []
        try:
            response = self.session.get(NEWS_URL, params=params, timeout=10)
            if response.status_code == 200:
                data = response.json()
                items = data.get("appnews", {}).get("newsitems", [])
                for item in items:
                    if self.is_major_event(item):
                        dt = datetime.fromtimestamp(item["date"])
                        events.append({
                            "appid": appid,
                            "date": dt.strftime("%Y-%m-%d"),
                            "event_type": "Update",
                            "title": item["title"],
                            "url": item["url"]
                        })
        except Exception as e:
            print(f"  Error fetching news for {appid}: {e}")
        return events

    def collect_for_app(self, appid):
        print(f"Collecting events for AppID: {appid}...")
        all_events = []
        
        release_date = self.get_release_date(appid)
        if release_date:
            try:
                all_events.append({
                    "appid": appid,
                    "date": release_date,
                    "event_type": "Release",
                    "title": "Initial Release",
                    "url": f"https://store.steampowered.com/app/{appid}"
                })
            except Exception:
                pass

        updates = self.get_major_updates(appid)
        all_events.extend(updates)
        
        return all_events

    def run(self, input_csv):
        if not os.path.exists(input_csv):
            print(f"Error: {input_csv} not found.")
            return

        with open(input_csv, mode='r') as f:
            reader = csv.DictReader(f)
            appids = [row['appid'] for row in reader]

        print(f"Starting collection for {len(appids)} apps...")
        results = []
        for appid in appids:
            events = self.collect_for_app(appid)
            results.extend(events)
            time.sleep(0.5) 

        self.save_to_csv(results)

    def save_to_csv(self, results):
        if results:
            keys = results[0].keys()
            with open(self.output_file, 'w', newline='', encoding='utf-8') as f:
                dict_writer = csv.DictWriter(f, fieldnames=keys)
                dict_writer.writeheader()
                dict_writer.writerows(results)
            print(f"\nSuccessfully saved {len(results)} events to {self.output_file}")
        else:
            print("No events found to save.")

def main():
    parser = argparse.ArgumentParser(description="Steam Major Event Collector")
    parser.add_argument("--input", type=str, default="data_collection/filtered_appids.csv", help="Input CSV with appids")
    parser.add_argument("--output", type=str, default="data/game_events.csv", help="Output CSV path")
    parser.add_argument("--appid", type=int, help="Run for a single appid")
    
    args = parser.parse_args()
    collector = SteamEventCollector(output_file=args.output)
    
    if args.appid:
        events = collector.collect_for_app(args.appid)
        if events:
            print(f"Found {len(events)} events for {args.appid}.")
            for e in events: print(f"  [{e['date']}] {e['event_type']}: {e['title']}")
            collector.save_to_csv(events)
        else:
            print(f"No events found for AppID {args.appid}")
    else:
        collector.run(args.input)

if __name__ == "__main__":
    main()
