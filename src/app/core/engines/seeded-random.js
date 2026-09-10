import { MACRO_SCENARIOS } from '../models/monte-carlo.model';
/**
 * Generatore pseudo-casuale con seed (algoritmo Mulberry32).
 * Garantisce riproducibilità esatta dato lo stesso seed.
 */
export class SeededRandom {
    state;
    constructor(seed) {
        this.state = seed !== undefined ? seed : (Math.random() * 2 ** 32) >>> 0;
    }
    /** Ritorna un float [0, 1) */
    next() {
        this.state |= 0;
        this.state = this.state + 0x6d2b79f5 | 0;
        let z = Math.imul(this.state ^ this.state >>> 15, 1 | this.state);
        z = z + Math.imul(z ^ z >>> 7, 61 | z) ^ z;
        return ((z ^ z >>> 14) >>> 0) / 4294967296;
    }
    /** Ritorna un intero inclusivo [min, max] */
    nextInt(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }
    /**
     * Sceglie uno scenario in base alle probabilità fornite.
     * @param probs Record<MacroScenario, number> — deve sommare a 1
     */
    weightedChoice(probs) {
        const r = this.next();
        let cumulative = 0;
        for (const scenario of MACRO_SCENARIOS) {
            cumulative += probs[scenario];
            if (r < cumulative) {
                return scenario;
            }
        }
        return MACRO_SCENARIOS[MACRO_SCENARIOS.length - 1];
    }
    /**
     * Campiona da una distribuzione Gamma(alpha, 1) usando
     * il metodo di Marsaglia-Tsang (algoritmo GD).
     * Usa esclusivamente this.next() — nessun Math.random().
     */
    gamma(alpha) {
        if (alpha < 1) {
            // Riduzione: Gamma(alpha) = Gamma(alpha+1) * U^(1/alpha)
            return this.gamma(alpha + 1) * Math.pow(this.next(), 1 / alpha);
        }
        const d = alpha - 1 / 3;
        const c = 1 / Math.sqrt(9 * d);
        while (true) {
            let x;
            let v;
            do {
                x = this.nextNormal();
                v = 1 + c * x;
            } while (v <= 0);
            v = v * v * v;
            const u = this.next();
            const xSq = x * x;
            if (u < 1 - 0.0331 * xSq * xSq)
                return d * v;
            if (Math.log(u) < 0.5 * xSq + d * (1 - v + Math.log(v)))
                return d * v;
        }
    }
    /**
     * Campiona una normale standard N(0,1) tramite il metodo di Box-Muller.
     * Usa esclusivamente this.next().
     */
    nextNormal() {
        const u1 = this.next();
        const u2 = this.next();
        return Math.sqrt(-2 * Math.log(u1 + 1e-300)) * Math.cos(2 * Math.PI * u2);
    }
    /**
     * Campiona dalla distribuzione Beta(alpha, betaParam) in [0, 1].
     * Usa due campioni Gamma: x / (x + y).
     */
    beta(alpha, betaParam) {
        const x = this.gamma(alpha);
        const y = this.gamma(betaParam);
        const total = x + y;
        if (total === 0)
            return 0.5;
        return x / total;
    }
}
