const fs = require('fs');
const file = 'src/server/dashboard-realtime-websocket-server.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  '  lastPushedSequence: number | null;\n}',
  '  lastPushedSequence: number | null;\n  recoveryAttempts: number[];\n}'
);

code = code.replace(
  '      lastPushedSequence: null,\n    };\n    clients.set(socket, client);',
  '      lastPushedSequence: null,\n      recoveryAttempts: [],\n    };\n    clients.set(socket, client);'
);

const recoverySearch = `              if (missedNonReplayableSnapshot || (latestSequence !== null && replayLastSequence < latestSequence)) {
                sendJson(socket, {
                  type: "snapshot_required",
                  reason: missedNonReplayableSnapshot ? "non_replayable_event_missed" : "replay_window_exceeded",
                });
              } else {`;

const recoveryReplace = `              if (missedNonReplayableSnapshot || (latestSequence !== null && replayLastSequence < latestSequence)) {
                const reason = missedNonReplayableSnapshot ? "non_replayable_event_missed" : "replay_window_exceeded";
                args.logger.warn("websocket_recovery_snapshot_required", {
                  reason,
                  afterSequence,
                  latestSequence
                });

                const now = Date.now();
                client.recoveryAttempts.push(now);
                client.recoveryAttempts = client.recoveryAttempts.filter(t => now - t <= 60000);
                if (client.recoveryAttempts.length > 3) {
                  args.logger.warn("repeated_unhealthy_recovery_patterns", {
                    clientId: socket.remoteAddress || "unknown",
                    count: client.recoveryAttempts.length
                  });
                  client.recoveryAttempts = [];
                }

                sendJson(socket, {
                  type: "snapshot_required",
                  reason,
                });
              } else {`;

code = code.replace(recoverySearch, recoveryReplace);

const invalidSearch = `        } catch (error) {
          args.logger.warn("Invalid dashboard realtime websocket message", { error });
          sendJson(socket, {
            type: "snapshot_required",
            reason: "invalid_client_message",
          });
        }`;

const invalidReplace = `        } catch (error) {
          args.logger.warn("Invalid dashboard realtime websocket message", { error });
          const reason = "invalid_client_message";
          args.logger.warn("websocket_recovery_snapshot_required", { reason });

          const now = Date.now();
          client.recoveryAttempts.push(now);
          client.recoveryAttempts = client.recoveryAttempts.filter(t => now - t <= 60000);
          if (client.recoveryAttempts.length > 3) {
            args.logger.warn("repeated_unhealthy_recovery_patterns", {
              clientId: socket.remoteAddress || "unknown",
              count: client.recoveryAttempts.length
            });
            client.recoveryAttempts = [];
          }

          sendJson(socket, {
            type: "snapshot_required",
            reason,
          });
        }`;

code = code.replace(invalidSearch, invalidReplace);

fs.writeFileSync(file, code);
console.log('patched websocket');
