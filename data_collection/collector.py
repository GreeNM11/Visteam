import requests
import time
import json
import csv
import argparse
import os
import pandas as pd
from datetime import datetime, timedelta

# Steam API Endpoint
PLAYER_COUNT_URL = "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/"
# Revenue Multiplier (Boxleiter Method)
REVENUE_MULTIPLIER = 30

class SteamDataCollector:
    def __init__(self, api_key=None):
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "VisteamDataCollector/1.0"})

    def get_historical_data(self, appid):
        """Fetches the full time-series JSON from SteamCharts."""
        url = f"https://steamcharts.com/app/{appid}/chart-data.json"
        try:
            response = self.session.get(url, timeout=10)
            if response.status_code == 200:
                return response.json()
        except Exception:
            pass
        return []

    def collect_history_from_csv(self, input_csv, output_csv, days=90):
        """
        Reads AppIDs from a CSV, fetches recent history for each, 
        and saves it to a long-form CSV.
        """
        if not os.path.exists(input_csv):
            print(f"Error: Input CSV {input_csv} not found.")
            return

        df_input = pd.read_csv(input_csv)
        appid_col = next((col for col in df_input.columns if col.lower() in ['appid', 'steam_appid']), None)
        
        if not appid_col:
            print(f"Error: No 'appid' column found in {input_csv}")
            return

        appids = df_input[appid_col].unique()
        print(f"Starting batch history collection for {len(appids)} games (past {days} days)...")
        
        history_results = []
        start_threshold = datetime.now() - timedelta(days=days)
        start_ts = start_threshold.timestamp() * 1000

        for i, appid in enumerate(appids):
            print(f"[{i+1}/{len(appids)}] Fetching history for AppID: {appid}...")
            data = self.get_historical_data(appid)
            
            if not data:
                print(f"  No data found for {appid}")
                continue

            game_history = []
            for ts, count in data:
                if ts >= start_ts:
                    date_str = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
                    game_history.append({
                        "appid": appid,
                        "date": date_str,
                        "peak_ccu": count
                    })
            
            if game_history:
                df_temp = pd.DataFrame(game_history)
                df_daily = df_temp.groupby(['appid', 'date']).agg({'peak_ccu': 'max'}).reset_index()
                history_results.extend(df_daily.to_dict('records'))
                print(f"  Collected {len(df_daily)} daily peaks.")
            
            time.sleep(1)

        if history_results:
            df_hist = pd.DataFrame(history_results)
            df_hist.to_csv(output_csv, index=False)
            print(f"\nSuccessfully saved {len(history_results)} entries to {output_csv}")
        else:
            print("No historical data collected.")

    def calculate_revenue_for_csv(self, input_csv, output_csv=None):
        """Adds an Estimated Revenue column to an existing CSV."""
        if not os.path.exists(input_csv):
            print(f"Error: {input_csv} not found.")
            return

        print(f"Calculating estimated revenue for {input_csv}...")
        df = pd.read_csv(input_csv)
        
        required = ['Positive', 'Negative', 'Price']
        for col in required:
            if col not in df.columns:
                print(f"Error: Column '{col}' not found in {input_csv}")
                return

        def get_estimate(row):
            try:
                pos = int(row['Positive'])
                neg = int(row['Negative'])
                price = float(row['Price'])
                # Boxleiter Method
                return round((pos + neg) * REVENUE_MULTIPLIER * price, 2)
            except (ValueError, TypeError):
                return 0.0

        df['Estimated Revenue'] = df.apply(get_estimate, axis=1)
        
        out_path = output_csv if output_csv else input_csv
        df.to_csv(out_path, index=False)
        print(f"Added 'Estimated Revenue' column and saved to {out_path}")

def main():
    parser = argparse.ArgumentParser(description="Steam Data Collector - Scaled Down")
    parser.add_argument("--batch-history", type=str, help="CSV path with appids to fetch history for")
    parser.add_argument("--days", type=int, default=90, help="Number of days of history to fetch (default: 90)")
    parser.add_argument("--calculate-revenue", type=str, help="CSV path to add revenue estimation to")
    parser.add_argument("--output", type=str, help="Output CSV file path (optional)")
    
    args = parser.parse_args()
    collector = SteamDataCollector()
    
    if args.calculate_revenue:
        collector.calculate_revenue_for_csv(args.calculate_revenue, args.output)
        return

    if args.batch_history:
        if not args.output:
            print("Error: --output is required when using --batch-history")
            return
        collector.collect_history_from_csv(args.batch_history, args.output, days=args.days)
        return

    parser.print_help()

if __name__ == "__main__":
    main()
