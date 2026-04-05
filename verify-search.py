from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:4444")

        # Wait for app to load initially
        page.wait_for_timeout(5000)

        # Click the search bar
        page.locator('input[placeholder="Search..."]').first.click()
        page.wait_for_timeout(2000)

        # Take a screenshot of the empty overlay
        page.screenshot(path="search-overlay-empty.png")

        # Type a query
        page.locator('input[placeholder="Search sprints, tasks, agents..."]').first.fill("auth")
        page.wait_for_timeout(3000) # wait for debounce + fetch (if any)

        page.screenshot(path="search-overlay-results.png")

        browser.close()

if __name__ == "__main__":
    run()
