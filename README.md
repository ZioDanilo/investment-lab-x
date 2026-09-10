# Investment Lab X Web

Frontend Angular con interfaccia a tab ispirata all'Excel attuale.

## Tab visibili
- Control Panel
- Ribilanciamento

Gli altri moduli sono presenti come servizi/motori, ma non hanno tab visibili finché non diventano fogli operativi.

## Avvio in VS Code

```bash
npm install
npm start
```

Poi apri:

```text
http://localhost:4200
```

## Struttura
- `src/app/features/control-panel`
- `src/app/features/rebalance`
- `src/app/core/models`
- `src/app/core/services`
- `src/app/core/engines`

## Canonical rejection diagnostics fix

CHANGE_CLASSIFICATION = DIAGNOSTIC_UI_ONLY_FIX

Il fix canonico per la diagnostica di rejection V1.3 è un aggiornamento del wiring pubblico/output e non una modifica del motore Monte Carlo.

- `candidateVectors` è il numero totale di candidate vectors generati;
- `acceptedVectors` è il numero di vectors accettati;
- `rejectedVectors` è il numero di whole-vector rejection;
- `physicalFloorRejectedVectors` è il numero di rejection dovute al vincolo `R < -1`;
- in V1.3 vale:

  `candidateVectors = acceptedVectors + rejectedVectors`

  `rejectedVectors = physicalFloorRejectedVectors`

  `effectiveRangeRejectedVectors = 0`

- `physicalFloorRejectRate` è:

  `physicalFloorRejectedVectors / candidateVectors`

Il valore UI finale è ora canonico:

- `Total redraw = statistics.returnGeneration.totalRejectedVectors`
- `Reject rate = statistics.returnGeneration.physicalFloorRejectRate`

La UI usa quindi i valori pubblici canonici e non i vecchi `performanceDiagnostics.redrawCount` / `performanceDiagnostics.rejectRate`, che non erano la source of truth corretta. La semantica della simulazione resta invariata: non si modifica la generazione numerica, il RNG, la macro engine, le correlazioni, il physical-floor behavior, il portafoglio o le formule KPI.

RETURN_ENGINE_MATH_CHANGED = NO
RNG_CHANGED = NO
GENERAL_CHANGED = NO
MACRO_ENGINE_CHANGED = NO
CORRELATION_ENGINE_CHANGED = NO
PHYSICAL_FLOOR_BEHAVIOR_CHANGED = NO
PORTFOLIO_ENGINE_CHANGED = NO
KPI_FORMULAS_CHANGED = NO
V13_ENGINE_FREEZE_PRESERVED = YES

## Known Step9 issue (documented, not fixed here)

STEP9_FAILURE_CLASSIFICATION = COORDINATOR_BROWSER_ASSUMPTION

Il problema noto riguarda `MonteCarloCoordinator.startHeartbeat()`, che usa `window.setInterval` e `window.clearInterval` per il heartbeat del coordinatore. Il test Step9 eseguito tramite `npx tsx` gira sotto Node, dove `window` non esiste.

Questo problema:
- NON è causato dal canonical rejection fix;
- NON invalida il build Angular;
- NON invalida il motore Monte Carlo;
- NON va corretto in questo task.

TODO_STEP9_BROWSER_ASSUMPTION

## Legacy cleanup status

Legacy cleanup is deferred. In questo task non vengono rimossi:
- `performanceDiagnostics`
- `redrawCount`
- `rejectRate`
- legacy Step9 fixture
- temp JS artifacts

Il fix V1.3 è stato certificato come diagnostico/UI-only e la riduzione di eventuali campi legacy sarà trattata come task separato.
