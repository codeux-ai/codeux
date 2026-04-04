import os
from playwright.sync_api import sync_playwright

def run():
    os.makedirs('/home/jules/verification/screenshots', exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Intercept POST to quicksprints endpoint to fail
        def handle_route(route):
            print(f"Intercepted: {route.request.url}")
            route.fulfill(status=500, json={"error": "Simulated sprint action failure"})

        # Intercept any POST/PATCH to sprint related routes to simulate an action failure that the hook captures
        page.route("**/api/projects/*/sprints/**", handle_route)
        page.route("**/api/projects/*/sprints", handle_route)

        print("Navigating to /sprints")
        page.goto("http://localhost:4444/sprints")
        page.wait_for_load_state("networkidle")

        print("Clicking CLOSE QUICKSPRINT")
        try:
            page.get_by_text("CLOSE QUICKSPRINT").first.click(timeout=3000)
            page.wait_for_timeout(1000)
        except Exception:
            pass

        print("Looking for a sprint to START or STOP")
        # In case a sprint exists, we can try to click "START" or "STOP"
        try:
            page.get_by_text("START", exact=True).first.click(timeout=3000)
            print("Clicked START")
        except Exception:
            try:
                page.get_by_text("STOP", exact=True).first.click(timeout=3000)
                print("Clicked STOP")
            except Exception:
                try:
                    # Look for Toggle Showcase or Append Tasks
                    page.get_by_text("SHOWCASE", exact=True).first.click(timeout=3000)
                    print("Clicked SHOWCASE")
                except Exception:
                    print("Could not find any existing sprints, trying NEW SPRINT again")
                    page.get_by_text("NEW SPRINT").first.click()
                    page.wait_for_timeout(1000)
                    try:
                        page.get_by_placeholder("Identify a clear objective...").fill("Test Goal")
                        page.get_by_text("SAVE DRAFT").first.click()
                    except Exception as e:
                        print("Failed to save draft", e)

        print("Waiting for error to appear")
        page.wait_for_timeout(2000)

        page.screenshot(path='/home/jules/verification/screenshots/verification4.png')
        print("Done")

if __name__ == "__main__":
    run()