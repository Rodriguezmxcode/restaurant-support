export type CopilotDataset = 'performance' | 'ramp' | 'tasks' | 'actions' | 'provi' | 'reviews' | 'invoices';
export type CopilotSource = {
  id: string;
  dataset: CopilotDataset;
  label: string;
  start: string;
  end: string;
  locations: string[];
  retrievedAt: string;
  note: string;
  available: boolean;
};
export type CopilotAgentAnswer = { answer: string; sources: CopilotSource[] };
export type CopilotIssueCode = 'openai_credit' | 'openai_project_spend' | 'openai_organization_spend' | 'openai_usage' | 'openai_quota' | 'openai_rate' | 'openai_auth' | 'openai_configuration' | 'openai_unavailable' | 'openai_rejected' | 'opsvista_limit';
