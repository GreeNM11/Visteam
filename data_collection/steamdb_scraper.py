import asyncio
import os
import csv
import argparse
from playwright.async_api import async_playwright

async def download_steamdb_csv(appid, output_dir, cdp_url="http://localhost:9222"):
    """
    Connects to a running Chrome instance, selects 'All' time range, 
    and triggers a CSV download.
    """
    url = f"https://steamdb.info/app/{appid}/charts/"
    output_path = os.path.join(output_dir, f"{appid}.csv")
    
    # We overwrite to ensure we get the better version
    # if os.path.exists(output_path):
    #     print(f"[{appid}] already exists. Skipping.")
    #     return True

    async with async_playwright() as p:
        try:
            print(f"[{appid}] Connecting to Chrome at {cdp_url}...")
            browser = await p.chromium.connect_over_cdp(cdp_url)
            context = browser.contexts[0]
            page = await context.new_page()
            
            print(f"[{appid}] Navigating to {url}...")
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
            
            if "Just a moment..." in await page.title():
                print(f"[{appid}] Stopped by Cloudflare. Please solve it in your browser.")
                await page.wait_for_function("document.title.indexOf('Just a moment') === -1", timeout=300000)

            print(f"[{appid}] Waiting for chart...")
            await page.wait_for_selector(".highcharts-container", timeout=30000)
            
            # 1. Click 'All' resolution if available
            print(f"[{appid}] Selecting 'All' time range...")
            await page.evaluate("""
                () => {
                    // Highcharts range selector buttons
                    const buttons = Array.from(document.querySelectorAll('.highcharts-range-selector-buttons .highcharts-button text'));
                    const allBtn = buttons.find(b => b.textContent === 'All' || b.textContent === 'Max');
                    if (allBtn) {
                        allBtn.parentElement.dispatchEvent(new MouseEvent('click', {bubbles: true}));
                    }
                }
            """)
            await asyncio.sleep(2) # Wait for chart to re-render with full data

            # 2. Trigger the official download
            print(f"[{appid}] Triggering official CSV download...")
            
            try:
                async with page.expect_download(timeout=15000) as download_info:
                    # Try direct button click first
                    clicked = await page.evaluate("""
                        () => {
                            const buttons = Array.from(document.querySelectorAll('button, a, .btn'));
                            const csvBtn = buttons.find(b => b.innerText.includes('Download CSV') || b.title.includes('Download CSV'));
                            if (csvBtn) {
                                csvBtn.click();
                                return true;
                            }
                            // Fallback to Highcharts API
                            if (window.Highcharts && Highcharts.charts[0]) {
                                Highcharts.charts[0].downloadCSV();
                                return true;
                            }
                            return false;
                        }
                    """)
                    if not clicked:
                        raise Exception("No download button or Highcharts instance found.")
                
                download = await download_info.value
                await download.save_as(output_path)
                print(f"[{appid}] Successfully downloaded complete data to {output_path}")
                return True
            
            except Exception as e:
                print(f"[{appid}] Official download failed: {e}")
                print(f"[{appid}] Falling back to JS extraction...")
                csv_data = await page.evaluate("Highcharts.charts[0].getCSV()")
                if csv_data:
                    with open(output_path, "w", encoding="utf-8") as f:
                        f.write(csv_data)
                    print(f"[{appid}] Saved via fallback.")
                    return True
                else:
                    return False

        except Exception as e:
            print(f"[{appid}] Error: {e}")
            return False
        finally:
            if 'page' in locals():
                await page.close()

async def batch_process(input_csv, appid_single, output_dir, cdp_url):
    os.makedirs(output_dir, exist_ok=True)
    
    appids = []
    if appid_single:
        appids = [str(appid_single)]
    elif os.path.exists(input_csv):
        with open(input_csv, mode='r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Find key case-insensitively (handles 'appid', 'AppID', 'Appid', etc.)
                aid_key = next((k for k in row.keys() if k.lower() == 'appid'), None)
                if aid_key and row[aid_key]:
                    appids.append(str(row[aid_key]))
    
    if not appids:
        print("No AppIDs found.")
        return

    # Check existing files to avoid repeats
    existing_files = {f.replace(".csv", "") for f in os.listdir(output_dir) if f.endswith(".csv")}
    remaining_appids = [aid for aid in appids if aid not in existing_files]
    
    total_original = len(appids)
    total_remaining = len(remaining_appids)
    
    print(f"Total AppIDs in list: {total_original}")
    print(f"Already downloaded:  {len(appids) - total_remaining}")
    print(f"Remaining to process: {total_remaining}")
    
    if not remaining_appids:
        print("All AppIDs already processed. Exiting.")
        return

    print("\nStarting batch for remaining chips...")
    
    for i, aid in enumerate(remaining_appids):
        print(f"\nProgress: {i+1}/{total_remaining} (Overall: {total_original - total_remaining + i + 1}/{total_original})")
        success = await download_steamdb_csv(aid, output_dir, cdp_url=cdp_url)
        if not success:
            print(f"  Failed at {aid}. Stopping.")
            break
        await asyncio.sleep(3) # Slightly longer delay to let browser breathe

def main():
    parser = argparse.ArgumentParser(description="SteamDB CSV Downloader (Full Data)")
    parser.add_argument("--input", type=str, default="data_collection/filtered_appids.csv")
    parser.add_argument("--appid", type=int)
    parser.add_argument("--output", type=str, default="data/steamdb_csvs")
    parser.add_argument("--cdp", type=str, default="http://localhost:9222")
    
    args = parser.parse_args()
    asyncio.run(batch_process(args.input, args.appid, args.output, args.cdp))

if __name__ == "__main__":
    main()
