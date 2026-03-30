const { bootDashboardRealtimeWebSocketServer } = require('./src/server/dashboard-realtime-websocket-server.js');
const { EventEmitter } = require('events');

const serverMock = new EventEmitter();
const loggerMock = { warn: console.log, info: console.log, debug: console.log, error: console.log, child: () => loggerMock };
const realtimeServiceMock = {
  subscribe: () => () => {},
  getLatestSequenceForScopes: () => 1,
  getLatestSequence: () => 1,
};

bootDashboardRealtimeWebSocketServer({
  server: serverMock,
  pathName: "/ws",
  realtimeService: realtimeServiceMock,
  logger: loggerMock,
});

const socketMock = new EventEmitter();
socketMock.write = console.log;
socketMock.remoteAddress = "127.0.0.1";
socketMock.destroy = console.log;

const reqMock = {
  url: "/ws",
  headers: {
    upgrade: "websocket",
    connection: "upgrade",
    "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
  },
};

serverMock.emit("upgrade", reqMock, socketMock);

for (let i = 0; i < 4; i++) {
  const invalidPayload = Buffer.from("invalid-json");
  const length = invalidPayload.length;
  const header = Buffer.alloc(6);
  header[0] = 0x81;
  header[1] = length | 0x80;
  // mask
  header[2] = 0;
  header[3] = 0;
  header[4] = 0;
  header[5] = 0;
  const combined = Buffer.concat([header, invalidPayload]);
  socketMock.emit("data", combined);
}
