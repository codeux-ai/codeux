import os
from playwright.sync_api import sync_playwright

def run():
    os.makedirs('/home/jules/verification/screenshots', exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Intercept quicksprint to fail
        def handle_route(route):
            print(f"Intercepted: {route.request.url}")
            route.fulfill(status=500, json={"error": "Simulated quicksprint failure"})

        page.route("**/api/projects/*/quicksprint", handle_route)

        print("Navigating to /sprints")
        page.goto("http://localhost:4444/sprints")
        page.wait_for_load_state("networkidle")

        print("Clicking QUICKSPRINT")
        # Let's try locating the button by text since role button was failing or maybe it's not present if there is no project
        # In the screenshot, we see "Test Project" in the header, and the QUICKSPRINT button
        try:
            page.get_by_text("QUICKSPRINT").first.click(timeout=5000)
        except Exception as e:
            print("Failed to click QUICKSPRINT:", e)
            print("Trying to create project instead...")
            # We must be on /sprints. Let's see if we can find New Project form.
            page.goto("http://localhost:4444/config")
            page.wait_for_load_state("networkidle")
            page.screenshot(path='/home/jules/verification/screenshots/config.png')

            # Let's see what's actually on the page to create project
            return

        print("Waiting for error to appear")
        page.wait_for_timeout(2000)

        page.screenshot(path='/home/jules/verification/screenshots/verification2.png')
        print("Done")

if __name__ == "__main__":
    run()