# Wait, why did ui-components.test.tsx fail to find "Test"?
# `screen.getByRole("button", { name: "Test" })` failed.
# Because the `aria-live` span has:
# `isPending ? "Pending" : isSuccess ? "Success" : isError ? "Error" : ""`
# So the button's accessible name might become "Pending Test" instead of "Test"!
# The prompt: "The aria-live span that announces state changes must remain and must not be inside the animated container."
# Wait, it was already there? Let me check if the aria-live span was there before I added it.
import os

os.system("git diff dashboard/src/v2/components/ui/Button.tsx")
