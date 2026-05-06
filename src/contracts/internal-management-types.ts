export interface ManagementApproval {
  confirmed: boolean;
}

export interface ManagementRequestEnvelope {
  domain: string;
  action: string;
  payload: Record<string, unknown>;
  approval?: ManagementApproval;
}

export interface ManageCodeUxArgs extends ManagementRequestEnvelope {}

export interface ManagementResponseEnvelope {
  approvalRequired?: boolean;
  approvalMessage?: string;
  result?: unknown;
}
