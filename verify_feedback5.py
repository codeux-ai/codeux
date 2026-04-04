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

        print("Locating Sprint Key input and Sprint Goal textarea in Composer...")
        # Since the composer is visible, let's just type directly into the visible inputs
        try:
            page.locator("input[placeholder='SPR-01']").fill("TEST-123")
            print("Filled Sprint Key")
        except Exception:
            print("Failed to find Sprint Key by placeholder")

        try:
            page.locator("textarea").first.fill("Test Sprint Goal")
            print("Filled Sprint Goal")
        except Exception:
            print("Failed to find textarea")

        print("Clicking PLAN & START")
        # In the right sidebar: "PLAN & START"
        try:
            page.get_by_text("PLAN & START").first.click(timeout=3000)
            print("Clicked PLAN & START")
        except Exception:
            try:
                page.get_by_text("PLAN ONLY").first.click(timeout=3000)
                print("Clicked PLAN ONLY")
            except Exception:
                try:
                    page.get_by_text("SAVE DRAFT").first.click(timeout=3000)
                    print("Clicked SAVE DRAFT")
                except Exception as e:
                    print("Failed to click any execution button", e)

        print("Waiting for error to appear")
        page.wait_for_timeout(2000)
        page.screenshot(path='/home/jules/verification/screenshots/verification5.png')
        print("Done")

if __name__ == "__main__":
    run()