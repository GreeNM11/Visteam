import sqlite3
import csv
import glob
import os
import argparse

def merge_to_sql(csv_dir, events_csv, db_path):
    """Compiles all CSV data into a single SQLite database."""
    print(f"Connecting to database: {db_path}")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("DROP TABLE IF EXISTS player_history")
    cursor.execute("""
        CREATE TABLE player_history (
            appid INTEGER,
            datetime TEXT,
            players INTEGER,
            average_players INTEGER
        )
    """)

    cursor.execute("DROP TABLE IF EXISTS events")
    cursor.execute("""
        CREATE TABLE events (
            appid INTEGER,
            date TEXT,
            event_type TEXT,
            title TEXT,
            url TEXT
        )
    """)

    csv_files = glob.glob(os.path.join(csv_dir, "*.csv"))
    print(f"Found {len(csv_files)} player history files.")
    
    player_data = []
    for fpath in csv_files:
        appid = os.path.basename(fpath).replace(".csv", "")
        if not appid.isdigit():
            import re
            match = re.search(r'\d+', appid)
            if match:
                appid = match.group()
            else:
                continue

        with open(fpath, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                dt = row.get("DateTime")
                p = row.get("Players")
                avg_p = row.get("Average Players", 0)
                
                if dt and p:
                    player_data.append((int(appid), dt, int(p), int(avg_p) if avg_p else 0))

    if player_data:
        print(f"Inserting {len(player_data)} player records...")
        cursor.executemany("INSERT INTO player_history VALUES (?, ?, ?, ?)", player_data)

    if os.path.exists(events_csv):
        print(f"Processing events from {events_csv}...")
        event_records = []
        with open(events_csv, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                event_records.append((
                    int(row['appid']),
                    row['date'],
                    row['event_type'],
                    row['title'],
                    row['url']
                ))
        
        if event_records:
            print(f"Inserting {len(event_records)} event records...")
            cursor.executemany("INSERT INTO events VALUES (?, ?, ?, ?, ?)", event_records)

    conn.commit()
    
    print("Creating indexes...")
    cursor.execute("CREATE INDEX idx_players_appid ON player_history(appid)")
    cursor.execute("CREATE INDEX idx_events_appid ON events(appid)")
    
    conn.close()
    print("Done! Database ready.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Merge CSVs to SQLite")
    parser.add_argument("--csv-dir", default="data/steamdb_csvs", help="Directory with player CSVs")
    parser.add_argument("--events", default="data/game_events.csv", help="Path to major events CSV")
    parser.add_argument("--output", default="data/visteam.db", help="Output SQLite DB path")
    
    args = parser.parse_args()
    merge_to_sql(args.csv_dir, args.events, args.output)
