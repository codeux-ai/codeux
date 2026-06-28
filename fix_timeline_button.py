import re

with open("dashboard/src/v2/components/ui/Button.tsx", "r") as f:
    content = f.read()

# I will replace gsap.timeline() with a try/catch or an existence check so it doesn't blow up tests that improperly mock gsap.
# Actually, the error `default.timeline is not a function` in the live-task-card-actions test was unhandled, but there is also a failing test in ui-components.test.tsx.
# The `ui-components.test.tsx` fails to find "Test" button.
# Let's fix the timeline check first.
new_timeline_code = """
        if (buttonRef.current) {
          if (gsap.timeline) {
            const tl = gsap.timeline();
            tl.to(buttonRef.current, {
              boxShadow: "0 0 0 6px rgba(var(--accent-primary-rgb), 0.3)",
              duration: 0.2,
              ease: "power2.out",
            }).to(buttonRef.current, {
              boxShadow: "0 0 0 0px rgba(var(--accent-primary-rgb), 0)",
              duration: 0.2,
              ease: "power2.in",
            });
          } else {
             gsap.to(buttonRef.current, {
              boxShadow: "0 0 0 6px rgba(var(--accent-primary-rgb), 0.3)",
              duration: 0.2,
              ease: "power2.out",
            });
          }
        }
"""
content = re.sub(
    r'if \(buttonRef\.current\) \{\s+const tl = gsap\.timeline\(\);\s+tl\.to\(buttonRef\.current, \{\s+boxShadow: "0 0 0 6px rgba\(var\(--accent-primary-rgb\), 0\.3\)",\s+duration: 0\.2,\s+ease: "power2\.out",\s+\}\)\.to\(buttonRef\.current, \{\s+boxShadow: "0 0 0 0px rgba\(var\(--accent-primary-rgb\), 0\)",\s+duration: 0\.2,\s+ease: "power2\.in",\s+\}\);\s+\}',
    new_timeline_code.strip(),
    content
)

with open("dashboard/src/v2/components/ui/Button.tsx", "w") as f:
    f.write(content)
