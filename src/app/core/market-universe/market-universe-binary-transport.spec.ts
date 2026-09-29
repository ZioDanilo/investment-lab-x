import { MarketUniverseBinaryTransport } from './market-universe-binary-transport';

const buildFullPayload = () => {
  const runId = 'run-full-123';
  const pathCount = 2;
  const monthCount = 3;
  const returnCount = pathCount * monthCount;
  const returns = new Float64Array([0.01, -0.02, 0.03, 0.04, 0.05, -0.06]);
  const intensities = new Float64Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
  const scenarios = new Uint8Array([0, 1, 2, 3, 0, 1]);

  const runIdBytes = new TextEncoder().encode(runId);
  const buffer = new ArrayBuffer(32 + runIdBytes.length + returnCount * 8 + returnCount * 8 + returnCount);
  const view = new DataView(buffer);
  const magic = new TextEncoder().encode('MU64');
  for (let i = 0; i < magic.length; i += 1) {
    new Uint8Array(buffer)[i] = magic[i];
  }
  view.setUint16(4, 1, true);
  view.setUint8(6, 1);
  view.setUint32(8, runIdBytes.length, true);
  view.setUint32(12, pathCount, true);
  view.setUint32(16, monthCount, true);
  view.setUint32(20, returnCount, true);
  view.setUint32(24, returnCount, true);
  view.setUint32(28, returnCount, true);

  const bytes = new Uint8Array(buffer);
  bytes.set(runIdBytes, 32);

  const returnsOffset = 32 + runIdBytes.length;
  for (let index = 0; index < returnCount; index += 1) {
    view.setFloat64(returnsOffset + index * 8, returns[index], true);
  }

  const intensitiesOffset = returnsOffset + returnCount * 8;
  for (let index = 0; index < returnCount; index += 1) {
    view.setFloat64(intensitiesOffset + index * 8, intensities[index], true);
  }

  const scenarioOffset = intensitiesOffset + returnCount * 8;
  bytes.set(scenarios, scenarioOffset);

  return buffer;
};

const buildReturnsOnlyPayload = () => {
  const runId = 'run-returns-456';
  const pathCount = 2;
  const monthCount = 3;
  const returnCount = pathCount * monthCount;
  const returns = new Float64Array([0.11, -0.12, 0.13, 0.14, -0.15, 0.16]);
  const runIdBytes = new TextEncoder().encode(runId);
  const buffer = new ArrayBuffer(32 + runIdBytes.length + returnCount * 8);
  const view = new DataView(buffer);
  const magic = new TextEncoder().encode('MU64');
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < magic.length; i += 1) {
    bytes[i] = magic[i];
  }
  view.setUint16(4, 1, true);
  view.setUint8(6, 2);
  view.setUint32(8, runIdBytes.length, true);
  view.setUint32(12, pathCount, true);
  view.setUint32(16, monthCount, true);
  view.setUint32(20, returnCount, true);
  view.setUint32(24, 0, true);
  view.setUint32(28, 0, true);
  bytes.set(runIdBytes, 32);

  const returnsOffset = 32 + runIdBytes.length;
  for (let index = 0; index < returnCount; index += 1) {
    view.setFloat64(returnsOffset + index * 8, returns[index], true);
  }

  return buffer;
};

describe('MarketUniverseBinaryTransport', () => {
  it('decodes FULL payloads', () => {
    const buffer = buildFullPayload();
    const decoded = MarketUniverseBinaryTransport.decode(buffer);

    expect(decoded.payloadType).toBe('FULL');
    expect(decoded.version).toBe(1);
    expect(decoded.runId).toBe('run-full-123');
    expect(decoded.pathCount).toBe(2);
    expect(decoded.monthCount).toBe(3);
    expect(decoded.returnCount).toBe(6);
    expect(Array.from(decoded.returns)).toEqual([0.01, -0.02, 0.03, 0.04, 0.05, -0.06]);
    expect(Array.from(decoded.intensities ?? [])).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    expect(Array.from(decoded.scenarios ?? [])).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('decodes RETURNS_ONLY payloads', () => {
    const buffer = buildReturnsOnlyPayload();
    const decoded = MarketUniverseBinaryTransport.decode(buffer);

    expect(decoded.payloadType).toBe('RETURNS_ONLY');
    expect(decoded.version).toBe(1);
    expect(decoded.runId).toBe('run-returns-456');
    expect(decoded.pathCount).toBe(2);
    expect(decoded.monthCount).toBe(3);
    expect(decoded.returnCount).toBe(6);
    expect(Array.from(decoded.returns)).toEqual([0.11, -0.12, 0.13, 0.14, -0.15, 0.16]);
    expect(decoded.intensities).toBeNull();
    expect(decoded.scenarios).toBeNull();
  });

  it('rejects malformed payloads', () => {
    const badMagic = new Uint8Array(32);
    badMagic.set(new TextEncoder().encode('NOPE'), 0);
    expect(() => MarketUniverseBinaryTransport.decode(badMagic.buffer)).toThrow();

    const badVersion = buildFullPayload();
    const view = new DataView(badVersion);
    view.setUint16(4, 9, true);
    expect(() => MarketUniverseBinaryTransport.decode(badVersion)).toThrow();

    const badTruncated = buildFullPayload().slice(0, 10);
    expect(() => MarketUniverseBinaryTransport.decode(badTruncated)).toThrow();

    const badGeometry = buildFullPayload();
    const bView = new DataView(badGeometry);
    bView.setUint32(12, 0, true);
    expect(() => MarketUniverseBinaryTransport.decode(badGeometry)).toThrow();

    const invalidScenario = buildFullPayload();
    const runId = 'run-full-123';
    const runIdBytes = new TextEncoder().encode(runId);
    const returnCount = 6;
    const scenarioOffset = 32 + runIdBytes.length + returnCount * 8 + returnCount * 8;
    const sBytes = new Uint8Array(invalidScenario);
    sBytes[scenarioOffset + 2] = 42;
    expect(() => MarketUniverseBinaryTransport.decode(invalidScenario)).toThrow();
  });
});
