# Decimal Conversion Fix - 2026-07-11

## Problem
Validator was detecting percentage values instead of decimals:
```
⚠️ IE00B8FHGS14 expectedReturn=8.1 looks like percentage? Should be ≤3 or ≥-1
⚠️ IE00B8FHGS14 volatility=11.8 seems too high (>2)
⚠️ IE00B8FHGS14 returnRange.min=-8 is below -100%
```

## Root Cause
Database stores values as percentages (8.1 for 8.1%), but they were being sent to frontend without conversion. Result: Engine received 8.1 instead of 0.081, causing massive returns.

## Solution: Two-Layer Conversion

### Layer 1: Backend (portafoglioController.js)
**When sending data to frontend**, convert from percentage to decimal:
```javascript
const formatScenario = (prefix) => ({
  expectedReturn: parseFloat(ms[`${prefix}_expected_return`]) / 100,  // 8.1 → 0.081
  volatility: parseFloat(ms[`${prefix}_volatility`]) / 100,          // 11.8 → 0.118
  maxDrawdown: parseFloat(ms[`${prefix}_max_drawdown`]) / 100,        // -18 → -0.18
  returnRange: {
    min: parseFloat(ms[`${prefix}_return_range_min`]) / 100,         // -8 → -0.08
    max: parseFloat(ms[`${prefix}_return_range_max`]) / 100          // 21 → 0.21
  }
});
```

### Layer 2: Frontend (portfolio-state.service.ts)
**When receiving data**, use directly (already converted by backend):
```typescript
// BEFORE (WRONG - double conversion):
weight: (holding.weight || 0) / 100,  // Backend sent 100 → divide → 1.0 ✗
macroStatistics: holding.macroStatistics  // Backend sent 0.081 → use as is ✗

// AFTER (CORRECT):
weight: holding.weight || 0,  // Backend sent 0.60 → use as is ✓
macroStatistics: holding.macroStatistics  // Backend sent 0.081 → use as is ✓
```

## Files Modified

1. **investment-lab-service/src/controllers/portafoglioController.js**
   - Updated `formatMacroStatistics()` to divide all values by 100
   - Updated holdings mapping to divide weight by 100

2. **src/app/core/services/portfolio-state.service.ts**
   - Removed `/100` from weight field
   - Added comment explaining backend already converts

## Verification

### Warnings Should Now Be Gone
After this fix, running simulation should show NO warnings about percentages vs decimals.

### Expected Behavior
- `expectedReturn: 0.081` (not 8.1)
- `volatility: 0.118` (not 11.8)
- `weight: 0.25` (25% portfolio) (not 25)
- `returnRange: { min: -0.08, max: 0.21 }` (not -8, 21)

### Test Command
```typescript
// In browser console:
MonteCarloCalibration.runAll();

// Should show:
// ✅ Single ETF test: PASSED
// ✅ Two ETF test: PASSED
// ✅ Correlation test: PASSED
// ✅ ALL TESTS PASSED
```

## Internal Decimal Convention (Unchanged)

**ALL calculations use decimals:**
- 8% → 0.08 (internally)
- 18% → 0.18 (internally)
- -35% → -0.35 (internally)

**UI converts to percentages for display:**
- 0.08 × 100 = 8% (shown)
- 0.18 × 100 = 18% (shown)
- -0.35 × 100 = -35% (shown)

## Build Status
✅ **Build successful**: 429.65 kB
✅ **No TypeScript errors**
✅ **Ready for testing**
