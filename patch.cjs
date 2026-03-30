const fs = require('fs');
const content = fs.readFileSync('src/repositories/memory-repository.ts', 'utf8');

const replacement = `  private listMemories(
    filters: { projectId: string; sprintId?: string; agentPresetId?: string; scope?: string },
    limit: number,
    orderBy: "updated_at DESC" | "created_at DESC"
  ): MemoryRecord[] {
    let sql = "SELECT * FROM memories WHERE project_id = ?";
    const params: any[] = [filters.projectId];

    if (filters.scope) {
      sql += " AND scope = ?";
      params.push(filters.scope);
    }
    if (filters.sprintId) {
      sql += " AND sprint_id = ?";
      params.push(filters.sprintId);
    }
    if (filters.agentPresetId) {
      sql += " AND agent_preset_id = ?";
      params.push(filters.agentPresetId);
    }

    sql += \` ORDER BY \${orderBy} LIMIT ?\`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as unknown as MemoryRow[];
    return rows.map((row) => this.mapRow(row));
  }

  listByProject(projectId: string, scope?: MemoryScope, limit = 100): MemoryRecord[] {
    return this.listMemories({ projectId, scope }, limit, "updated_at DESC");
  }

  listBySprint(projectId: string, sprintId: string, limit = 200): MemoryRecord[] {
    return this.listMemories({ projectId, sprintId }, limit, "created_at DESC");
  }

  listByAgent(projectId: string, agentPresetId: string, limit = 100): MemoryRecord[] {
    return this.listMemories({ projectId, agentPresetId }, limit, "created_at DESC");
  }

  /** Short-term memories for a specific agent within a specific sprint. */
  listBySprintAndAgent(projectId: string, sprintId: string, agentPresetId: string, limit = 200): MemoryRecord[] {
    return this.listMemories({ projectId, sprintId, agentPresetId }, limit, "created_at DESC");
  }

  /** Long-term (project-scope) memories for a specific agent. */
  listLongTermByAgent(projectId: string, agentPresetId: string, limit = 200): MemoryRecord[] {
    return this.listMemories({ projectId, agentPresetId, scope: 'project' }, limit, "created_at DESC");
  }`;

const search = `  listByProject(projectId: string, scope?: MemoryScope, limit = 100): MemoryRecord[] {
    if (scope) {
      const rows = this.db.prepare(\`
        SELECT * FROM memories
        WHERE project_id = ? AND scope = ?
        ORDER BY updated_at DESC
        LIMIT ?
      \`).all(projectId, scope, limit) as unknown as MemoryRow[];
      return rows.map((row) => this.mapRow(row));
    }

    const rows = this.db.prepare(\`
      SELECT * FROM memories
      WHERE project_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    \`).all(projectId, limit) as unknown as MemoryRow[];
    return rows.map((row) => this.mapRow(row));
  }

  listBySprint(projectId: string, sprintId: string, limit = 200): MemoryRecord[] {
    const rows = this.db.prepare(\`
      SELECT * FROM memories
      WHERE project_id = ? AND sprint_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    \`).all(projectId, sprintId, limit) as unknown as MemoryRow[];
    return rows.map((row) => this.mapRow(row));
  }

  listByAgent(projectId: string, agentPresetId: string, limit = 100): MemoryRecord[] {
    const rows = this.db.prepare(\`
      SELECT * FROM memories
      WHERE project_id = ? AND agent_preset_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    \`).all(projectId, agentPresetId, limit) as unknown as MemoryRow[];
    return rows.map((row) => this.mapRow(row));
  }

  /** Short-term memories for a specific agent within a specific sprint. */
  listBySprintAndAgent(projectId: string, sprintId: string, agentPresetId: string, limit = 200): MemoryRecord[] {
    const rows = this.db.prepare(\`
      SELECT * FROM memories
      WHERE project_id = ? AND sprint_id = ? AND agent_preset_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    \`).all(projectId, sprintId, agentPresetId, limit) as unknown as MemoryRow[];
    return rows.map((row) => this.mapRow(row));
  }

  /** Long-term (project-scope) memories for a specific agent. */
  listLongTermByAgent(projectId: string, agentPresetId: string, limit = 200): MemoryRecord[] {
    const rows = this.db.prepare(\`
      SELECT * FROM memories
      WHERE project_id = ? AND scope = 'project' AND agent_preset_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    \`).all(projectId, agentPresetId, limit) as unknown as MemoryRow[];
    return rows.map((row) => this.mapRow(row));
  }`;

if (content.includes(search)) {
    fs.writeFileSync('src/repositories/memory-repository.ts', content.replace(search, replacement));
    console.log("Success");
} else {
    console.log("Not found");
}
