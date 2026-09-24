export interface DemoHistogramBin {
  label: string;
  value: number;
}

export interface DemoLineSeries {
  id: string;
  values: number[];
}

export interface DemoTargetProbability {
  label: string;
  value: number;
}

export interface DemoScenarioSegment {
  label: string;
  percent: number;
  color: string;
}

export const demoFinalReturnDistribution = {
  label: 'Distribuzione dei rendimenti finali',
  subtitle: 'Distribuzione simulata a 30 anni',
  p5: -21,
  median: 6.8,
  p95: 16.4,
  bins: [
    { label: '-50%', value: 4 },
    { label: '-40%', value: 9 },
    { label: '-30%', value: 16 },
    { label: '-20%', value: 28 },
    { label: '-10%', value: 43 },
    { label: '0%', value: 58 },
    { label: '10%', value: 74 },
    { label: '20%', value: 68 },
    { label: '30%', value: 44 },
    { label: '40%', value: 25 },
    { label: '50%', value: 11 },
    { label: '60%', value: 5 }
  ] as DemoHistogramBin[]
};

export const demoPortfolioTrajectories: DemoLineSeries[] = [
  { id: 'sim-1', values: [0, 2.5, 5.4, 8.7, 12.4, 16.6, 20.3, 24.2, 29.4, 35.1, 41.2, 48.6, 55.2, 62.1, 69.0, 76.5, 83.8, 91.5, 98.7, 105.8, 111.6, 118.4, 124.1, 130.2, 136.8, 143.5, 149.6, 155.7, 161.8, 167.0] },
  { id: 'sim-2', values: [0, 2.2, 4.8, 7.9, 10.9, 14.1, 18.3, 22.7, 26.4, 30.9, 35.4, 40.2, 45.7, 50.6, 56.8, 61.7, 68.2, 74.4, 80.6, 87.4, 93.9, 100.5, 106.8, 113.0, 119.6, 125.9, 131.3, 138.4, 145.1, 152.3] },
  { id: 'sim-3', values: [0, 1.9, 4.1, 6.6, 9.2, 12.3, 15.1, 17.9, 21.8, 25.1, 29.8, 34.6, 38.4, 42.7, 47.9, 53.3, 59.5, 64.8, 71.2, 77.9, 84.5, 91.8, 98.7, 106.2, 112.9, 119.0, 126.4, 133.0, 140.9, 147.6] },
  { id: 'sim-4', values: [0, 2.7, 5.8, 9.4, 14.2, 18.3, 22.6, 27.8, 33.2, 38.9, 45.4, 52.2, 58.9, 65.1, 71.7, 79.3, 87.6, 94.9, 102.4, 110.8, 118.6, 126.8, 134.5, 143.1, 150.8, 158.9, 166.8, 175.4, 182.9, 190.4] },
  { id: 'sim-5', values: [0, 2.0, 4.5, 7.2, 10.6, 13.4, 17.9, 22.1, 26.8, 31.4, 36.3, 41.9, 47.0, 52.8, 58.4, 64.7, 70.8, 76.0, 83.2, 89.7, 96.6, 103.8, 110.3, 117.4, 124.7, 132.2, 138.4, 145.2, 151.4, 159.2] },
  { id: 'sim-6', values: [0, 1.3, 3.0, 5.6, 8.4, 11.9, 15.8, 19.0, 22.7, 26.0, 29.8, 33.6, 38.2, 42.5, 46.6, 51.1, 56.4, 61.3, 67.4, 73.3, 79.6, 86.1, 92.7, 99.5, 106.0, 112.9, 119.6, 126.8, 134.0, 141.5] },
  { id: 'sim-7', values: [0, 2.9, 6.3, 10.5, 15.1, 19.6, 24.4, 29.7, 34.8, 41.0, 47.4, 54.6, 61.7, 69.3, 77.5, 85.2, 93.8, 101.7, 110.6, 119.0, 127.4, 135.8, 144.4, 153.0, 161.8, 170.3, 179.0, 188.1, 196.5, 205.8] },
  { id: 'median', values: [0, 1.8, 3.9, 6.4, 9.0, 12.0, 15.2, 18.5, 22.0, 25.5, 29.9, 34.1, 38.7, 43.6, 49.2, 54.8, 60.4, 66.0, 72.4, 78.8, 85.5, 92.2, 99.1, 106.6, 113.5, 121.0, 127.9, 134.8, 141.3, 148.5] }
];

export const demoTargetProbabilities: DemoTargetProbability[] = [
  { label: '≥ +100%', value: 42 },
  { label: '≥ +50%', value: 68 },
  { label: '≥ 0%', value: 87 },
  { label: '≤ -20%', value: 12 },
  { label: '≤ -50%', value: 3 }
];

export const demoMaxDrawdownDistribution = {
  median: -22.3,
  bins: [
    { label: '-80%', value: 3 },
    { label: '-70%', value: 8 },
    { label: '-60%', value: 15 },
    { label: '-50%', value: 28 },
    { label: '-40%', value: 42 },
    { label: '-30%', value: 62 },
    { label: '-20%', value: 72 },
    { label: '-10%', value: 54 },
    { label: '0%', value: 28 }
  ] as DemoHistogramBin[]
};

export const demoMacroScenarioDistribution: DemoScenarioSegment[] = [
  { label: 'Espansione', percent: 38, color: '#4DE3C6' },
  { label: 'Soft Landing', percent: 31, color: '#5DA7FF' },
  { label: 'Recessione', percent: 18, color: '#FF6B7F' },
  { label: 'Stagflazione', percent: 13, color: '#FFB454' }
];
