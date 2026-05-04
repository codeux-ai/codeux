import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1280, "height": 720})

        try:
            print("Navigating to dashboard...")
            await page.goto('http://localhost:5173/memory', wait_until='networkidle')
            print("Waiting for 2 seconds...")
            await asyncio.sleep(2)

            print("Capturing first screenshot (default view)...")
            await page.screenshot(path='/home/jules/verification/screenshots/memory_default.png')

            # Click the list view button if it exists
            print("Looking for List view button...")
            list_btn = await page.query_selector('button:has-text("List")')
            if list_btn:
                print("Clicking List view...")
                await list_btn.click()
                await asyncio.sleep(2)
                await page.screenshot(path='/home/jules/verification/screenshots/memory_list.png')
            else:
                print("List button not found. Maybe it's a segmented control?")
                # Alternative: try finding segmented control item
                list_tab = await page.query_selector('button:has-text("List")')
                if list_tab:
                    await list_tab.click()
                    await asyncio.sleep(2)
                    await page.screenshot(path='/home/jules/verification/screenshots/memory_list.png')

            print("Done")

        except Exception as e:
            print(f"Error: {e}")
            await page.screenshot(path='/home/jules/verification/screenshots/memory_error.png')
        finally:
            await browser.close()

if __name__ == '__main__':
    asyncio.run(run())
