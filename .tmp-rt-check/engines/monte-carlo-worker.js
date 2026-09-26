export { derivePathSeed, toCompactPathResult } from 'investment-lab-core';
const deviationDirectionCodes = {
    above_expected: 0,
    below_expected: 1
};
export const encodeTransportBatch = (paths = []) => {
    const normalizedPaths = Array.isArray(paths) ? paths : [];
    const annualEtfDeviationCode = [];
    for (const path of normalizedPaths) {
        const years = Array.isArray(path?.years) ? path.years : [];
        for (const year of years) {
            const etfReturns = Array.isArray(year?.etfReturns) ? year.etfReturns : [];
            for (const etfReturn of etfReturns) {
                annualEtfDeviationCode.push(deviationDirectionCodes[etfReturn?.deviationDirection ?? 'above_expected'] ?? 0);
            }
        }
    }
    const payloadBytes = new TextEncoder().encode(JSON.stringify(normalizedPaths));
    return {
        message: {
            arrays: {
                annualEtfDeviationCode: Uint32Array.from(annualEtfDeviationCode),
                payload: payloadBytes.buffer
            }
        },
        transferList: [payloadBytes.buffer],
        paths: undefined
    };
};
export const decodeTransportBatch = (transport) => {
    const arrays = transport?.message?.arrays ?? transport?.arrays ?? {};
    const payload = arrays.payload ?? transport?.payload;
    if (payload instanceof ArrayBuffer) {
        return JSON.parse(new TextDecoder().decode(new Uint8Array(payload)));
    }
    if (ArrayBuffer.isView(payload)) {
        return JSON.parse(new TextDecoder().decode(payload));
    }
    if (typeof payload === 'string') {
        return JSON.parse(payload);
    }
    if (Array.isArray(transport?.paths)) {
        return transport.paths;
    }
    if (Array.isArray(transport)) {
        return transport;
    }
    return [];
};
