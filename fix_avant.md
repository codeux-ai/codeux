Wait, why did the review say I completely ignored `AvantgardeSelect.tsx` and its test file?
Ah, the issue says: "Normalize control-state styling and semantics so each primitive has explicit and visually distinct hover, focus-visible, pressed, disabled, and loading/pending feedback without layout jitter."
Is there layout jitter in `AvantgardeSelect`?
Let's look at `triggerClass` in `AvantgardeSelect`. Wait, I did `grep -n -C 5 "hover:" dashboard/src/v2/components/ui/AvantgardeSelect.tsx` and it doesn't have `active:scale`. Wait, it might have layout jitter on the list items? No.
What about "Ensure tooltip/popover and collapsible interactions support keyboard parity"? This applied to tooltip/popover/collapsible.
What applied to AvantgardeSelect? "Fix inconsistent control-state behavior in shared UI primitives so buttons, toggles, selects, and helper popovers communicate state changes clearly and consistently across pointer and keyboard interaction."
Does `AvantgardeSelect` trigger button clearly communicate state changes?
It has `focus-visible:ring-2 focus-visible:ring-signal-500/20`. Is that consistent with `Button.tsx`? `Button` has `focus-visible:ring-2 focus-visible:ring-signal-500`. The select has `focus-visible:ring-signal-500/20` (too faint?).
Also, it lacks `active:scale` or `pressed` state? "explicit and visually distinct hover, focus-visible, pressed, disabled..."
Ah! Select doesn't have a "pressed" state! The prompt said "explicit and visually distinct hover, focus-visible, pressed, disabled, and loading/pending feedback without layout jitter."
We need to add `motion-safe:active:scale-95` to the trigger!
Let's see: `triggerClass` ... `active:scale` is missing!
And `focus-visible:ring-signal-500` instead of `focus-visible:ring-signal-500/20`!

Let's modify `AvantgardeSelect.tsx` `triggerClass` to include `motion-safe:active:scale-95`.
Wait, there are three variants.
Default:
`cursor-pointer border-black/[0.06] bg-white/52 text-slate-800 shadow-[...] hover:border-black/[0.12] focus-visible:ring-signal-500 motion-safe:active:scale-95`
Card:
`cursor-pointer text-signal-600 hover:border-black/[0.1] focus-visible:ring-signal-500 motion-safe:active:scale-95`
Compact:
`cursor-pointer text-signal-600 hover:text-signal-500 focus-visible:ring-signal-500 motion-safe:active:scale-[0.98]`
