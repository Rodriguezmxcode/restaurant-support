export type LaborCostSource = 'toast_reported' | 'time_entry_estimate' | 'mixed' | 'unavailable';
export type LaborReportStatus = 'ready' | 'not_configured' | 'pending' | 'unavailable' | 'mismatch';
export function combineLaborCostSources(sources:LaborCostSource[]):LaborCostSource{
  const unique=new Set(sources);
  return unique.size===0?'time_entry_estimate':unique.size===1?sources[0]:'mixed';
}
