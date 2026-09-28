export const MARKET_UNIVERSE_BINARY_MAGIC = 'MU64';
export const MARKET_UNIVERSE_BINARY_VERSION = 1;
export const MARKET_UNIVERSE_BINARY_PAYLOAD_FULL = 1;
export const MARKET_UNIVERSE_BINARY_PAYLOAD_RETURNS_ONLY = 2;

export type MarketUniverseBinaryPayloadType = 'FULL' | 'RETURNS_ONLY';
export type MarketUniverseScenarioCode = 'expansion' | 'soft_landing' | 'recession' | 'stagflation';

export interface DecodedMarketUniverseBinary {
  payloadType: MarketUniverseBinaryPayloadType;
  version: number;
  runId: string;
  pathCount: number;
  monthCount: number;
  returnCount: number;
  returns: Float64Array;
  intensities: Float64Array | null;
  scenarios: Uint8Array | null;
  rawBuffer: ArrayBuffer;
}

export class MarketUniverseBinaryTransport {
  static decodeScenarioCode(code: number): MarketUniverseScenarioCode {
    const normalizedCode = Number(code || 0);
    if (!Number.isInteger(normalizedCode) || normalizedCode < 0 || normalizedCode > 3) {
      throw new Error(`Invalid Market Universe scenario code: ${code}`);
    }

    switch (normalizedCode) {
      case 0: return 'expansion';
      case 1: return 'soft_landing';
      case 2: return 'recession';
      case 3: return 'stagflation';
      default: throw new Error(`Invalid Market Universe scenario code: ${code}`);
    }
  }

  static decode(buffer: ArrayBuffer): DecodedMarketUniverseBinary {
    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error('Market Universe binary payload is not an ArrayBuffer');
    }

    if (buffer.byteLength < 32) {
      throw new Error('Market Universe binary payload is truncated');
    }

    const view = new DataView(buffer);
    const magic = this.readAscii(buffer, 0, 4);
    if (magic !== MARKET_UNIVERSE_BINARY_MAGIC) {
      throw new Error(`Invalid binary payload magic: ${magic}`);
    }

    const version = view.getUint16(4, true);
    if (version !== MARKET_UNIVERSE_BINARY_VERSION) {
      throw new Error(`Unsupported Market Universe binary version: ${version}`);
    }

    const payloadTypeCode = view.getUint8(6);
    const payloadType = payloadTypeCode === MARKET_UNIVERSE_BINARY_PAYLOAD_FULL
      ? 'FULL'
      : payloadTypeCode === MARKET_UNIVERSE_BINARY_PAYLOAD_RETURNS_ONLY
        ? 'RETURNS_ONLY'
        : null;
    if (!payloadType) {
      throw new Error(`Unsupported Market Universe payload type: ${payloadTypeCode}`);
    }

    const runIdLength = view.getUint32(8, true);
    const pathCount = view.getUint32(12, true);
    const monthCount = view.getUint32(16, true);
    const returnCount = view.getUint32(20, true);
    const intensityCount = view.getUint32(24, true);
    const scenarioCount = view.getUint32(28, true);

    if (pathCount <= 0 || monthCount <= 0) {
      throw new Error(`Invalid Market Universe geometry: pathCount=${pathCount}, monthCount=${monthCount}`);
    }

    const expectedReturnCount = pathCount * monthCount;
    if (returnCount !== expectedReturnCount) {
      throw new Error(`Binary return geometry mismatch: expected ${expectedReturnCount}, received ${returnCount}`);
    }

    const runIdOffset = 32;
    const runId = this.readUtf8(buffer, runIdOffset, runIdLength);
    const runIdEnd = runIdOffset + runIdLength;
    if (runIdEnd > buffer.byteLength) {
      throw new Error('Market Universe binary payload has a truncated runId');
    }

    let offset = runIdEnd;
    const returnsLength = returnCount * 8;
    if (offset + returnsLength > buffer.byteLength) {
      throw new Error('Market Universe binary payload is truncated before the returns payload');
    }

    const returns = new Float64Array(returnCount);
    for (let index = 0; index < returnCount; index += 1) {
      returns[index] = view.getFloat64(offset + index * 8, true);
    }
    offset += returnsLength;

    let intensities: Float64Array | null = null;
    let scenarios: Uint8Array | null = null;

    if (payloadType === 'FULL') {
      if (intensityCount !== returnCount || scenarioCount !== returnCount) {
        throw new Error('FULL payload element counts do not match the run geometry');
      }
      if (offset + returnCount * 8 + returnCount > buffer.byteLength) {
        throw new Error('Market Universe FULL payload is truncated');
      }
      intensities = new Float64Array(returnCount);
      for (let index = 0; index < returnCount; index += 1) {
        intensities[index] = view.getFloat64(offset + index * 8, true);
      }
      offset += returnCount * 8;
      scenarios = new Uint8Array(buffer, offset, returnCount);
      offset += returnCount;

      for (let index = 0; index < scenarios.length; index += 1) {
        this.decodeScenarioCode(scenarios[index]);
      }
    }

    if (offset > buffer.byteLength) {
      throw new Error('Market Universe binary payload is truncated');
    }

    return {
      payloadType,
      version,
      runId,
      pathCount,
      monthCount,
      returnCount,
      returns,
      intensities,
      scenarios,
      rawBuffer: buffer
    };
  }

  private static readAscii(buffer: ArrayBuffer, offset: number, length: number): string {
    const chunk = new Uint8Array(buffer, offset, length);
    return Array.from(chunk, (byte) => String.fromCharCode(byte)).join('');
  }

  private static readUtf8(buffer: ArrayBuffer, offset: number, length: number): string {
    const bytes = new Uint8Array(buffer, offset, length);
    const textDecoder = new TextDecoder('utf-8');
    return textDecoder.decode(bytes);
  }
}
