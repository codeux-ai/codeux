import re

with open("dashboard/src/v2/components/ui/Button.tsx", "r") as f:
    content = f.read()

# Replace the imports to include GSAP_DURATIONS and GSAP_EASINGS
old_import = 'import { useGsapDurations, GSAP_EASINGS, GSAP_INTERACTION_TOKENS, useGsapInteractionTokens } from "../../lib/motion/constants.js";'
new_import = 'import { useGsapDurations, GSAP_DURATIONS, GSAP_EASINGS, GSAP_INTERACTION_TOKENS, useGsapInteractionTokens } from "../../lib/motion/constants.js";'

content = content.replace(old_import, new_import)

with open("dashboard/src/v2/components/ui/Button.tsx", "w") as f:
    f.write(content)
