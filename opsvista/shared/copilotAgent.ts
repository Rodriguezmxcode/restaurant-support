export type CopilotDataset = 'performance' | 'ramp' | 'tasks' | 'actions' | 'provi' | 'reviews';
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
