export function formatSprintDisplay(sprint?: { name?: string; sprintNumber?: number | string | null; number?: number | string | null } | null): string {
    if (!sprint) return "All Sprints";

    let num = sprint.sprintNumber || sprint.number;
    let name = sprint.name;

    // Attempt to extract sprint number if not provided
    if (!num && name) {
        const match = name.match(/^SPR-(\d+)/i);
        if (match) {
            num = match[1];
        }
    }

    if (num) {
        // Strip out existing SPR-<num> prefix from the name to prevent duplication
        // It handles optional spaces and colons/hyphens
        const prefixRegex = new RegExp(`^SPR-${num}\\s*[:\\-]?\\s*`, 'i');
        const cleanName = name ? name.replace(prefixRegex, '') : `Sprint ${num}`;
        return `SPR-${num}: ${cleanName}`;
    }

    return name || "Unnamed Sprint";
}
