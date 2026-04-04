import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        # Intercept the quicksprints endpoint to fail
        await page.route("**/api/projects/*/quicksprints", lambda route: route.fulfill(
            status=500,
            json={"error": "Simulated error executing quicksprint"}
        ))

        await page.goto("http://localhost:4444/sprints")
        await page.wait_for_selector("text=QUICKSPRINT", timeout=5000)

        # Click QUICKSPRINT
        await page.click("text=QUICKSPRINT", force=True)

        await page.wait_for_timeout(2000)
        await page.screenshot(path="/home/jules/verification/screenshots/verification8.png", full_page=True)
        print("Captured verification8.png")

        await browser.close()

asyncio.run(main())
