import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('useDockHoverMotion Architectural Constraints', () => {
    it('should assert useDockHoverMotion hook is not reintroduced', () => {
        // This test serves as a hard structural regression guard.
        // It validates the architectural decision to remove proximity-based gsap tweens
        // from dock items to avoid visual snapping bugs.

        const hooksDir = path.resolve(__dirname, '..');
        const files = fs.readdirSync(hooksDir);

        // Assert that the file strictly does not exist
        const hookFileExists = files.some(file =>
            file.toLowerCase().includes('usedockhovermotion')
        );

        expect(hookFileExists).toBe(false);
    });
});
