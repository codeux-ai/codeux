const fs = require('fs');
const content = fs.readFileSync('dashboard/src/v2/ChatPage.tsx', 'utf8');

const newImports = `import { ChatIdentityAvatar } from "./components/chat/ChatIdentityAvatar.js";
import { ChatActivityWidget } from "./components/chat/ChatActivityWidget.js";
import { ChatSurfaceCard } from "./components/chat/ChatSurfaceCard.js";
import { ChatRouteBadge } from "./components/chat/ChatRouteBadge.js";
`;

const updated = content.replace(
  'import { subscribeToDashboardRealtime } from "../lib/realtime/dashboard-realtime-client.js";',
  'import { subscribeToDashboardRealtime } from "../lib/realtime/dashboard-realtime-client.js";\n' + newImports
);

fs.writeFileSync('dashboard/src/v2/ChatPage.tsx', updated);
