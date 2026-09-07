# Configurazione Monte Carlo su Database

## Tabelle di Configurazione

### 1. `structural_probabilities`
Memorizza le probabilità di distribuzione iniziale degli scenari macroeconomici (anno 1 della simulazione).

```sql
CREATE TABLE structural_probabilities (
  id INT PRIMARY KEY AUTO_INCREMENT,
  scenario VARCHAR(50) NOT NULL UNIQUE,
  -- scenario: 'expansion', 'recession', 'stagflation', 'soft_landing'
  probability DECIMAL(10, 6) NOT NULL,
  -- Probabilità come valore 0..1 (es. 0.55 = 55%)
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**Dati di Default:**
| scenario | probability | description |
|----------|-------------|-------------|
| expansion | 0.55 | Espansione economica |
| recession | 0.15 | Recessione |
| stagflation | 0.10 | Stagflazione |
| soft_landing | 0.20 | Soft Landing |

---

### 2. `transition_matrix`
Memorizza la matrice di transizione tra gli scenari macroeconomici (anni 2-50 della simulazione).

```sql
CREATE TABLE transition_matrix (
  id INT PRIMARY KEY AUTO_INCREMENT,
  from_scenario VARCHAR(50) NOT NULL,
  -- Da quale scenario si parte
  to_scenario VARCHAR(50) NOT NULL,
  -- A quale scenario si transisce
  probability DECIMAL(10, 6) NOT NULL,
  -- Probabilità condizionale della transizione (0..1)
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_transition (from_scenario, to_scenario)
);
```

**Dati di Default:**

Ogni riga rappresenta P(to_scenario | from_scenario). Le probabilità per ogni `from_scenario` devono sommare a 1.

```
FROM expansion:
  → expansion:    0.60
  → recession:    0.10
  → stagflation:  0.10
  → soft_landing: 0.20
  (totale: 1.00)

FROM recession:
  → expansion:    0.25
  → recession:    0.20
  → stagflation:  0.05
  → soft_landing: 0.50
  (totale: 1.00)

FROM stagflation:
  → expansion:    0.20
  → recession:    0.20
  → stagflation:  0.30
  → soft_landing: 0.30
  (totale: 1.00)

FROM soft_landing:
  → expansion:    0.40
  → recession:    0.20
  → stagflation:  0.10
  → soft_landing: 0.30
  (totale: 1.00)
```

---

## Algoritmo (post-modifica)

### Anno 1
Scegli uno scenario secondo le probabilità strutturali:
```
P(scenario_1) = structural_probabilities[scenario]
```

### Anni 2-50
Scegli lo scenario dell'anno successivo in base alla transizione dell'anno corrente:
```
P(scenario_y | scenario_{y-1}) = transition_matrix[scenario_{y-1}][scenario_y]
```

Non più blend 50/50. La matrice di transizione è utilizzata al 100%.

---

## API di Lettura (Backend)

### Endpoint: `GET /api/monte-carlo/config`

Risposta JSON:
```json
{
  "structuralProbabilities": {
    "expansion": 0.55,
    "recession": 0.15,
    "stagflation": 0.10,
    "soft_landing": 0.20
  },
  "transitionMatrix": {
    "expansion": {
      "expansion": 0.60,
      "recession": 0.10,
      "stagflation": 0.10,
      "soft_landing": 0.20
    },
    "recession": {
      "expansion": 0.25,
      "recession": 0.20,
      "stagflation": 0.05,
      "soft_landing": 0.50
    },
    "stagflation": {
      "expansion": 0.20,
      "recession": 0.20,
      "stagflation": 0.30,
      "soft_landing": 0.30
    },
    "soft_landing": {
      "expansion": 0.40,
      "recession": 0.20,
      "stagflation": 0.10,
      "soft_landing": 0.30
    }
  }
}
```

---

## Integrazione Angular (Futuro)

Nel `MonteCarloStateService`, aggiungere:

```typescript
private apiService = inject(ApiService);

loadMCConfig(): void {
  this.apiService.getMonteCarloConfig().subscribe(config => {
    this.structuralProbabilities.set(config.structuralProbabilities);
    this.transitionMatrix.set(config.transitionMatrix);
  });
}
```

Attualmente i valori sono hardcoded come costanti `DEFAULT_STRUCTURAL_PROBABILITIES` e `DEFAULT_TRANSITION_MATRIX` in `monte-carlo.model.ts`.

---

## Note

1. **Validazione:** La somma delle probabilità per ogni riga della transition_matrix deve essere esattamente 1 (con tolleranza 0.001 per errori di arrotondamento).
2. **Immutabilità:** Dopo la prima simulazione, se cambiate i valori nel database, le prossime simulazioni useranno i nuovi valori.
3. **Seed:** Fissando lo stesso seed e usando gli stessi parametri del database, le simulazioni sono perfettamente riproducibili.
