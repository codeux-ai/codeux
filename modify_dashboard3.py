import sys

filepath = 'tests/backend/server/dashboard-project-api.test.ts'

with open(filepath, 'r') as f:
    content = f.read()

# I see what the issue is.
# The server is created by `createServerHandle()`. Let's look at `createServerHandle()` function.
# Wait, `createServerHandle` might be mapping `options.listTasks` without `activeSprintsOnly`?
