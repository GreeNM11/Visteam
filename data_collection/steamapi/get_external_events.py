import csv
import os
import argparse

# Curated major industry events 2022-2025.
# These are hand-entered anchors that help compare game-specific spikes against bigger industry moments.
INDUSTRY_EVENTS = [
    # --- The Game Awards ---
    {"date": "2022-12-08", "event_type": "Industry", "title": "The Game Awards 2022", "url": "https://thegameawards.com/"},
    {"date": "2023-12-07", "event_type": "Industry", "title": "The Game Awards 2023", "url": "https://thegameawards.com/"},
    {"date": "2024-12-12", "event_type": "Industry", "title": "The Game Awards 2024", "url": "https://thegameawards.com/"},
    {"date": "2025-12-11", "event_type": "Industry", "title": "The Game Awards 2025", "url": "https://thegameawards.com/"},
    
    # --- Summer Game Fest ---
    {"date": "2022-06-09", "event_type": "Industry", "title": "Summer Game Fest 2022", "url": "https://www.summergamefest.com/"},
    {"date": "2023-06-08", "event_type": "Industry", "title": "Summer Game Fest 2023", "url": "https://www.summergamefest.com/"},
    {"date": "2024-06-07", "event_type": "Industry", "title": "Summer Game Fest 2024", "url": "https://www.summergamefest.com/"},
    {"date": "2025-06-06", "event_type": "Industry", "title": "Summer Game Fest 2025", "url": "https://www.summergamefest.com/"},
    
    # --- Gamescom Opening Night Live ---
    {"date": "2022-08-23", "event_type": "Industry", "title": "Gamescom ONL 2022", "url": "https://www.gamescom.global/"},
    {"date": "2023-08-22", "event_type": "Industry", "title": "Gamescom ONL 2023", "url": "https://www.gamescom.global/"},
    {"date": "2024-08-20", "event_type": "Industry", "title": "Gamescom ONL 2024", "url": "https://www.gamescom.global/"},
    {"date": "2025-08-19", "event_type": "Industry", "title": "Gamescom ONL 2025", "url": "https://www.gamescom.global/"},

    # --- Game Developers Conference (GDC) ---
    {"date": "2022-03-21", "event_type": "Industry", "title": "GDC 2022", "url": "https://gdconf.com/"},
    {"date": "2023-03-20", "event_type": "Industry", "title": "GDC 2023", "url": "https://gdconf.com/"},
    {"date": "2024-03-18", "event_type": "Industry", "title": "GDC 2024", "url": "https://gdconf.com/"},
    {"date": "2025-03-17", "event_type": "Industry", "title": "GDC 2025", "url": "https://gdconf.com/"},

    # --- Tokyo Game Show (TGS) ---
    {"date": "2022-09-15", "event_type": "Industry", "title": "Tokyo Game Show 2022", "url": "https://tgs.cesa.or.jp/"},
    {"date": "2023-09-21", "event_type": "Industry", "title": "Tokyo Game Show 2023", "url": "https://tgs.cesa.or.jp/"},
    {"date": "2024-09-26", "event_type": "Industry", "title": "Tokyo Game Show 2024", "url": "https://tgs.cesa.or.jp/"},
    {"date": "2025-09-25", "event_type": "Industry", "title": "Tokyo Game Show 2025", "url": "https://tgs.cesa.or.jp/"},

    # --- PAX Events (East & West) ---
    {"date": "2022-04-21", "event_type": "Industry", "title": "PAX East 2022", "url": "https://east.paxsite.com/"},
    {"date": "2022-09-02", "event_type": "Industry", "title": "PAX West 2022", "url": "https://west.paxsite.com/"},
    {"date": "2023-03-23", "event_type": "Industry", "title": "PAX East 2023"},
    {"date": "2023-09-01", "event_type": "Industry", "title": "PAX West 2023"},
    {"date": "2024-03-21", "event_type": "Industry", "title": "PAX East 2024"},
    {"date": "2024-08-30", "event_type": "Industry", "title": "PAX West 2024"},
    {"date": "2025-05-08", "event_type": "Industry", "title": "PAX East 2025"},
    {"date": "2025-08-29", "event_type": "Industry", "title": "PAX West 2025"},

    # --- Steam Seasonal Sales ---
    # 2023
    {"date": "2023-03-16", "event_type": "SteamSale", "title": "Steam Spring Sale 2023"},
    {"date": "2023-06-29", "event_type": "SteamSale", "title": "Steam Summer Sale 2023"},
    {"date": "2023-11-21", "event_type": "SteamSale", "title": "Steam Autumn Sale 2023"},
    {"date": "2023-12-21", "event_type": "SteamSale", "title": "Steam Winter Sale 2023"},
    # 2024
    {"date": "2024-03-14", "event_type": "SteamSale", "title": "Steam Spring Sale 2024"},
    {"date": "2024-06-27", "event_type": "SteamSale", "title": "Steam Summer Sale 2024"},
    {"date": "2024-11-27", "event_type": "SteamSale", "title": "Steam Autumn Sale 2024"},
    {"date": "2024-12-19", "event_type": "SteamSale", "title": "Steam Winter Sale 2024"},
    # 2025
    {"date": "2025-03-13", "event_type": "SteamSale", "title": "Steam Spring Sale 2025"},
    {"date": "2025-06-26", "event_type": "SteamSale", "title": "Steam Summer Sale 2025"},
    {"date": "2025-09-29", "event_type": "SteamSale", "title": "Steam Autumn Sale 2025"},
    {"date": "2025-12-18", "event_type": "SteamSale", "title": "Steam Winter Sale 2025"},

    # --- Steam Next Fest ---
    {"date": "2025-02-24", "event_type": "SteamNextFest", "title": "Steam Next Fest February 2025"},
    {"date": "2025-06-09", "event_type": "SteamNextFest", "title": "Steam Next Fest June 2025"},
    {"date": "2025-10-13", "event_type": "SteamNextFest", "title": "Steam Next Fest October 2025"},
]

def save_to_csv(output_file):
    # This script is intentionally simple: just dump the curated list into the same CSV shape as game events.
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    if not INDUSTRY_EVENTS:
        print("No events to save.")
        return
        
    keys = ["date", "event_type", "title", "url"]
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        for event in INDUSTRY_EVENTS:
            # Some entries intentionally omit URLs, so we backfill missing keys with empty strings.
            row = {k: event.get(k, "") for k in keys}
            writer.writerow(row)
    print(f"Successfully saved {len(INDUSTRY_EVENTS)} industry events to {output_file}")

def main():
    parser = argparse.ArgumentParser(description="External Industry Event Collector")
    parser.add_argument("--output", type=str, default="data/industry_events.csv", help="Output CSV path")
    args = parser.parse_args()
    save_to_csv(args.output)

if __name__ == "__main__":
    main()
