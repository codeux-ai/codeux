with open('dashboard/src/v2/components/chat/WorkingBubble.tsx', 'r') as f:
    content = f.read()

# Make sure WorkingBubble provides polite announcement if phase is starting/working
# It already does: <span aria-live="polite" role="status" className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
#           {displayName || "Listener"} is preparing a reply
#           <span className={`...`}>{phase === "starting" ? "Starting" : "Working"}</span>
#         </span>
