import fs from 'fs';
const content = fs.readFileSync('src/server/dashboard-server.ts', 'utf8');
const routes = Array.from(content.matchAll(/app\.(get|post|put|patch|delete)\("([^"]+)"/g));
console.log(routes.map(r => r[2]));
