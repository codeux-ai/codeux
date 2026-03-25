import re

# dashboard-server tests failed because port 1 is privileged. Let's use port 0 for OS to pick. Wait, port 0 caused loop in start port. Let's just mock setupDashboardServer instead of starting it or use a high port number.
with open("tests/backend/services/quicksprint-server.test.ts", "r") as f:
    content = f.read()

content = content.replace("port: 0,", "port: 45000 + Math.floor(Math.random() * 10000),")

with open("tests/backend/services/quicksprint-server.test.ts", "w") as f:
    f.write(content)
