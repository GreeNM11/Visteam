import pandas as pd
import os
import argparse

def merge_events(game_csv, industry_csv, output_csv):
    """Merges game-specific events and industry-wide events into one CSV."""
    dfs = []
    
    # Game events and external events are optional inputs, so we only merge the files that exist.
    if os.path.exists(game_csv):
        print(f"Loading game events from {game_csv}...")
        df_game = pd.read_csv(game_csv)
        dfs.append(df_game)
    else:
        print(f"Warning: {game_csv} not found.")

    if os.path.exists(industry_csv):
        print(f"Loading industry events from {industry_csv}...")
        df_ind = pd.read_csv(industry_csv)
        # Industry events do not belong to one game, so appid 0 acts like a neutral placeholder.
        if 'appid' not in df_ind.columns:
            df_ind['appid'] = 0
        dfs.append(df_ind)
    else:
        print(f"Warning: {industry_csv} not found.")

    if not dfs:
        print("No event files found to merge.")
        return

    merged_df = pd.concat(dfs, ignore_index=True)
    
    # Convert to datetime long enough to sort correctly, then switch back to the string format the frontend expects.
    merged_df['date'] = pd.to_datetime(merged_df['date'], errors='coerce')
    merged_df = merged_df.dropna(subset=['date'])
    merged_df = merged_df.sort_values(by='date', ascending=False)
    
    # Back to string for CSV export.
    merged_df['date'] = merged_df['date'].dt.strftime('%Y-%m-%d')
    
    os.makedirs(os.path.dirname(output_csv), exist_ok=True)
    merged_df.to_csv(output_csv, index=False)
    
    print(f"\nSuccessfully merged events into {output_csv}")
    print(f"Total events: {len(merged_df)}")
    print("\nEvent breakdown:")
    print(merged_df['event_type'].value_counts())

def main():
    parser = argparse.ArgumentParser(description="Merge Game and Industry Events")
    parser.add_argument("--game", type=str, default="data/refined_game_events.csv", help="Path to game events CSV")
    parser.add_argument("--industry", type=str, default="data/industry_events.csv", help="Path to industry events CSV")
    parser.add_argument("--output", type=str, default="data/all_events.csv", help="Path to output CSV")
    
    args = parser.parse_args()
    merge_events(args.game, args.industry, args.output)

if __name__ == "__main__":
    main()
