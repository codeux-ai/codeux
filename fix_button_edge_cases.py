import re

with open("dashboard/src/v2/components/ui/Button.tsx", "r") as f:
    content = f.read()

# 1. Fix pointer-events: none when isPending
# In the `overrideClasses`, I can append `pointer-events-none` when `isPending`.
new_override_classes = """  let overrideClasses = "";
  if (isSuccess) overrideClasses = "!bg-status-green !text-white !border-status-green ring-2 ring-status-green ring-offset-2 ring-offset-white dark:ring-offset-void-900";
  else if (isError) overrideClasses = "!bg-status-red !text-white !border-transparent";
  if (isPending) overrideClasses += " pointer-events-none";"""

content = re.sub(
    r'let overrideClasses = "";\s+if \(isSuccess\) overrideClasses = "!bg-status-green !text-white !border-status-green ring-2 ring-status-green ring-offset-2 ring-offset-white dark:ring-offset-void-900";\s+else if \(isError\) overrideClasses = "!bg-status-red !text-white !border-transparent";',
    new_override_classes,
    content
)

# 2. Fix initial mount state.
# We can do this by setting initial style in the JSX itself depending on the state, or via useLayoutEffect.
# I'll modify the JSX to have the correct initial opacity and scale based on `isPending`.
# `<span ref={labelRef} className="flex items-center justify-center gap-2">{children}</span>` -> `<span ref={labelRef} className="flex items-center justify-center gap-2" style={{ opacity: isPending ? 0 : 1 }}>{children}</span>`
# `<div ref={spinnerRef} className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0">` -> `<div ref={spinnerRef} className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ opacity: isPending ? 1 : 0, transform: isPending ? "scale(1)" : "scale(0.7)" }}>`

content = content.replace(
    '<span ref={labelRef} className="flex items-center justify-center gap-2">{children}</span>',
    '<span ref={labelRef} className="flex items-center justify-center gap-2" style={{ opacity: isPending ? 0 : 1 }}>{children}</span>'
)

content = content.replace(
    '<div ref={spinnerRef} className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0">',
    '<div ref={spinnerRef} className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ opacity: isPending ? 1 : 0, transform: isPending ? "scale(1)" : "scale(0.7)" }}>'
)

with open("dashboard/src/v2/components/ui/Button.tsx", "w") as f:
    f.write(content)
