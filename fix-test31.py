import re

# dashboard-server quicksprint route coverage was failing with port in use.
# Since it uses supertest on express `app` and doesn't actually need to open an http port with `server.listen()`,
# we can just mock bindDashboardServer to NOT listen.

with open("src/server/dashboard-server.ts", "r") as f:
    content = f.read()

# Make it simply return a mock server if it fails or we can inject a mock. Let's just patch test file.
