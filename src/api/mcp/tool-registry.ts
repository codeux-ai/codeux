import { TOOL_DEFINITIONS, type ToolName } from "../../contracts/mcp-tool-definitions.js";

type ToolDefinition = (typeof TOOL_DEFINITIONS)[number];

type Expand<T> = T extends object ? { [K in keyof T]: T[K] } : T;

type SchemaProperties<TSchema> = TSchema extends { properties: infer TProperties extends Record<string, unknown> }
  ? TProperties
  : Record<never, never>;

type SchemaRequiredKeys<TSchema> = TSchema extends { required: readonly (infer TRequired extends string)[] }
  ? TRequired
  : never;

type SchemaPropertyValue<TProperty> = TProperty extends { enum: readonly (infer TEnumValue extends string)[] }
  ? TEnumValue
  : TProperty extends { type: "string" }
    ? string
    : TProperty extends { type: "number" }
      ? number
      : TProperty extends { type: "boolean" }
        ? boolean
        : never;

type RequiredPropertyKeys<TSchema> = Extract<keyof SchemaProperties<TSchema>, SchemaRequiredKeys<TSchema>>;
type OptionalPropertyKeys<TSchema> = Exclude<keyof SchemaProperties<TSchema>, RequiredPropertyKeys<TSchema>>;

type ToolArgsFromSchema<TSchema> = Expand<{
  [TProperty in RequiredPropertyKeys<TSchema>]-?: SchemaPropertyValue<SchemaProperties<TSchema>[TProperty]>;
} & {
  [TProperty in OptionalPropertyKeys<TSchema>]?: SchemaPropertyValue<SchemaProperties<TSchema>[TProperty]>;
}>;

export type McpToolArgsByName = {
  [TDefinition in ToolDefinition as TDefinition["name"]]: ToolArgsFromSchema<TDefinition["inputSchema"]>;
};

export type McpToolResponse = unknown;

export type McpToolHandler<TToolName extends ToolName> = (args: McpToolArgsByName[TToolName]) => Promise<McpToolResponse>;

export type McpToolHandlerMap = {
  [TToolName in ToolName]: McpToolHandler<TToolName>;
};

type RuntimeToolInputSchemaByName = {
  [TToolName in ToolName]: {
    properties: Record<string, { type: "string" | "number" | "boolean"; enum?: readonly string[] }>;
    required?: readonly string[];
  };
};

const TOOL_INPUT_SCHEMAS = Object.fromEntries(
  TOOL_DEFINITIONS.map((definition) => [definition.name, definition.inputSchema])
) as unknown as RuntimeToolInputSchemaByName;

const KNOWN_TOOL_NAMES = new Set<ToolName>(TOOL_DEFINITIONS.map((definition) => definition.name));

const isKnownToolName = (toolName: string): toolName is ToolName => KNOWN_TOOL_NAMES.has(toolName as ToolName);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertPropertyType = (
  toolName: ToolName,
  propertyName: string,
  propertySchema: { type: "string" | "number" | "boolean"; enum?: readonly string[] },
  value: unknown
): void => {
  switch (propertySchema.type) {
    case "string": {
      if (typeof value !== "string") {
        throw new Error(`Invalid arguments for ${toolName}: "${propertyName}" must be a string.`);
      }
      break;
    }
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        throw new Error(`Invalid arguments for ${toolName}: "${propertyName}" must be a number.`);
      }
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        throw new Error(`Invalid arguments for ${toolName}: "${propertyName}" must be a boolean.`);
      }
      break;
    }
  }

  if (Array.isArray(propertySchema.enum) && !propertySchema.enum.includes(value as string)) {
    throw new Error(
      `Invalid arguments for ${toolName}: "${propertyName}" must be one of: ${propertySchema.enum.join(", ")}.`
    );
  }
};

const validateToolArgs = <TToolName extends ToolName>(
  toolName: TToolName,
  rawArgs: unknown
): McpToolArgsByName[TToolName] => {
  const schema = TOOL_INPUT_SCHEMAS[toolName];
  const candidate = rawArgs === undefined ? {} : rawArgs;
  if (!isRecord(candidate)) {
    throw new Error(`Invalid arguments for ${toolName}: expected an object.`);
  }

  const validated: Record<string, unknown> = {};
  const requiredProperties = new Set(schema.required ?? []);

  for (const [propertyName, propertySchema] of Object.entries(schema.properties ?? {})) {
    const value = candidate[propertyName];
    if (value === undefined) {
      continue;
    }

    assertPropertyType(toolName, propertyName, propertySchema, value);
    validated[propertyName] = value;
    requiredProperties.delete(propertyName);
  }

  if (requiredProperties.size > 0) {
    throw new Error(
      `Invalid arguments for ${toolName}: missing required field(s): ${Array.from(requiredProperties).sort().join(", ")}.`
    );
  }

  return validated as McpToolArgsByName[TToolName];
};

export class McpToolRegistry {
  private readonly handlers = new Map<ToolName, (args: unknown) => Promise<McpToolResponse>>();

  register<TToolName extends ToolName>(toolName: TToolName, handler: McpToolHandler<TToolName>): this {
    this.handlers.set(toolName, handler as (args: unknown) => Promise<McpToolResponse>);
    return this;
  }

  registerMany(handlers: McpToolHandlerMap): this {
    for (const toolName of Object.keys(handlers) as ToolName[]) {
      this.handlers.set(toolName, handlers[toolName] as (args: unknown) => Promise<McpToolResponse>);
    }
    return this;
  }

  async dispatch(toolName: string, rawArgs: unknown): Promise<McpToolResponse> {
    if (!isKnownToolName(toolName)) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    const handler = this.handlers.get(toolName);
    if (!handler) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    const args = validateToolArgs(toolName, rawArgs);
    return await handler(args);
  }
}
