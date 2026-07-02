**Project Status**

- **Repository:** portfolio-simulator (workspace root)
- **Date:** 2026-07-02

**Overview**

- Frontend Angular standalone app for portfolio simulation and KPI management.
- Main areas: Portafoglio, KPI, Correlazioni, Montecarlo, Backtesting, Nuovo ETF, Impostazioni.

**What's done (recent & important)**

- Separated components into `*.component.ts`, `*.component.html`, `*.component.css` for major pages.
- Restored and cleaned corrupted TS files for: `app`, `kpi`, `portfolio`, `correlations`, `montecarlo`, `backtesting`, `new-etf`, `settings`.
- KPI page:
  - Externalized template and styles.
  - Fixed target input binding so fields become editable after KPI selection.
  - Validation softened during typing; strict validation and formatting applied on blur.
  - Added KPI summary cards and improved disabled-row visuals.
- Portfolio page:
  - Reworked weight input to allow free typing (comma or point), keep focus during editing, and commit on blur or Enter.
  - Values displayed with two decimals when not editing.
  - Implemented clamping and formatting on commit (0.00–100.00).
  - Added editing buffer to avoid immediate recalculation while typing.

**Files changed (high level)**

- `src/app/app.component.ts` / `app.component.html` / `app.component.css` — shell and navigation.
- `src/app/features/kpi/kpi-page.component.{ts,html,css}` — logic, template, styles; editability fixes & summary UI.
- `src/app/features/portfolio/portfolio-page.component.{ts,html,css}` — editing buffer, commit-on-blur, two-decimal display.
- `src/app/features/*` — other feature pages moved to external templates/styles and placeholders normalized.
- `src/app/core/services/portfolio-state.service.ts` — state mutation APIs used by UI remain as single responsibility methods (e.g. `updateEtfWeight`).

**Build / Test**

- `npm run build` (Angular) completes successfully in current workspace after changes.

**Known issues / notes**

- Some earlier automated rewrites left inline template residues; those were removed.
- Portafoglio snapping-on-mouse behavior was implemented earlier but later replaced by a buffer approach that commits on blur; if you want the original snap-on-drag behavior reintroduced, it can be added back.
- No unit tests were added; consider adding small component tests for KPI and portfolio behaviors.

**Next suggested tasks**

- Add Enter/Escape behaviours (commit/cancel) visual affordance in the weight input.
- Add small unit tests for `KpiPageComponent` and `PortfolioPageComponent`.
- Add an icon/status indicator for KPI target validity in the KPI table.
- Consider persisting state (localStorage) for draft editing buffer if needed.

**How to run locally**

```bash
npm install
npm run build
npm start
```

**Contact / Notes**

- If you want the file split differently (README, ROADMAP), tell me and I will split it.
