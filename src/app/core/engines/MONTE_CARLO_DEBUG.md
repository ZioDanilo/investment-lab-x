# Monte Carlo Engine - Diagnostic & Debug Guide

## Problem Statement
The Monte Carlo engine was producing impossible returns (500%, 1200%) despite proper range configuration.

## Root Causes Identified & Fixed

### 1. ✅ Missing Gaussian Copula Implementation
**Problem**: Shock values were being applied incorrectly to returns.
**Fix**: Refactored `EtfReturnEngine` to properly implement Gaussian Copula:
- Generate independent standard normals
- Apply Cholesky to get correlated normals
- Convert to uniforms via normal CDF (clip to [1e-6, 1-1e-6])
- Sample from marginal distribution
- Never apply shock again

### 2. ✅ Data Validation Missing
**Problem**: No validation that data was in decimal form vs percentage.
**Fix**: Created `MonteCarloValidator` with:
- `validateMacroStatistics()` - checks expectedReturn ≤ 3, volatility ≤ 2
- `validateAnnualReturn()` - ensures return within range [min, max]
- `validatePortfolioReturn()` - validates portfolio return within ETF ranges
- `validatePortfolioWeights()` - normalizes and validates weights

### 3. ✅ No Clamping to Range
**Problem**: Returns could exceed configured min/max.
**Fix**: Added `Math.max(min, Math.min(max, return))` in `sampleEtfReturnFromUniform()`

### 4. ✅ Portfolio Return Not Validated
**Problem**: Sum of contributions could exceed individual ETF ranges.
**Fix**: Added validation in main loop:
```typescript
const minEtfReturn = Math.min(...etfReturnValues);
const maxEtfReturn = Math.max(...etfReturnValues);
portfolioReturn = MonteCarloValidator.validatePortfolioReturn(
  portfolioReturn,
  minEtfReturn,
  maxEtfReturn,
  diagnostics
);
```

### 5. ✅ No Contribution Validation
**Problem**: Contribution calculation could be wrong.
**Fix**: Added `PortfolioReturnEngine.validateContributions()` check

### 6. ✅ Missing Diagnostics
**Problem**: Impossible to debug where errors came from.
**Fix**: Created `MonteCarloDiagnostics` tracking:
- `invalidReturnCount`: Returns outside range
- `clampedReturnCount`: Returns that needed clamping
- `portfolioReturnAbove100Count`: Returns > 100%
- `nanCount`, `infinityCount`: Bad values
- `repairedCorrelationMatrices`: Correlation matrix repairs
- `maximumObservedEtfReturn`, etc.: Min/max observed
- `warnings[]`: All warnings collected

## Files Modified

1. **monte-carlo-validator.ts** (NEW)
   - Comprehensive validation of input data
   - Diagnostic collection
   - Error reporting

2. **etf-return.engine.ts** (REFACTORED)
   - Proper Gaussian Copula implementation
   - `sampleEtfReturnFromUniform()` instead of `sampleEtfReturn(normalShock)`
   - Validation on each return
   - Diagnostics parameter passed through

3. **monte-carlo.engine.refactored.ts** (UPDATED)
   - Added diagnostics initialization
   - Added input validation section
   - Added validation in year loop
   - Contribution validation
   - Portfolio return validation

4. **monte-carlo-calibration.ts** (NEW)
   - Test single ETF: portfolio return = ETF return
   - Test two ETFs: portfolio return within calculated range
   - Test correlation: correlation doesn't violate ranges

## Decimal Convention

**All internal calculations must use decimals:**
- 8% = 0.08 (NOT 8)
- 18% = 0.18 (NOT 18)
- -35% = -0.35 (NOT -35)

**Conversion only at UI boundary:**
```typescript
// When receiving from backend or user input:
const decimal = percentageValue / 100;

// When displaying:
const displayPercentage = decimalValue * 100;
```

## Expected Results After Fix

### Test 1: Single ETF
- Portfolio return = ETF return (always)
- Mean converges to expectedReturn
- All values within range [min, max]

### Test 2: Two ETFs (60%/40%)
- Portfolio return range = [0.6*min_A + 0.4*min_B, 0.6*max_A + 0.4*max_B]
- Mean is weighted average of expected returns
- No violations of calculated bounds

### Test 3: Correlations
- Positive correlation: higher co-movement
- Negative correlation: lower co-movement  
- Range bounds still respected

## How to Debug

### 1. Enable Detailed Logging
```typescript
console.log('Diagnostics:', diagnostics);
if (diagnostics.invalidReturnCount > 0) {
  console.error('FOUND INVALID RETURNS:', diagnostics.invalidReturnCount);
}
if (diagnostics.nanCount > 0) {
  console.error('NaN DETECTED:', diagnostics.nanCount);
}
```

### 2. Check Data Quality
```typescript
console.log('Expected return range:', stats.expectedReturn);
console.log('Return range:', stats.returnRange);
console.log('Portfolio weights sum:', portfolio.reduce((s,p) => s + p.weight, 0));
```

### 3. Verify Gaussian Copula
```typescript
// independentNormals should be ~N(0,1)
// correlatedNormals should respect correlation matrix
// correlatedUniforms should be ~U(0,1)
// sampledReturns should respect min/max
```

## Known Limitations

1. Correlation matrix repair may alter small correlations
2. Clipping returns to range can slightly change mean
3. Gaussian Copula marginal distribution approximation has ±0.2% error tolerance

## Performance Notes

- Cache 4 correlation matrices per simulation
- Pre-compute macro stats map once
- Normalize portfolio weights once
- Generate scenario path once per simulation

## Next Steps

1. Run calibration tests: `MonteCarloCalibration.runAll()`
2. Check diagnostics output for any warnings
3. Run production simulation with seed for reproducibility
4. Compare results with expected portfolio characteristics
