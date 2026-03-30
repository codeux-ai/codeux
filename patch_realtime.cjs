const fs = require('fs');
const file = 'src/services/dashboard-realtime-service.ts';
let code = fs.readFileSync(file, 'utf8');

const projectLiveSearch = `        const snapshot = await Promise.resolve(loaders.getProjectLiveSnapshot(projectId));
        this.publishRawEvent({
          scopeType: "project",
          scopeId: projectId,
          eventType: "project.live.updated",
          entityType: "project_live",
          entityId: projectId,
          projectId,
          sprintId: snapshot.selectedSprintId,
          payload: snapshot,
          replayable: false,
        });
        this.projectLivePublishedAt.set(projectId, now);`;

const projectLiveReplace = `        const snapshot = await Promise.resolve(loaders.getProjectLiveSnapshot(projectId));
        const payloadSizeBytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
        this.publishRawEvent({
          scopeType: "project",
          scopeId: projectId,
          eventType: "project.live.updated",
          entityType: "project_live",
          entityId: projectId,
          projectId,
          sprintId: snapshot.selectedSprintId,
          payload: snapshot,
          replayable: false,
        });
        this.logger.info("realtime_snapshot_published", {
          type: "project.live.updated",
          sizeBytes: payloadSizeBytes,
          projectId,
          publishFrequencyMs: lastPublishedAt > 0 ? now - lastPublishedAt : 0
        });
        this.projectLivePublishedAt.set(projectId, now);`;

code = code.replace(projectLiveSearch, projectLiveReplace);


const projectsSearch = `          this.publishRawEvent({
            scopeType: "projects",
            scopeId: "projects",
            eventType: "projects.updated",
            entityType: "project_collection",
            entityId: "projects",
            payload: projects,
            replayable: false,
          });
          this.projectsPublishedAt = now;`;

const projectsReplace = `          this.publishRawEvent({
            scopeType: "projects",
            scopeId: "projects",
            eventType: "projects.updated",
            entityType: "project_collection",
            entityId: "projects",
            payload: projects,
            replayable: false,
          });
          this.logger.info("realtime_background_refresh", { type: "projects" });
          this.projectsPublishedAt = now;`;

code = code.replace(projectsSearch, projectsReplace);


const overviewSearch = `          this.publishRawEvent({
            scopeType: "overview",
            scopeId: "overview",
            eventType: "overview.telemetry.updated",
            entityType: "overview",
            entityId: "overview",
            payload: telemetry,
            replayable: false,
          });
          this.overviewPublishedAt = now;`;

const overviewReplace = `          this.publishRawEvent({
            scopeType: "overview",
            scopeId: "overview",
            eventType: "overview.telemetry.updated",
            entityType: "overview",
            entityId: "overview",
            payload: telemetry,
            replayable: false,
          });
          this.logger.info("realtime_background_refresh", { type: "overview" });
          this.overviewPublishedAt = now;`;

code = code.replace(overviewSearch, overviewReplace);

fs.writeFileSync(file, code);
console.log('patched realtime');
