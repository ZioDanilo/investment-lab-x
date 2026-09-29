# Shared UI components

Questa cartella è la libreria UI riutilizzabile di Investment Lab X.

Regola: prima di creare markup/CSS specifico in una feature, verificare se il componente esiste qui. Le feature devono comporre primitive shared; logica di dominio e orchestrazione restano nella feature.

## Primitive estratte

- `ui-card` — contenitore/card standard.
- `ui-button` — pulsante primario/secondario.
- `progress-button` — pulsante con riempimento progressivo, adatto alla simulazione.
- `percentage-slider` — slider percentuale con accent color e valore.
- `select-menu` — dropdown/select custom.
- `search-autocomplete` — campo ricerca con risultati.
- `value-badge` — valore/status compatto.
- `icon-title` — titolo con icona.
- `chart-legend` — legenda orizzontale/verticale.
- `line-chart` — primitive SVG per grafici a linee.
- `histogram-chart` — primitive SVG per istogrammi.
- `segmented-bar` — barra segmentata percentuale/scenari.
- `kpi-row` — singola riga KPI con target.

## Componenti shared già esistenti

- `montecarlo-portfolio-editor`
- `dialog-input`
- `toast`

### Principio di composizione

Non creare una nuova card completa se può essere costruita da `ui-card` + primitive interne. Non duplicare pulsanti, slider, dropdown, legende o grafici dentro le feature. Le varianti visuali devono essere Input/configurazioni del componente shared, non copie locali.

La pagina Monte Carlo rimane per ora il riferimento visivo canonico; le primitive qui estratte sono il punto di riuso per le prossime schermate e per la progressiva sostituzione del markup legacy.
