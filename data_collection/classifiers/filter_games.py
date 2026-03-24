import csv
import os
import sys

csv.field_size_limit(sys.maxsize)

INPUT_FILE = "data_collection/games.csv"
FILTER_FILE = "data_collection/filtered_appids.csv"
OUTPUT_FILE = "data_collection/filtered_games.csv"

# Original header in games.csv is missing a comma between Discount and DLC count.
CORRECT_HEADER = [
    'AppID', 'Name', 'Release date', 'Estimated owners', 'Peak CCU', 
    'Required age', 'Price', 'Discount', 'DLC count', 'About the game', 
    'Supported languages', 'Full audio languages', 'Reviews', 
    'Header image', 'Website', 'Support url', 'Support email', 
    'Windows', 'Mac', 'Linux', 'Metacritic score', 'Metacritic url', 
    'User score', 'Positive', 'Negative', 'Score rank', 'Achievements', 
    'Recommendations', 'Notes', 'Average playtime forever', 
    'Average playtime two weeks', 'Median playtime forever', 
    'Median playtime two weeks', 'Developers', 'Publishers', 
    'Categories', 'Genres', 'Tags', 'Screenshots', 'Movies'
]

EXPORT_FIELDS = [
    'AppID', 'Name', 'Release date', 'Estimated owners', 'Peak CCU', 
    'Price', 'Metacritic score', 'Positive', 'Negative', 
    'Developers', 'Publishers', 'Categories', 'Genres', 'Tags'
]

def filter_games():
    if not os.path.exists(INPUT_FILE):
        print(f"Error: {INPUT_FILE} not found.")
        return
    if not os.path.exists(FILTER_FILE):
        print(f"Error: {FILTER_FILE} not found.")
        return

    print(f"Loading filtered AppIDs from {FILTER_FILE}...")
    filtered_appids = set()
    try:
        with open(FILTER_FILE, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            id_field = 'appid' if 'appid' in reader.fieldnames else 'AppID'
            for row in reader:
                filtered_appids.add(row[id_field].strip())
    except Exception as e:
        print(f"Error loading {FILTER_FILE}: {e}")
        return

    print(f"Loaded {len(filtered_appids)} AppIDs.")
    print(f"Filtering {INPUT_FILE}...")
    
    count = 0
    matches = 0
    
    try:
        with open(INPUT_FILE, 'r', encoding='utf-8') as f:
            next(f)
            reader = csv.DictReader(f, fieldnames=CORRECT_HEADER)
            
            with open(OUTPUT_FILE, 'w', newline='', encoding='utf-8') as out_f:
                writer = csv.DictWriter(out_f, fieldnames=EXPORT_FIELDS, extrasaction='ignore')
                writer.writeheader()
                
                for row in reader:
                    count += 1
                    if count % 10000 == 0:
                        print(f"Processed {count} rows...")
                    
                    if row['AppID'] and row['AppID'].strip() in filtered_appids:
                        writer.writerow(row)
                        matches += 1

        print(f"\nProcessed {count} rows.")
        print(f"Found {matches} matches in {INPUT_FILE} out of {len(filtered_appids)} AppIDs.")
        print(f"Saved filtered games to {OUTPUT_FILE}")
        
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    filter_games()
