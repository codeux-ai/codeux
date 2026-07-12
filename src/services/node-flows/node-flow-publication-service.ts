import { EntityNotFoundError } from "../../repositories/repository-utils.js";
import type { NodeFlowRepository } from "../../repositories/node-flow-repository.js";
import type { NodeFlowPublicationRecord } from "../../contracts/node-flow-types.js";
import type { NodeFlowVersionSelection } from "../../contracts/node-flow-execution-policy-types.js";

export class NodeFlowPublicationService {
  constructor(private readonly repository: NodeFlowRepository) {}

  resolve(flowId: string, selection: NodeFlowVersionSelection): NodeFlowPublicationRecord {
    const publication = selection.mode === "pinned"
      ? this.repository.getPublication(flowId, selection.version)
      : this.repository.getPublication(flowId);
    if (!publication) {
      const suffix = selection.mode === "pinned" ? ` at version ${selection.version}` : "";
      throw new EntityNotFoundError(`Published node flow not found: ${flowId}${suffix}`);
    }
    return publication;
  }
}
