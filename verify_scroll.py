import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto("http://localhost:5173", wait_until="networkidle")

        # Hover dock button
        dock_btn = page.locator('.dock-button').first
        await dock_btn.hover()
        await page.waitForTimeout(500)

        # Take pre-scroll screenshot
        await page.screenshot(path='/home/jules/verification/screenshots/pre_scroll.png')

        # Find a scrollable container and scroll it
        # The main content area in this app is usually scrollable
        await page.mouse.wheel(0, 500)

        # Wait for the animation to complete (duration.fast is 150ms)
        await page.waitForTimeout(300)

        # Take post-scroll screenshot
        await page.screenshot(path='/home/jules/verification/screenshots/post_scroll.png')

        await browser.close()

asyncio.run(main())
