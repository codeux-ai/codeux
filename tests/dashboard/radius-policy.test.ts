import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Helper to recursively find files since glob isn't available
function findFilesSync(dir: string, extPattern: RegExp, ignoreDirs: string[]): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      if (!ignoreDirs.includes(file)) {
        results = results.concat(findFilesSync(filePath, extPattern, ignoreDirs));
      }
    } else {
      if (extPattern.test(file)) {
        results.push(filePath);
      }
    }
  }
  return results;
}

describe('Dashboard UI Border Radius Policy', () => {
  it('should not contain any disallowed Tailwind radius classes or inline borderRadius', () => {
    // We only test source code, not the dist output.
    const dashboardSrcPath = path.resolve(__dirname, '../../dashboard/src');

    // Find all .ts and .tsx files in dashboard/src
    const files = findFilesSync(dashboardSrcPath, /\.(ts|tsx)$/, ['dist', 'node_modules']);

    const disallowedRegex = /(?:(?<=^|\s|["'`])(?:rounded-\[.*?\]|rounded-(?:2xl|3xl)|rounded-(?:tr|tl|br|bl|t|r|b|l)-(?:sm|md|lg|xl|2xl|3xl|full|none|\[.*?\]))(?=$|\s|["'`]))|(?:(?:[{,]\s*|["'`]\s*)borderRadius\s*:)/g;

    // Some exceptions allowed for complex UI animations where standard Tailwind is insufficient.
    const exceptions = [
      // SprintBubble needs an explicit 8-point continuous curve for its animation
      path.resolve(dashboardSrcPath, 'v2/components/ui/SprintBubble.tsx')
    ];

    const violations: string[] = [];

    for (const file of files) {
      if (exceptions.includes(file)) {
        continue;
      }

      const content = fs.readFileSync(file, 'utf8');

      // Look for disallowed classes
      const matches = content.match(disallowedRegex);

      if (matches) {
        // Double check lines to provide better context
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].match(disallowedRegex)) {
             violations.push(`File: ${file}:${i + 1}\n  Match: ${lines[i].trim()}`);
          }
        }
      }
    }

    if (violations.length > 0) {
      console.error('Border radius policy violations found:\n' + violations.join('\n\n'));
    }

    expect(violations).toHaveLength(0);
  });
});
