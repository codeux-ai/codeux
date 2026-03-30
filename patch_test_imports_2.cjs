const fs = require('fs');

let file1 = 'tests/backend/services/dashboard-realtime-service.test.ts';
let code1 = fs.readFileSync(file1, 'utf8');
code1 = code1.replace('import { afterEach, describe, expect, it, vi } from "vitest";', 'import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";');
fs.writeFileSync(file1, code1);

let file2 = 'tests/backend/server/dashboard-realtime-websocket-server.test.ts';
let code2 = fs.readFileSync(file2, 'utf8');
code2 = code2.replace('import { describe, expect, it, vi } from "vitest";', 'import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";');
fs.writeFileSync(file2, code2);

console.log('patched imports 2');
