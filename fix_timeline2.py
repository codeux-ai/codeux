import re

with open("tests/dashboard/live/live-task-card-actions.test.tsx", "r") as f:
    content = f.read()

# Let's inspect the gsap mock in live-task-card-actions.test.tsx
if "timeline:" not in content:
    content = content.replace('fromTo: vi.fn(),', 'fromTo: vi.fn(), timeline: vi.fn(() => ({ to: vi.fn().mockReturnThis() })),')

with open("tests/dashboard/live/live-task-card-actions.test.tsx", "w") as f:
    f.write(content)
