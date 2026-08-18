export type LaborLocation = {
  location: string;
  netSales: number;
  forecastSales: number;
  laborCost: number;
  scheduledLaborCost: number;
  targetLaborPct: number;
  workedHours: number;
  scheduledHours: number;
  overtimeHours: number;
  projectedOvertimeHours: number;
  avgHourlyCost: number;
};

export type LaborInsight = LaborLocation & {
  currentLaborPct: number;
  projectedLaborPct: number;
  salesVsForecastPct: number;
  splh: number;
  excessLaborCost: number;
  suggestedCutHours: number;
  projectedSavings: number;
  overtimeExposure: number;
  severity: 'Healthy' | 'Watch' | 'Action';
};

export const laborDemoLocations: LaborLocation[] = [
  { location: 'Stamford', netSales: 15452, forecastSales: 16000, laborCost: 2860, scheduledLaborCost: 3240, targetLaborPct: 21, workedHours: 171, scheduledHours: 196, overtimeHours: 1.8, projectedOvertimeHours: 4.2, avgHourlyCost: 18.5 },
  { location: 'Orange', netSales: 13410, forecastSales: 15400, laborCost: 2780, scheduledLaborCost: 3325, targetLaborPct: 21, workedHours: 165, scheduledHours: 202, overtimeHours: 2.1, projectedOvertimeHours: 6.5, avgHourlyCost: 18.9 },
  { location: 'Fairfield', netSales: 11780, forecastSales: 12100, laborCost: 2220, scheduledLaborCost: 2570, targetLaborPct: 21, workedHours: 139, scheduledHours: 161, overtimeHours: .8, projectedOvertimeHours: 2.2, avgHourlyCost: 18.1 },
  { location: 'Avon', netSales: 9320, forecastSales: 10100, laborCost: 2035, scheduledLaborCost: 2450, targetLaborPct: 22, workedHours: 128, scheduledHours: 155, overtimeHours: 3.5, projectedOvertimeHours: 7.4, avgHourlyCost: 18.7 },
  { location: 'Southington', netSales: 8810, forecastSales: 9100, laborCost: 1720, scheduledLaborCost: 1985, targetLaborPct: 22, workedHours: 111, scheduledHours: 128, overtimeHours: .6, projectedOvertimeHours: 1.7, avgHourlyCost: 18.0 },
  { location: 'Danbury', netSales: 7960, forecastSales: 9200, laborCost: 1840, scheduledLaborCost: 2300, targetLaborPct: 22, workedHours: 118, scheduledHours: 149, overtimeHours: 4.9, projectedOvertimeHours: 9.8, avgHourlyCost: 18.4 },
];

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

export function evaluateLabor(rows: LaborLocation[]): LaborInsight[] {
  return rows.map(row => {
    const currentLaborPct = row.netSales ? row.laborCost / row.netSales * 100 : 0;
    const projectedLaborPct = row.forecastSales ? row.scheduledLaborCost / row.forecastSales * 100 : 0;
    const salesVsForecastPct = row.forecastSales ? (row.netSales - row.forecastSales) / row.forecastSales * 100 : 0;
    const splh = row.workedHours ? row.netSales / row.workedHours : 0;
    const targetProjectedCost = row.forecastSales * row.targetLaborPct / 100;
    const excessLaborCost = Math.max(0, row.scheduledLaborCost - targetProjectedCost);
    const suggestedCutHours = row.avgHourlyCost ? excessLaborCost / row.avgHourlyCost : 0;
    const projectedSavings = suggestedCutHours * row.avgHourlyCost;
    const overtimeExposure = Math.max(0, row.projectedOvertimeHours) * row.avgHourlyCost * .5;
    const laborGap = projectedLaborPct - row.targetLaborPct;
    const severity: LaborInsight['severity'] = laborGap >= 3 || row.projectedOvertimeHours >= 8 ? 'Action' : laborGap >= 1 || row.projectedOvertimeHours >= 4 ? 'Watch' : 'Healthy';

    return {
      ...row,
      currentLaborPct: round1(currentLaborPct),
      projectedLaborPct: round1(projectedLaborPct),
      salesVsForecastPct: round1(salesVsForecastPct),
      splh: round2(splh),
      excessLaborCost: round2(excessLaborCost),
      suggestedCutHours: round1(suggestedCutHours),
      projectedSavings: round2(projectedSavings),
      overtimeExposure: round2(overtimeExposure),
      severity,
    };
  }).sort((a, b) => {
    const rank = { Action: 2, Watch: 1, Healthy: 0 };
    return rank[b.severity] - rank[a.severity] || b.projectedSavings - a.projectedSavings;
  });
}

export function laborSummary(rows: LaborInsight[]) {
  const sales = rows.reduce((sum, row) => sum + row.netSales, 0);
  const forecast = rows.reduce((sum, row) => sum + row.forecastSales, 0);
  const labor = rows.reduce((sum, row) => sum + row.laborCost, 0);
  const scheduledLabor = rows.reduce((sum, row) => sum + row.scheduledLaborCost, 0);
  const hours = rows.reduce((sum, row) => sum + row.workedHours, 0);
  const projectedSavings = rows.reduce((sum, row) => sum + row.projectedSavings, 0);
  const overtimeExposure = rows.reduce((sum, row) => sum + row.overtimeExposure, 0);
  return {
    sales,
    forecast,
    currentLaborPct: sales ? labor / sales * 100 : 0,
    projectedLaborPct: forecast ? scheduledLabor / forecast * 100 : 0,
    splh: hours ? sales / hours : 0,
    projectedSavings,
    overtimeExposure,
    actionCount: rows.filter(row => row.severity === 'Action').length,
    watchCount: rows.filter(row => row.severity === 'Watch').length,
  };
}
