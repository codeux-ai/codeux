import os
import re

directory = "dashboard/src/v2/components"

for root, _, files in os.walk(directory):
    for filename in files:
        if filename.endswith(".tsx") or filename.endswith(".ts"):
            filepath = os.path.join(root, filename)
            with open(filepath, 'r') as f:
                content = f.read()

            # Fix 1: The prose overrides
            content = re.sub(r'prose-a:focus-visible:outline-none', '', content)
            content = re.sub(r'prose-a:focus-visible:ring-2', '', content)
            content = re.sub(r'prose-a:focus-visible:ring-signal-500', '', content)
            content = re.sub(r'prose-a:focus-visible:rounded', '', content)
            content = re.sub(r'prose-a:focus-visible:ring-offset-1', '', content)
            content = re.sub(r'dark:prose-a:focus-visible:ring-offset-void-800', '', content)

            # Fix 2: All simple exact string matches for classes that need stripping (pad with \b carefully if needed, but since we are doing space cleanup later, exact match inside spaces or quotes works well if we replace with space)
            # To be safe, let's use a function to process only content within className="..." or className={`...`}

            def process_classes(m):
                cls_str = m.group(1)

                # Split the classes
                classes = cls_str.replace('\n', ' ').split(' ')
                new_classes = []
                for c in classes:
                    c = c.strip()
                    if not c:
                        continue

                    if c.startswith('focus-visible:ring-') or \
                       c == 'focus-visible:ring' or \
                       c == 'focus-visible:outline-none' or \
                       c.startswith('focus-visible:rounded') or \
                       c.startswith('focus-visible:ring-offset-') or \
                       c == 'focus:outline-none' or \
                       c == 'focus:ring-0' or \
                       c == 'ring-offset-0' or \
                       c.startswith('dark:focus-visible:ring-offset-') or \
                       c.startswith('dark:focus-visible:ring-'):
                        continue
                    new_classes.append(c)

                # Preserve the original structure if it's a template string with ${} logic?
                # Wait, splitting by space breaks ${foo ? 'a' : 'b'}
                return 'className="' + ' '.join(new_classes) + '"'

            # A much safer approach is regex replacement that allows whitespace/quote padding
            targets = [
                r'(?<=[\s"\'`])focus-visible:ring-[a-zA-Z0-9/-]+(?=[\s"\'`])',
                r'(?<=[\s"\'`])dark:focus-visible:ring-[a-zA-Z0-9/-]+(?=[\s"\'`])',
                r'(?<=[\s"\'`])focus-visible:ring(?=[\s"\'`])',
                r'(?<=[\s"\'`])focus-visible:outline-none(?=[\s"\'`])',
                r'(?<=[\s"\'`])focus-visible:rounded(?:-[a-zA-Z0-9/\[\]-]+)?(?=[\s"\'`])',
                r'(?<=[\s"\'`])focus:outline-none(?=[\s"\'`])',
                r'(?<=[\s"\'`])focus:ring-0(?=[\s"\'`])',
                r'(?<=[\s"\'`])ring-offset-0(?=[\s"\'`])',
            ]

            for target in targets:
                content = re.sub(target, '', content)

            # Cleanup double spaces (be careful not to ruin JSX indentation by only replacing inside strings)
            # Actually just replacing '  ' with ' ' inside className strings
            content = re.sub(r'className="([^"]+)"', lambda m: 'className="' + ' '.join(m.group(1).split()) + '"', content)
            # For template literals, it's safer to just replace double spaces with single space.
            content = re.sub(r'className=\{`([^`]+)`\}', lambda m: 'className={`' + ' '.join(m.group(1).split()) + '`}', content)

            with open(filepath, 'w') as f:
                f.write(content)

print("Done")
