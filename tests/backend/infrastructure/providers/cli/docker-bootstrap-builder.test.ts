import { describe, it, expect } from "vitest";
import { DockerBootstrapBuilder } from "../../../../../src/infrastructure/providers/cli/docker-bootstrap-builder.js";
import { CONTAINER_SETUP_SCRIPT } from "../../../../../src/services/cli-workflow-utils.js";

describe("DockerBootstrapBuilder", () => {
  const builder = new DockerBootstrapBuilder();

  it("should build a complete script with default options", () => {
    const options = {
      runtimeNpmPrefix: "/runtime/npm-global",
      runtimeNpmCache: "/runtime/npm-cache",
    };

    const script = builder.build(options);

    expect(script).toMatchSnapshot();
  });

  it("should include fallback install cases for specified providers", () => {
    const options = {
      runtimeNpmPrefix: "/runtime/npm-global",
      runtimeNpmCache: "/runtime/npm-cache",
      fallbackProviders: ["gemini"],
    };

    const script = builder.build(options);

    expect(script).toMatchSnapshot();
  });

  it("should handle claude specific auth", () => {
    const options = {
      runtimeNpmPrefix: "/runtime/npm-global",
      runtimeNpmCache: "/runtime/npm-cache",
    };

    const script = builder.build(options);

    expect(script).toContain("if [ \"$1\" = \"claude\" ]; then");
    expect(script).toMatchSnapshot();
  });

  it("should not include fallback install if no providers specified", () => {
    const options = {
      runtimeNpmPrefix: "/runtime/npm-global",
      runtimeNpmCache: "/runtime/npm-cache",
      fallbackProviders: [],
    };

    const script = builder.build(options);
    expect(script).toMatchSnapshot();
  });
});
