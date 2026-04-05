
import { AppDbStorage } from './src/server/db/app-db-storage.ts';
import { randomUUID } from 'crypto';

const db = new AppDbStorage('.sprint-os/data.db');
db.init();
const id = randomUUID();
db.db.prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)').run(id, 'Test Project', '/app');
console.log(id);
