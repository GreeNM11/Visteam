import csv
import os

INPUT_FILE = "data_collection/filtered_games.csv"
OUTPUT_FILE = "data_collection/filtered_games_classified.csv"

LARGE_STUDIOS = {
    "Activision", "Activision Blizzard", "Blizzard Entertainment", "EA", "Electronic Arts", "EA Canada", 
    "EA Romania", "Ubisoft", "Ubisoft Entertainment", "Ubisoft Montreal", "Ubisoft Quebec", 
    "Ubisoft Toronto", "Ubisoft Paris", "Ubisoft Milan", "Ubisoft Montpellier", "Ubisoft Annecy", 
    "Sony", "PlayStation Publishing LLC", "Sony Interactive Entertainment", "Insomniac Games", 
    "Naughty Dog LLC", "Santa Monica Studio", "Guerrilla", "Sucker Punch Productions", "Polyphony Digital", 
    "Bend Studio", "Microsoft", "Xbox Game Studios", "343 Industries", "The Coalition", "Turn 10 Studios", 
    "Rare Ltd", "Mojang Studios", "Obsidian Entertainment", "Bethesda Softworks", "Bethesda Game Studios", 
    "ZeniMax Online Studios", "id Software", "Arkane Studios", "Tango Gameworks", "MachineGames", 
    "Nintendo", "Capcom", "Capcom Co.", "Capcom Co., Ltd.", "Sega", "Sega (Japan)", "Square Enix", 
    "Bandai Namco", "Bandai Namco Entertainment", "Bandai Namco Studios Inc.", "Warner Bros. Games", 
    "Warner Bros. Interactive Entertainment", "Rockstar Games", "Rockstar North", "Rockstar Toronto", 
    "Take-Two Interactive", "2K", "Visual Concepts", "Hangar 13", "Gearbox Software", "Gearbox Publishing", 
    "Epic Games", "Valve", "Konami", "Koei Tecmo", "Koei Tecmo Games Co.", "Atlus", "Sega Europe", 
    "CD PROJEKT RED", "DICE", "Infinity Ward", "Sledgehammer Games", "Treyarch", "Raven Software", 
    "High Moon Studios", "Beenox", "Vicarious Visions", "Toys for Bob", "Digital Extremes", 
    "Bungie", "FromSoftware", "Amazon Games", "Amazon Game Studios", "Krafton", "NCSOFT", "Nexon", 
    "NetEase Games", "Tencent Games", "BioWare", "Maxis", "Criterion Games", "Respawn Entertainment", 
    "PopCap Games"
}

MEDIUM_STUDIOS = {
    "11 bit studios", "505 Games", "Focus Entertainment", "THQ Nordic", "Paradox Interactive", 
    "Paradox Development Studio", "Deep Silver", "Koch Media", "Deconstructeam", "Devolver Digital", 
    "Team17", "Techland", "Crytek", "Larian Studios", "Funcom", "Fatshark", "Sharkmob", 
    "Pearl Abyss", "Grinding Gear Games", "Bohemia Interactive", "Hello Games", "Jagex Ltd", 
    "Frontier Developments", "Rebellion", "Avalanche Studios", "Remedy Entertainment", "Supergiant Games", 
    "Coffee Stain Studios", "Coffee Stain Publishing", "Ghost Ship Games", "Ghost Ship Publishing", 
    "Iron Gate AB", "Valheim", "Unknown Worlds Entertainment", "Daedalic Entertainment", 
    "Focus Home Interactive", "Kalypso Media", "Aerosoft GmbH", "Giants Software", "SCS Software", 
    "TaleWorlds Entertainment", "Tripwire Interactive", "Iceberg Interactive", "Wired Productions", 
    "Dreadbit", "Humble Games", "Curve Games", "Neon Giant", "Raw Fury", "PlayWay S.A.", 
    "Team Cherry", "Motion Twin", "Subset Games", "ConcernedApe", "Klei Entertainment", "Vlambeer", 
    "Double Fine Productions", "Nightdive Studios", "Aspyr", "Digital Eclipse", "Saber Interactive", 
    "Quantic Dream", "Don't Nod Entertainment", "Milestone S.r.l.", "Bigben Interactive", "Nacon", 
    "Microïds", "Dotemu", "Spiders", "Cyanide Studio", "Gaijin Entertainment", "Warhorse Studios"
}

def classify(devs_str, pubs_str):
    # Normalize and split
    names = set()
    if devs_str:
        names.update([n.strip().lower() for n in devs_str.split(',')])
    if pubs_str:
        names.update([n.strip().lower() for n in pubs_str.split(',')])
    
    large_lower = {n.lower() for n in LARGE_STUDIOS}
    medium_lower = {n.lower() for n in MEDIUM_STUDIOS}
    
    # Check for direct matches or substrings
    is_large = False
    is_medium = False
    
    for name in names:
        if name in large_lower:
            is_large = True
            break
        for l in large_lower:
            if l in name or name in l:
                if len(name) > 3 or name == l: # Avoid tiny name matching
                    is_large = True
                    break
        if is_large: break

    if is_large: return "Large Studio"

    for name in names:
        if name in medium_lower:
            is_medium = True
            break
        for m in medium_lower:
            if m in name or name in m:
                if len(name) > 3 or name == m:
                    is_medium = True
                    break
        if is_medium: break
        
    if is_medium: return "Medium Studio"
    
    return "Indie"

def process_classification():
    if not os.path.exists(INPUT_FILE):
        print(f"Error: {INPUT_FILE} not found.")
        return

    print(f"Classifying studios in {INPUT_FILE}...")
    
    rows = []
    fieldnames = []
    
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames + ['Studio Size']
        
        for row in reader:
            row['Studio Size'] = classify(row['Developers'], row['Publishers'])
            rows.append(row)

    with open(OUTPUT_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Classification complete! Saved to {OUTPUT_FILE}")
    
    # Stats
    stats = {}
    for row in rows:
        size = row['Studio Size']
        stats[size] = stats.get(size, 0) + 1
    
    print("\nClassification Stats:")
    for size, count in stats.items():
        print(f"  {size}: {count}")

if __name__ == "__main__":
    process_classification()
