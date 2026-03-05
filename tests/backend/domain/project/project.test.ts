import { describe, it, expect } from "vitest";
import { Project } from "../../../../src/domain/project/project.js";
import { ProjectStatus } from "../../../../src/contracts/app-types.js";

describe("Project entity", () => {
  it("should create a new project with correct initial state", () => {
    const p = Project.create("src-1", "/my/dir", "My Proj");
    expect(p.id).toBeDefined();
    expect(p.sourceId).toBe("src-1");
    expect(p.normalizedBaseDir).toBe("/my/dir");
    expect(p.name).toBe("My Proj");
    expect(p.description).toBeNull();
    expect(p.status).toBe(ProjectStatus.ACTIVE);
    expect(p.createdAt).toBeDefined();
    expect(p.updatedAt).toBeDefined();
  });

  it("should create a new project with description", () => {
    const p = Project.create("src-1", "/my/dir", "My Proj", "A cool project");
    expect(p.description).toBe("A cool project");
  });

  it("should update project details and change updatedAt", async () => {
    const p = Project.create("src-1", "/my/dir", "My Proj");
    const oldUpdate = p.updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 10));
    p.update("New Name", "New Desc");

    expect(p.name).toBe("New Name");
    expect(p.description).toBe("New Desc");
    expect(p.updatedAt).not.toBe(oldUpdate);
  });

  it("should not change updatedAt if no updates applied", async () => {
    const p = Project.create("src-1", "/my/dir", "My Proj");
    const oldUpdate = p.updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 10));
    p.update("My Proj", undefined); // same name, no description change

    expect(p.name).toBe("My Proj");
    expect(p.updatedAt).toBe(oldUpdate);
  });

  it("should archive project", async () => {
    const p = Project.create("src-1", "/my/dir", "My Proj");
    const oldUpdate = p.updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 10));
    p.archive();

    expect(p.status).toBe(ProjectStatus.ARCHIVED);
    expect(p.updatedAt).not.toBe(oldUpdate);
  });
});
