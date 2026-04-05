import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        # Taller viewport so the whole page fits easily
        page = await browser.new_page(viewport={"width": 1600, "height": 2000})
        await page.goto('http://localhost:4444')
        await page.wait_for_timeout(2000)

        # Click the stats icon
        stats_link = page.locator('a[href*="/stats"]')
        if await stats_link.count() > 0:
            await stats_link.first.click()
            await page.wait_for_timeout(3000)

        # Scroll down slightly more aggressively
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight);")
        await page.wait_for_timeout(2000)

        await page.screenshot(path='/home/jules/verification/verification4.png', full_page=True)
        await browser.close()

asyncio.run(main())
