import re

with open("dashboard/src/v2/components/ui/Button.tsx", "r") as f:
    content = f.read()

# Add labelRef and spinnerRef
old_refs = '''  const buttonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const iconContainerRef = useRef<HTMLDivElement>(null);
  const fixedWidthRef = useRef<number | null>(null);'''

new_refs = '''  const buttonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const iconContainerRef = useRef<HTMLDivElement>(null);
  const fixedWidthRef = useRef<number | null>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const spinnerRef = useRef<HTMLDivElement>(null);'''

content = content.replace(old_refs, new_refs)

with open("dashboard/src/v2/components/ui/Button.tsx", "w") as f:
    f.write(content)
