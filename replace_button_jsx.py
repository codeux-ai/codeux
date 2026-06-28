import re

with open("dashboard/src/v2/components/ui/Button.tsx", "r") as f:
    content = f.read()

# I will replace the internal structure of the button
old_jsx = """      <div ref={contentRef} className={`flex items-center justify-center gap-2`}>
        {(Icon || isPending || isSuccess || isError) && (
          <div ref={iconContainerRef} className="relative flex items-center justify-center w-4 h-4 shrink-0">
            <div data-active={!isPending && !isSuccess && !isError} className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${isPending || isSuccess || isError ? "scale-0 opacity-0 pointer-events-none" : "scale-100 opacity-100"}`}>
              {Icon && <Icon className="w-4 h-4" aria-hidden="true" />}
            </div>

            <div key={`pending-${feedback.status}`} data-active={isPending} className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${isPending ? "scale-100 opacity-100" : "scale-0 opacity-0 pointer-events-none"}`}>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            </div>

            <div key={`success-${feedback.status}`} data-active={isSuccess} className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${isSuccess ? "scale-100 opacity-100" : "scale-0 opacity-0 pointer-events-none"}`}>
              <Check className="w-4 h-4" strokeWidth={3} aria-hidden="true" />
            </div>

            <div key={`error-${feedback.status}`} data-active={isError} className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${isError ? "scale-100 opacity-100" : "scale-0 opacity-0 pointer-events-none"}`}>
              <X className="w-4 h-4" strokeWidth={3} aria-hidden="true" />
            </div>
          </div>
        )}
        {children}
      </div>"""

new_jsx = """      <span aria-live="polite" className="sr-only">
        {isPending ? "Pending" : isSuccess ? "Success" : isError ? "Error" : ""}
      </span>
      <div ref={contentRef} className={`flex items-center justify-center gap-2`}>
        {Icon && (
          <div ref={iconContainerRef} className="relative flex items-center justify-center w-4 h-4 shrink-0">
            <div data-active={!isPending && !isSuccess && !isError} className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${isPending || isSuccess || isError ? "scale-0 opacity-0 pointer-events-none" : "scale-100 opacity-100"}`}>
              <Icon className="w-4 h-4" aria-hidden="true" />
            </div>
            <div key={`success-${feedback.status}`} data-active={isSuccess} className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${isSuccess ? "scale-100 opacity-100" : "scale-0 opacity-0 pointer-events-none"}`}>
              <Check className="w-4 h-4" strokeWidth={3} aria-hidden="true" />
            </div>
            <div key={`error-${feedback.status}`} data-active={isError} className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${isError ? "scale-100 opacity-100" : "scale-0 opacity-0 pointer-events-none"}`}>
              <X className="w-4 h-4" strokeWidth={3} aria-hidden="true" />
            </div>
          </div>
        )}
        <div className="relative flex items-center justify-center">
          <span ref={labelRef} className="flex items-center justify-center gap-2">{children}</span>
          <div ref={spinnerRef} className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          </div>
        </div>
      </div>"""

# Let me check if there's any aria-live span in Button.tsx before replacing, just to be sure.
if old_jsx in content:
    content = content.replace(old_jsx, new_jsx)
else:
    print("Could not find the exact JSX to replace")

with open("dashboard/src/v2/components/ui/Button.tsx", "w") as f:
    f.write(content)
