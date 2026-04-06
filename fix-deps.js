const fs = require('fs');

const depsInterfaceRegex = /export interface DashboardServerOptions \{[\s\S]*?\}/g;
let dashboardServerContent = fs.readFileSync('src/server/dashboard-server.ts', 'utf8');

// The route needs these standalone functions. Oh wait, DashboardDependencies is Omit<DashboardServerOptions, "app" | "dashboardDir" | "port" | "liveActivityCacheMs">.
// Let's check what properties DashboardDependencies actually has.
