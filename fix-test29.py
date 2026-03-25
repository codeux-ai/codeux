import re

with open("tests/backend/services/quicksprint-server.test.ts", "r") as f:
    content = f.read()

content = content.replace('import { describe, it, expect, vi, beforeEach } from "vitest";', 'import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";')

with open("tests/backend/services/quicksprint-server.test.ts", "w") as f:
    f.write(content)
