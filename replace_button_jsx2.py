import re

with open("dashboard/src/v2/components/ui/Button.tsx", "r") as f:
    content = f.read()

# Wait, if there is no Icon, the success/error icons won't show!
# In the original, the condition was `(Icon || isPending || isSuccess || isError)`.
# Let me fix the condition so `iconContainerRef` is always rendered when there is an Icon, success, or error. Wait, success and error icons were in `iconContainerRef` before. Now the instructions say:
# "reverse the cross-fade to show the success icon"
# It implies the cross-fade is between the label and spinner, and when success happens, the label comes back.
# If the label comes back, where does the success icon appear? Either it's inside the original icon container, OR it is inside the shared container with the spinner.
# Wait. If I look closely at the instructions:
# "When `state` transitions to `pending`, use gsap... simultaneously with gsap.fromTo(spinnerEl, ...)"
# "When `state` transitions to `success`, reverse the cross-fade to show the success icon"
# Reversing the cross-fade of the label/spinner means label comes back (opacity: 1), spinner hides (opacity: 0).
# But if it says "reverse the cross-fade to show the success icon", does it mean the success icon is cross-faded in?
# No, "reverse the cross-fade [which brings back the label]; THEN use GSAP to animate the button's boxShadow..."
# Wait, "reverse the cross-fade to show the success icon" - perhaps the success icon is part of the button and its visibility was controlled by the original transition logic (which depends on isSuccess), and by bringing the label back, we let the original logic show the success icon?
# Actually, the original logic for the success icon was:
# `<div data-active={isSuccess} className={\`absolute inset-0 flex items-center justify-center transition-all duration-300 ${isSuccess ? "scale-100 opacity-100" : "scale-0 opacity-0 pointer-events-none"}\`}> <Check className="w-4 h-4" /> </div>`
# And this was in the `iconContainerRef`.
# So I should restore `(Icon || isSuccess || isError)` condition for the `iconContainerRef`.
# What about `isPending`? We moved the spinner out of `iconContainerRef` to `spinnerRef`. So we don't need `isPending` in `iconContainerRef`.

new_jsx = """      <span aria-live="polite" className="sr-only">
        {isPending ? "Pending" : isSuccess ? "Success" : isError ? "Error" : ""}
      </span>
      <div ref={contentRef} className={`flex items-center justify-center gap-2`}>
        {(Icon || isSuccess || isError) && (
          <div ref={iconContainerRef} className="relative flex items-center justify-center w-4 h-4 shrink-0">
            <div data-active={!isPending && !isSuccess && !isError} className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${isPending || isSuccess || isError ? "scale-0 opacity-0 pointer-events-none" : "scale-100 opacity-100"}`}>
              {Icon && <Icon className="w-4 h-4" aria-hidden="true" />}
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

# Replace in content
old_jsx2 = """      <span aria-live="polite" className="sr-only">
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

if old_jsx2 in content:
    content = content.replace(old_jsx2, new_jsx)

with open("dashboard/src/v2/components/ui/Button.tsx", "w") as f:
    f.write(content)
