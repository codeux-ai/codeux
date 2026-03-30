const fs = require('fs');
const file = 'tests/backend/server/dashboard-realtime-websocket-server.test.ts';
let code = fs.readFileSync(file, 'utf8');

const search = `    // Simulate invalid frames which force snapshot_required and count as recovery attempts
    for (let i = 0; i < 4; i++) {
      const invalidPayload = Buffer.from("invalid-json");
      const length = invalidPayload.length;
      const header = Buffer.alloc(2);
      header[0] = 0x81;
      header[1] = length;
      const combined = Buffer.concat([header, invalidPayload]);
      socketMock.emit("data", combined);
    }`;

const replace = `    // Simulate invalid frames which force snapshot_required and count as recovery attempts
    for (let i = 0; i < 4; i++) {
      const invalidPayload = Buffer.from("invalid-json");
      const length = invalidPayload.length;
      const header = Buffer.alloc(6);
      header[0] = 0x81;
      header[1] = length | 0x80;
      header[2] = 0;
      header[3] = 0;
      header[4] = 0;
      header[5] = 0;
      const combined = Buffer.concat([header, invalidPayload]);
      socketMock.emit("data", combined);
    }`;

code = code.replace(search, replace);
fs.writeFileSync(file, code);
