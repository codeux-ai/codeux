import os
from playwright.sync_api import sync_playwright

def run():
    os.makedirs('/home/jules/verification/screenshots', exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        def handle_route(route):
            print(f"Intercepted POST/PATCH: {route.request.url}")
            route.fulfill(status=500, json={"error": "Simulated error from intercepted request"})

        page.route("**/api/projects/*/sprints", handle_route)
        page.route("**/api/projects/*/sprints/**", handle_route)

        print("Navigating to /sprints")
        page.goto("http://localhost:4444/sprints")
        page.wait_for_load_state("networkidle")

        print("Clicking the huge NEW SPRINT circle in the middle...")
        # the center area has text "NEW SPRINT" and "SPR-01"
        try:
            # We'll click it directly using force since there is no composer open
            page.locator("text=NEW SPRINT").first.click()
            page.wait_for_timeout(1000)
            print("Opened composer")
        except Exception as e:
            print("Failed to click NEW SPRINT circle", e)

        # Now composer should be open
        try:
            page.locator("textarea").first.fill("Test Sprint Goal")
            print("Filled Sprint Goal")

            # Use force to click SAVE DRAFT, to bypass any pointer-events interference
            page.get_by_text("SAVE DRAFT").first.click(force=True)
            print("Clicked SAVE DRAFT")
        except Exception as e:
            print("Failed to interact with composer", e)

        print("Waiting for error to appear")
        page.wait_for_timeout(2000)
        page.screenshot(path='/home/jules/verification/screenshots/verification6.png')
        print("Done")

if __name__ == "__main__":
    run()