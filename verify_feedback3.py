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
            route.fulfill(status=500, json={"error": "Simulated quicksprint failure"})

        # In the useSprintsPageData: return await sprintApi.createSprint(projectId, payload);
        # Which POSTs to /api/projects/*/sprints
        page.route("**/api/projects/*/sprints", handle_route)

        print("Navigating to /sprints")
        page.goto("http://localhost:4444/sprints")
        page.wait_for_load_state("networkidle")

        print("Opening New Sprint composer")
        # In the screenshot there is a "NEW SPRINT" button when quicksprint is open
        page.get_by_text("NEW SPRINT").first.click()
        page.wait_for_timeout(1000)

        print("Filling out form")
        page.get_by_label("Sprint Name").fill("Test Playwright Sprint")
        page.get_by_label("Sprint Goal").fill("Test the failure mechanism")

        # Submit the sprint
        print("Clicking Start Sprint")
        try:
            page.get_by_text("START SPRINT", exact=True).first.click(timeout=3000)
        except Exception:
            print("Trying SAVE DRAFT")
            page.get_by_text("SAVE DRAFT", exact=True).first.click(timeout=3000)

        print("Waiting for error to appear")
        page.wait_for_timeout(2000)

        page.screenshot(path='/home/jules/verification/screenshots/verification3.png')
        print("Done")

if __name__ == "__main__":
    run()