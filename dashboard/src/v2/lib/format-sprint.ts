export function formatSprintTitle(sprint?: { name?: string; sprintNumber?: number | string | null; number?: number | string | null } | null, sprintKeyPrefix: string = "SPR"): string {
    if (!sprint) return "All Sprints";

    let num = sprint.sprintNumber || sprint.number;
    let name = sprint.name;

    // Attempt to extract sprint number if not provided
    if (!num && name) {
        const prefixEscaped = sprintKeyPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = name.match(new RegExp(`^${prefixEscaped}-(\\d+)`, 'i'));
        if (match) {
            num = match[1];
        }
    }

    if (num) {
        // Strip out existing prefix-<num> from the name to prevent duplication
        // It handles optional spaces and colons/hyphens
        const prefixEscaped = sprintKeyPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const prefixRegex = new RegExp(`^${prefixEscaped}-${num}\\s*[:\\-]?\\s*`, 'i');
        return name ? name.replace(prefixRegex, '') : `Sprint ${num}`;
    }

    return name || "Unnamed Sprint";
}

export function formatSprintDisplay(sprint?: { name?: string; sprintNumber?: number | string | null; number?: number | string | null } | null, sprintKeyPrefix: string = "SPR"): string {
    if (!sprint) return "All Sprints";

    let num = sprint.sprintNumber || sprint.number;
    const name = sprint.name;
    if (!num && name) {
        const prefixEscaped = sprintKeyPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = name.match(new RegExp(`^${prefixEscaped}-(\\d+)`, 'i'));
        if (match) {
            num = match[1];
        }
    }
    if (num) {
        return `${sprintKeyPrefix}-${num}: ${formatSprintTitle(sprint, sprintKeyPrefix)}`;
    }

    return formatSprintTitle(sprint, sprintKeyPrefix);
}
