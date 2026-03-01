export type TemplateVariables = Record<string, unknown>;

const PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g;

const resolveVariable = (variables: TemplateVariables, key: string): string => {
  const segments = key.split(".");
  let current: unknown = variables;

  for (const segment of segments) {
    if (!current || typeof current !== "object") {
      return "";
    }
    current = (current as Record<string, unknown>)[segment];
  }

  if (Array.isArray(current)) {
    return current.map((entry) => String(entry)).join("\n");
  }

  if (current === null || current === undefined) {
    return "";
  }

  return String(current);
};

export const renderTemplate = (template: string, variables: TemplateVariables): string => {
  return template.replace(PLACEHOLDER_PATTERN, (_match, key: string) => resolveVariable(variables, key));
};
