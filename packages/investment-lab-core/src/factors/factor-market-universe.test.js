import { buildFactorCorrelationMatrix, generateMonthlyEtfReturnsFromFactors } from './factor-market-universe.js';

const snapshot = {
  factorOrder: ['a','b'],
  factors: [
    { id:'a', statistics:{ general:{expectedReturn:0.06,volatility:0.12}, expansion:{expectedReturn:0.09,volatility:0.14} } },
    { id:'b', statistics:{ general:{expectedReturn:0.02,volatility:0.05}, expansion:{expectedReturn:0.03,volatility:0.06} } }
  ],
  correlations:{ expansion:{ 'a:b':0.25 } },
  etfs:[{
    id:'e1', isin:'TEST', ready:true,
    exposures:[{factorId:'a',beta:0.8},{factorId:'b',beta:0.2}],
    specificRisk:{ residualVolatility:0, alpha:0 }
  }]
};

describe('factor market universe', () => {
  test('builds a dynamic correlation matrix', () => {
    expect(buildFactorCorrelationMatrix(snapshot,'expansion')).toEqual([[1,0.25],[0.25,1]]);
  });
  test('is deterministic for the same random stream', () => {
    const makeRandom = () => { let x=1; return () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646; };
    const a=generateMonthlyEtfReturnsFromFactors(snapshot,'expansion',0.5,makeRandom());
    const b=generateMonthlyEtfReturnsFromFactors(snapshot,'expansion',0.5,makeRandom());
    expect(a).toEqual(b);
    expect(a.etfReturns).toHaveLength(1);
  });
});
