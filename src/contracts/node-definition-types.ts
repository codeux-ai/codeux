import type {
  NodeFlowExecutionPolicy,
  NodeFlowPort,
  NodeFlowSideEffect,
  NodeFlowValueSchema,
  NodeWidgetSchema,
} from "./node-flow-types.js";

export type NodeDefinitionExecutionKind = "local" | "provider" | "http" | "custom" | "unavailable";

export interface NodeDefinitionCredentialRequirement {
  slot: string;
  label: string;
  required: boolean;
  allowedKinds: string[];
}

export interface NodeDefinitionUiManifest {
  label: string;
  description: string;
  category: string;
  icon?: string;
  widgetSchema: NodeWidgetSchema;
}

export interface NodeDefinitionDeprecation {
  deprecated: boolean;
  message?: string;
  replacementType?: string;
}

export interface NodeDefinitionManifest {
  type: string;
  version: number;
  executable: boolean;
  executionKind: NodeDefinitionExecutionKind;
  configurationSchema: NodeFlowValueSchema;
  ui: NodeDefinitionUiManifest;
  ports: NodeFlowPort[];
  credentials: NodeDefinitionCredentialRequirement[];
  capabilities: string[];
  sideEffect: NodeFlowSideEffect;
  defaultPolicy: NodeFlowExecutionPolicy;
  documentation: string;
  deprecation: NodeDefinitionDeprecation;
}
