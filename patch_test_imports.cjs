const fs = require('fs');

let file1 = 'tests/backend/services/dashboard-realtime-service.test.ts';
let code1 = fs.readFileSync(file1, 'utf8');
code1 = code1.replace('import { describe, it, expect, vi } from "vitest";', 'import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";');
fs.writeFileSync(file1, code1);

console.log('patched imports');
