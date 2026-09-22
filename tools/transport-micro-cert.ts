import assert from 'node:assert/strict';

const { encodeTransportBatch, decodeTransportBatch } = require('../src/app/core/engines/monte-carlo-worker') as typeof import('../src/app/core/engines/monte-carlo-worker');
const { processAddBatchMessage, aggregationState } = require('../src/app/core/engines/monte-carlo-aggregation-handler') as typeof import('../src/app/core/engines/monte-carlo-aggregation-handler');

type Scenario = 'expansion' | 'recession' | 'stagflation' | 'soft_landing';
type DeviationDirection = 'above_expected' | 'below_expected' | 'neutral';

type SyntheticPath = {
  simulationId: number;
  dominantEtfIsin: string;
  dominantEtfName: string;
  initialCapital: number;
  finalCapital: number;
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  monthly: Array<{ month: number; year: number; endingCapital: number; capital: number; portfolioReturn: number; runningPeak: number; drawdown: number; intensity: number; }>;
  years: Array<{ year: number; scenario: Scenario; durationInCurrentScenario: number; etfReturns: Array<{ isin: string; name: string; weight: number; annualReturn: number; contribution: number; intensity: number; deviationDirection: DeviationDirection; }>; portfolioReturn: number; startingCapital: number; endingCapital: number; runningPeak: number; drawdown: number; }>;
  scenarioPath: {
    years: Array<{ year: number; scenario: Scenario; durationInCurrentScenario: number; }>;
    frequencies: Record<Scenario, number>;
  };
  __advancedObservationSamples: Array<{ scenario: Scenario; etfReturns: number[]; }>;
  unrecovered: boolean;
  maxRecoveryTimeMonths: number | null;
  unrecoveredDurationMonths: number | null;
  matricesCoherent: boolean;
  returnDiagnostics: Record<string, unknown>;
  performanceDiagnostics: Record<string, unknown>;
  correlationDiagnostics?: unknown;
  generalBenchmark?: unknown;
};

const scenarioCycle: Scenario[] = ['expansion', 'recession', 'stagflation', 'soft_landing'];

const deepEqual = (left: unknown, right: unknown, path = 'root'): void => {
  if (left === right) return;
  if (typeof left === 'number' && typeof right === 'number') {
    assert.equal(left, right, `${path} :: number mismatch`);
    return;
  }
  if (typeof left === 'string' && typeof right === 'string') {
    assert.equal(left, right, `${path} :: string mismatch`);
    return;
  }
  if (typeof left === 'boolean' && typeof right === 'boolean') {
    assert.equal(left, right, `${path} :: boolean mismatch`);
    return;
  }
  if (left === null || right === null) {
    assert.equal(left, right, `${path} :: null mismatch`);
    return;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    assert.equal(left.length, right.length, `${path} :: array length mismatch`);
    for (let index = 0; index < left.length; index += 1) {
      deepEqual(left[index], right[index], `${path}[${index}]`);
    }
    return;
  }
  if (typeof left === 'object' && typeof right === 'object') {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const leftKeys = Object.keys(a).sort();
    const rightKeys = Object.keys(b).sort();
    assert.deepEqual(leftKeys, rightKeys, `${path} :: object keys mismatch`);
    for (const key of leftKeys) {
      deepEqual(a[key], b[key], `${path}.${key}`);
    }
    return;
  }
  assert.equal(String(left), String(right), `${path} :: scalar mismatch`);
};

const createSyntheticPath = (index: number, months = 120, years = 10, etfCount = 5, advancedOn = true): SyntheticPath => {
  const monthEntries = Array.from({ length: months }, (_, monthIndex) => ({
    month: monthIndex + 1,
    year: 1 + Math.floor(monthIndex / 12),
    endingCapital: 100000 + index * 1000 + monthIndex * 12.5,
    capital: 100000 + index * 1000 + monthIndex * 12.5,
    portfolioReturn: 0.005 + (index * 0.0007) + (monthIndex % 6) * 0.001,
    runningPeak: 100000 + index * 1000 + monthIndex * 15,
    drawdown: 0.02 + ((monthIndex % 8) * 0.005),
    intensity: 0.8 + ((monthIndex % 5) * 0.05)
  }));

  const yearEntries = Array.from({ length: years }, (_, yearIndex) => {
    const scenario = scenarioCycle[yearIndex % scenarioCycle.length];
    const etfReturns = Array.from({ length: etfCount }, (_, etfIndex) => ({
      isin: `ETF-${index}-${etfIndex + 1}`,
      name: `ETF ${index}-${etfIndex + 1}`,
      weight: (1 / etfCount) * (1 + (etfIndex % 3) * 0.05),
      annualReturn: 0.06 + (etfIndex * 0.01) + (index * 0.001),
      contribution: 0.4 + etfIndex * 0.08 + index * 0.01,
      intensity: 0.6 + etfIndex * 0.09,
      deviationDirection: (etfIndex % 2 === 0 ? 'above_expected' : 'below_expected') as DeviationDirection
    }));
    return {
      year: yearIndex + 1,
      scenario,
      durationInCurrentScenario: 12,
      etfReturns,
      portfolioReturn: 0.07 + index * 0.002 + yearIndex * 0.01,
      startingCapital: 100000 + index * 1000,
      endingCapital: 105000 + index * 1200 + yearIndex * 2500,
      runningPeak: 110000 + index * 1400 + yearIndex * 2600,
      drawdown: 0.18 + (yearIndex % 5) * 0.015
    };
  });

  const scenarioPathYears = Array.from({ length: months }, (_, monthIndex) => ({
    year: 1 + Math.floor(monthIndex / 12),
    scenario: scenarioCycle[(monthIndex + index) % scenarioCycle.length],
    durationInCurrentScenario: 1 + (monthIndex % 6)
  }));

  const advancedObservationSamples = advancedOn ? Array.from({ length: months }, (_, monthIndex) => ({
    scenario: scenarioCycle[(monthIndex + index) % scenarioCycle.length],
    etfReturns: Array.from({ length: etfCount }, (_, etfIndex) => Number((0.01 * (monthIndex + 1)) + (0.02 * etfIndex) + (index * 0.001)))
  })) : [];

  return {
    simulationId: index,
    dominantEtfIsin: `ETF-${index}-1`,
    dominantEtfName: `ETF ${index}-1`,
    initialCapital: 100000,
    finalCapital: 105000 + index * 200,
    totalReturn: 0.05 + index * 0.002,
    cagr: 0.04 + index * 0.001,
    maxDrawdown: 0.21 + (index % 4) * 0.03,
    monthly: monthEntries,
    years: yearEntries,
    scenarioPath: {
      years: scenarioPathYears,
      frequencies: {
        expansion: 30,
        recession: 30,
        stagflation: 30,
        soft_landing: 30
      }
    },
    __advancedObservationSamples: advancedObservationSamples,
    unrecovered: false,
    maxRecoveryTimeMonths: null,
    unrecoveredDurationMonths: null,
    matricesCoherent: true,
    returnDiagnostics: { candidateVectors: 1, acceptedVectors: 1, rejectedVectors: 0 },
    performanceDiagnostics: { redrawCount: 0, rejectRate: 0 },
    correlationDiagnostics: undefined,
    generalBenchmark: undefined
  };
};

const buildMessageEnvelope = (paths: SyntheticPath[], executionId: string, workerId: number, batchId: string) => {
  const transport = encodeTransportBatch(paths as any[]);
  const message = {
    type: 'ADD_BATCH',
    executionId,
    workerId,
    batchId,
    transportVersion: transport.message.transportVersion,
    pathCount: transport.message.pathCount,
    arrays: transport.message.arrays,
    offsets: transport.message.offsets,
    strings: transport.message.strings,
    metadata: transport.message.metadata,
    serializedPaths: transport.message.serializedPaths,
    batch: undefined
  };
  return { message, transferList: transport.transferList as ArrayBuffer[] };
};

const deriveExpectedTransferCount = (message: Record<string, any>): number => {
  const uniqueBuffers = new Set<ArrayBuffer>();
  for (const value of Object.values(message.arrays ?? {})) {
    if (ArrayBuffer.isView(value)) {
      uniqueBuffers.add(value.buffer as ArrayBuffer);
    }
  }
  return uniqueBuffers.size;
};

const expect35TransferBuffers = (transferList: ArrayBuffer[], label: string): void => {
  assert.equal(transferList.length, 35, `${label} :: transfer list length`);
  const unique = new Set(transferList.map((item) => item));
  assert.equal(unique.size, 35, `${label} :: unique buffer count`);
  for (const buffer of transferList) {
    assert.ok(buffer.byteLength > 0, `${label} :: pre-send byteLength should be > 0`);
  }
};

const summarizeSchemaArrays = (message: Record<string, any>) => Object.entries(message.arrays ?? {}).map(([name, value]) => {
  const typed = ArrayBuffer.isView(value) ? value : null;
  return {
    name,
    type: typed ? typed.constructor.name : typeof value,
    elementCount: typed ? value.length : 0,
    byteLength: typed ? value.byteLength : 0,
    hasBuffer: !!typed
  };
});

const summarizeOffsetArrays = (message: Record<string, any>) => Object.entries(message.offsets ?? {}).map(([name, value]) => {
  const typed = ArrayBuffer.isView(value) ? value : null;
  return {
    name,
    type: typed ? typed.constructor.name : typeof value,
    elementCount: typed ? value.length : 0,
    byteLength: typed ? value.byteLength : 0,
    isTransferred: typed ? !!(value instanceof Uint32Array && value.buffer && ArrayBuffer.isView(value)) : false
  };
});

const assertCurrentSchemaTransferShape = (message: Record<string, any>, transferList: ArrayBuffer[], label: string): void => {
  const arrays = summarizeSchemaArrays(message);
  assert.equal(arrays.length, 35, `${label} :: message.arrays count mismatch`);
  assert.equal(transferList.length, 35, `${label} :: transferList length mismatch`);
  assert.equal(new Set(transferList).size, 35, `${label} :: unique transferList mismatch`);
  assert.equal(Object.keys(message.offsets ?? {}).length, 4, `${label} :: offset array count mismatch`);
  for (const entry of arrays) {
    assert.ok(entry.byteLength > 0, `${label} :: ${entry.name} should not be zero-length`);
  }
  const offsetBuffers = Object.values(message.offsets ?? {}).map((value) => value.buffer as ArrayBuffer);
  for (const buffer of offsetBuffers) {
    assert.ok(!transferList.includes(buffer), `${label} :: offset buffer entered transfer list`);
  }
};

const runT0 = async (): Promise<void> => {
  const channel = new MessageChannel();
  await new Promise<void>((resolve) => {
    const received: string[] = [];
    channel.port1.onmessage = (event: MessageEvent) => {
      const payload = event.data as { type?: string; executionId?: string; workerId?: number };
      if (payload?.type === 'PONG') {
        received.push('pong');
        assert.deepEqual(received, ['ping', 'pong']);
        resolve();
      }
    };
    channel.port2.onmessage = (event: MessageEvent) => {
      const payload = event.data as { type?: string; executionId?: string; workerId?: number };
      if (payload?.type === 'PING') {
        received.push('ping');
        channel.port2.postMessage({ type: 'PONG', executionId: payload.executionId, workerId: payload.workerId });
      }
    };
    channel.port1.postMessage({ type: 'PING', executionId: 'probe-0', workerId: 1 });
  });
};

const runT1 = async (): Promise<void> => {
  const source = [createSyntheticPath(1, 1, 1, 1, true)];
  const { message, transferList } = buildMessageEnvelope(source, 'exec-t1', 7, 't1');
  const channel = new MessageChannel();
  let addBatchSeen = false;
  let ackSeen = false;

  await new Promise<void>((resolve, reject) => {
    channel.port1.onmessage = (event: MessageEvent) => {
      try {
        const payload = event.data as any;
        if (payload?.type === 'ADD_BATCH_ACK') {
          ackSeen = true;
          assert.equal(payload.executionId, 'exec-t1', 'T1 :: ack executionId mismatch');
          resolve();
        }
      } catch (error) {
        reject(error);
      }
    };

    channel.port2.onmessage = (event: MessageEvent) => {
      try {
        const payload = event.data as any;
        if (payload?.type === 'ADD_BATCH') {
          addBatchSeen = true;
          const decoded = decodeTransportBatch(payload);
          assert.equal(decoded.length, 1, 'T1 :: decode count mismatch');
          deepEqual(source[0], decoded[0], 'T1 :: decode mismatch');
          channel.port2.postMessage({ type: 'ADD_BATCH_ACK', executionId: payload.executionId, workerId: payload.workerId });
        }
      } catch (error) {
        reject(error);
      }
    };

    channel.port1.postMessage(message, transferList);
  });

  assert.equal(addBatchSeen, true, 'T1 :: add batch not received');
  assert.equal(ackSeen, true, 'T1 :: ack not received');
};

export const runT2 = async (): Promise<void> => {
  const makePath = (direction: DeviationDirection) => {
    const base = createSyntheticPath(2, 120, 10, 5, true);
    return {
      ...base,
      years: [{
        ...base.years[0],
        etfReturns: base.years[0].etfReturns.map((etf, index) => ({
          ...etf,
          deviationDirection: index === 0 ? direction : (index % 2 === 0 ? 'above_expected' : 'below_expected')
        }))
      }]
    };
  };

  const source = [makePath('above_expected'), makePath('below_expected')];
  const { message, transferList } = buildMessageEnvelope(source, 'exec-t2', 9, 't2');
  const channel = new MessageChannel();
  const expectedTransferCount = deriveExpectedTransferCount(message);
  assert.equal(transferList.length, expectedTransferCount, 'T2 :: expected transfer buffer count');
  assert.equal(expectedTransferCount, 35, 'T2 :: source-proven transfer form mismatch');
  for (const buffer of transferList) {
    assert.ok(buffer instanceof ArrayBuffer, 'T2 :: transferList entry is not an ArrayBuffer');
    assert.ok(buffer.byteLength > 0, 'T2 :: before-send buffers invalid');
  }
  const uniqueBuffers = new Set(transferList.map((buffer) => buffer));
  assert.equal(uniqueBuffers.size, transferList.length, 'T2 :: duplicate ArrayBuffers present');

  await new Promise<void>((resolve, reject) => {
    channel.port1.onmessage = (event: MessageEvent) => {
      try {
        const payload = event.data as any;
        if (payload?.type === 'ADD_BATCH_ACK') {
          resolve();
        }
      } catch (error) {
        reject(error);
      }
    };

    channel.port2.onmessage = (event: MessageEvent) => {
      try {
        const payload = event.data as any;
        if (payload?.type === 'ADD_BATCH') {
          const state = {
            ...aggregationState,
            executionId: payload.executionId ?? null,
            input: null,
            snapshot: null,
            paths: [],
            expectedPathCount: payload.pathCount ?? source.length,
            receivedPathCount: 0,
            readyToFinalize: false,
            registeredPorts: [],
            pendingFinalize: null
          };
          const before = state.receivedPathCount;
          processAddBatchMessage(payload, state);
          const after = state.receivedPathCount;
          assert.equal(before, 0, 'T2 :: pre-accept count must start at 0');
          assert.equal(after, source.length, 'T2 :: post-accept count must equal source length');
          assert.equal(after - before, source.length, 'T2 :: delta must equal decoded count');
          const decoded = decodeTransportBatch(payload);
          assert.equal(decoded.length, source.length, 'T2 :: decode count mismatch');
          deepEqual(source[0], decoded[0], 'T2 :: source decode mismatch A');
          deepEqual(source[1], decoded[1], 'T2 :: source decode mismatch B');
          assert.equal(decoded[0].years[0].etfReturns[0].deviationDirection, 'above_expected', 'T2 :: above_expected roundtrip');
          assert.equal(decoded[1].years[0].etfReturns[0].deviationDirection, 'below_expected', 'T2 :: below_expected roundtrip on second entry');
          channel.port2.postMessage({ type: 'ADD_BATCH_ACK', executionId: payload.executionId, workerId: payload.workerId });
        }
      } catch (error) {
        reject(error);
      }
    };

    channel.port1.postMessage(message, transferList);
    for (const buffer of transferList) {
      assert.equal(buffer.byteLength, 0, 'T2 :: transfer list not detached after post');
    }
  });
};

const runT3 = async (): Promise<void> => {
  const source = [createSyntheticPath(3, 120, 10, 5, true)];
  const { message, transferList } = buildMessageEnvelope(source, 'exec-t3', 11, 't3');
  assertCurrentSchemaTransferShape(message, transferList, 'T3');
  const arraySummary = summarizeSchemaArrays(message);
  const offsetSummary = summarizeOffsetArrays(message);
  console.log('T3_SCHEMA_ARRAYS', JSON.stringify(arraySummary, null, 2));
  console.log('T3_SCHEMA_OFFSETS', JSON.stringify(offsetSummary, null, 2));

  const channel = new MessageChannel();
  let aggAddBatchEnter = 0;
  let aggDecodeStatus = 0;
  let aggBatchAccepted = 0;
  let aggHandlerException = 0;
  let ackSent = false;
  let ackReceived = false;
  let postMessageReturned = false;

  await new Promise<void>((resolve, reject) => {
    channel.port1.onmessage = (event: MessageEvent) => {
      try {
        const payload = event.data as any;
        if (payload?.type === 'ADD_BATCH_ACK') {
          ackReceived = true;
          postMessageReturned = true;
          resolve();
        }
      } catch (error) {
        reject(error);
      }
    };

    channel.port2.onmessage = (event: MessageEvent) => {
      try {
        const payload = event.data as any;
        if (payload?.type === 'ADD_BATCH') {
          const state = {
            ...aggregationState,
            executionId: payload.executionId ?? null,
            input: null,
            snapshot: null,
            paths: [],
            expectedPathCount: payload.pathCount ?? source.length,
            receivedPathCount: 0,
            readyToFinalize: false,
            registeredPorts: [],
            pendingFinalize: null
          };
          const before = state.receivedPathCount;
          processAddBatchMessage(payload, state, () => undefined, (executionId, workerId, eventName, details) => {
            if (eventName === 'AGG_ADD_BATCH_ENTER') aggAddBatchEnter += 1;
            if (eventName === 'AGG_DECODE_STATUS') aggDecodeStatus += 1;
            if (eventName === 'AGG_BATCH_ACCEPTED') aggBatchAccepted += 1;
            if (eventName === 'AGG_HANDLER_EXCEPTION') aggHandlerException += 1;
          }, null, 0);
          const after = state.receivedPathCount;
          const decoded = decodeTransportBatch(payload);
          assert.equal(decoded.length, 1, 'T3 :: decode count mismatch');
          assert.equal(before, 0, 'T3 :: pre-accept count must start at 0');
          assert.equal(after, source.length, 'T3 :: post-accept count must equal source length');
          assert.equal(after - before, source.length, 'T3 :: delta must equal decoded count');
          deepEqual(source[0], decoded[0], 'T3 :: decoded equality mismatch');
          ackSent = true;
          channel.port2.postMessage({ type: 'ADD_BATCH_ACK', executionId: payload.executionId, workerId: payload.workerId });
        }
      } catch (error) {
        reject(error);
      }
    };

    channel.port1.postMessage(message, transferList);
    for (const buffer of transferList) {
      assert.equal(buffer.byteLength, 0, 'T3 :: transfer list not detached after post');
    }
  });

  assert.equal(postMessageReturned, true, 'T3 :: postMessage returned no ACK');
  assert.equal(ackSent, true, 'T3 :: ack not sent');
  assert.equal(ackReceived, true, 'T3 :: ack not received');
  assert.equal(aggAddBatchEnter, 1, 'T3 :: AGG_ADD_BATCH_ENTER count mismatch');
  assert.equal(aggDecodeStatus, 1, 'T3 :: AGG_DECODE_STATUS count mismatch');
  assert.equal(aggBatchAccepted, 1, 'T3 :: AGG_BATCH_ACCEPTED count mismatch');
  assert.equal(aggHandlerException, 0, 'T3 :: AGG_HANDLER_EXCEPTION count mismatch');
};

const runT4 = async (): Promise<void> => {
  const source = Array.from({ length: 250 }, (_, index) => createSyntheticPath(index, 120, 10, 5, true));
  const { message, transferList } = buildMessageEnvelope(source, 'exec-t4', 17, 't4');
  assertCurrentSchemaTransferShape(message, transferList, 'T4');
  const arraySummary = summarizeSchemaArrays(message);
  const offsetSummary = summarizeOffsetArrays(message);
  const arrayTotalBytes = arraySummary.reduce((sum, entry) => sum + entry.byteLength, 0);
  const offsetTotalBytes = offsetSummary.reduce((sum, entry) => sum + entry.byteLength, 0);
  console.log('T4_SCHEMA_ARRAYS', JSON.stringify(arraySummary, null, 2));
  console.log('T4_SCHEMA_OFFSETS', JSON.stringify(offsetSummary, null, 2));
  console.log('T4_BYTE_TOTALS', JSON.stringify({ arrayTotalBytes, offsetTotalBytes, totalNumericBytes: arrayTotalBytes + offsetTotalBytes }, null, 2));

  const channel = new MessageChannel();
  let decodedCount = 0;
  let aggAddBatchEnter = 0;
  let aggDecodeStatus = 0;
  let aggBatchAccepted = 0;
  let aggHandlerException = 0;
  let ackSent = false;
  let ackReceived = false;
  let receivedBefore = 0;
  let receivedAfter = 0;

  await new Promise<void>((resolve, reject) => {
    channel.port1.onmessage = (event: MessageEvent) => {
      try {
        const payload = event.data as any;
        if (payload?.type === 'ADD_BATCH_ACK') {
          ackReceived = true;
          resolve();
        }
      } catch (error) {
        reject(error);
      }
    };

    channel.port2.onmessage = (event: MessageEvent) => {
      try {
        const payload = event.data as any;
        if (payload?.type === 'ADD_BATCH') {
          const state = {
            ...aggregationState,
            executionId: payload.executionId ?? null,
            input: null,
            snapshot: null,
            paths: [],
            expectedPathCount: payload.pathCount ?? source.length,
            receivedPathCount: 0,
            readyToFinalize: false,
            registeredPorts: [],
            pendingFinalize: null
          };
          receivedBefore = state.receivedPathCount;
          processAddBatchMessage(payload, state, () => undefined, (executionId, workerId, eventName, details) => {
            if (eventName === 'AGG_ADD_BATCH_ENTER') aggAddBatchEnter += 1;
            if (eventName === 'AGG_DECODE_STATUS') aggDecodeStatus += 1;
            if (eventName === 'AGG_BATCH_ACCEPTED') aggBatchAccepted += 1;
            if (eventName === 'AGG_HANDLER_EXCEPTION') aggHandlerException += 1;
          }, null, 0);
          receivedAfter = state.receivedPathCount;
          const decoded = decodeTransportBatch(payload);
          decodedCount = decoded.length;
          assert.equal(decoded.length, 250, 'T4 :: decoded path count mismatch');
          assert.equal(receivedBefore, 0, 'T4 :: receivedPathCount before mismatch');
          assert.equal(receivedAfter, 250, 'T4 :: receivedPathCount after mismatch');
          assert.equal(receivedAfter - receivedBefore, 250, 'T4 :: receivedPathCount delta mismatch');
          for (let pathIndex = 0; pathIndex < decoded.length; pathIndex += 1) {
            deepEqual(source[pathIndex], decoded[pathIndex], `T4 :: decoded equality mismatch at index ${pathIndex}`);
          }
          ackSent = true;
          channel.port2.postMessage({ type: 'ADD_BATCH_ACK', executionId: payload.executionId, workerId: payload.workerId });
        }
      } catch (error) {
        reject(error);
      }
    };

    channel.port1.postMessage(message, transferList);
    for (const buffer of transferList) {
      assert.equal(buffer.byteLength, 0, 'T4 :: transfer list not detached after post');
    }
  });

  assert.equal(ackSent, true, 'T4 :: ack not sent');
  assert.equal(ackReceived, true, 'T4 :: ack not received');
  assert.equal(aggAddBatchEnter, 1, 'T4 :: AGG_ADD_BATCH_ENTER count mismatch');
  assert.equal(aggDecodeStatus, 1, 'T4 :: AGG_DECODE_STATUS count mismatch');
  assert.equal(aggBatchAccepted, 1, 'T4 :: AGG_BATCH_ACCEPTED count mismatch');
  assert.equal(aggHandlerException, 0, 'T4 :: AGG_HANDLER_EXCEPTION count mismatch');
  assert.equal(decodedCount, 250, 'T4 :: decoded count mismatch');
};

export { runT3, runT4 };

const main = async (): Promise<void> => {
  console.log('T0: running');
  await runT0();
  console.log('T0: PASS');

  console.log('T1: running');
  await runT1();
  console.log('T1: PASS');

  console.log('T2: running');
  await runT2();
  console.log('T2: PASS');

  console.log('T3: running');
  await runT3();
  console.log('T3: PASS');

  console.log('T4: running');
  await runT4();
  console.log('T4: PASS');
};

if (require.main === module) {
  main().catch((error) => {
    console.error('TRANSPORT_MICRO_CERT_FAILURE', error);
    process.exitCode = 1;
  });
}
