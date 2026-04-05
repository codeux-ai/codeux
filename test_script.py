from playwright.sync_api import sync_playwright

def run_cuj(page):
    page.goto("http://localhost:4444")
    page.wait_for_timeout(2000)

    # Click on the Stats navigation item
    page.get_by_role("link", name="Stats").click()
    page.wait_for_timeout(2000)

    # There should be an active project for stats to display
    page.screenshot(path="/home/jules/verification/screenshots/verification.png")
    page.wait_for_timeout(1000)

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            record_video_dir="/home/jules/verification/videos"
        )
        page = context.new_page()
        try:
            run_cuj(page)
        finally:
            context.close()
            browser.close()
