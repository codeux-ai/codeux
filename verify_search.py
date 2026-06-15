import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Bypass onboarding
        await page.add_init_script("""
            localStorage.setItem('codeux:onboarding-complete:v1', 'true');
            localStorage.setItem('codeux:dashboard-tour-hidden:v1', 'true');
        """)

        print("Navigating to http://localhost:4444...")
        await page.goto("http://localhost:4444", wait_until="networkidle")

        # Wait a moment for rendering
        await page.wait_for_timeout(2000)

        # Open search overlay via hotkey (Cmd+K / Ctrl+K)
        print("Pressing Meta+K to open search overlay...")
        await page.keyboard.press("Meta+K")

        # Wait for dialog to open
        print("Waiting for dialog...")
        try:
            await page.wait_for_selector('div[role="dialog"]', timeout=5000)
            print("Dialog found!")
        except Exception as e:
            print(f"Failed to find dialog: {e}")
            # take a screenshot anyway to see what is on screen

        # Take screenshot
        print("Taking screenshot...")
        await page.screenshot(path="verification5.png", full_page=True)
        print("Screenshot saved to verification5.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
