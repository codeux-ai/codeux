import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        await page.goto("http://localhost:4444/sprints")
        await page.wait_for_selector("text=NEW SPRINT", timeout=5000)

        # 1. Create a sprint normally
        await page.click("text=NEW SPRINT", force=True)
        await page.wait_for_selector("textarea", timeout=5000)
        await page.fill("textarea", "Valid Sprint Goal")
        await page.click("text=SAVE DRAFT", force=True)

        # Wait for modal to close (textarea should disappear)
        await page.wait_for_selector("textarea", state="hidden", timeout=10000)

        # 2. Intercept start endpoint to fail
        await page.route("**/api/projects/*/sprints/*/start", lambda route: route.fulfill(
            status=500,
            json={"error": "Simulated error during sprint start"}
        ))

        # Wait a bit for the UI to update and show the new sprint
        await page.wait_for_timeout(2000)

        # 3. Click the START button on the sprint card
        # The button is likely an icon or text "START". Let's look for text="START"
        start_button = page.locator("button:has-text('START')").first
        if await start_button.is_visible():
            await start_button.click(force=True)
        else:
            # Maybe it's a play icon or similar, let's try just "Start"
            start_buttons = page.locator("text=Start")
            if await start_buttons.count() > 0:
                await start_buttons.first.click(force=True)
            else:
                print("Could not find start button, clicking anywhere to see if something happens")

        await page.wait_for_timeout(2000)
        await page.screenshot(path="/home/jules/verification/screenshots/verification7.png", full_page=True)
        print("Captured verification7.png")

        await browser.close()

asyncio.run(main())
