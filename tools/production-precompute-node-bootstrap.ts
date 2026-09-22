import { parentPort } from 'node:worker_threads';

if (!parentPort) {
  throw new Error('production-precompute-node-bootstrap requires parentPort');
}

const queue: unknown[] = [];
let onMessageHandler: ((event: MessageEvent) => void) | null = null;

const flushQueuedMessages = (): void => {
  if (typeof onMessageHandler !== 'function') {
    return;
  }

  while (queue.length > 0) {
    const queuedPayload = queue.shift();
    const event = { data: queuedPayload } as MessageEvent;
    onMessageHandler.call(globalThis, event);
  }
};

Object.defineProperty(globalThis, 'postMessage', {
  configurable: true,
  writable: true,
  value: (message: unknown) => {
    parentPort.postMessage(message);
  }
});

Object.defineProperty(globalThis, 'onmessage', {
  configurable: true,
  get: () => onMessageHandler,
  set: (nextHandler: ((event: MessageEvent) => void) | null | undefined) => {
    onMessageHandler = typeof nextHandler === 'function' ? nextHandler : null;
    flushQueuedMessages();
  }
});

parentPort.on('message', (payload: unknown) => {
  const event = { data: payload } as MessageEvent;
  if (typeof onMessageHandler === 'function') {
    onMessageHandler.call(globalThis, event);
    return;
  }
  queue.push(payload);
});

export const bootstrapProbe = {
  bootstrapFile: 'tools/production-precompute-node-bootstrap.ts',
  parentPortBridge: true,
  inboundMapping: 'payload -> { data: payload }',
  outboundMapping: 'globalThis.postMessage -> parentPort.postMessage',
  earlyMessageQueue: true,
  dynamicProductionWorkerImport: true,
  productionSourceEdits: 0
};

await import(new URL('./production-precompute-worker.mjs', import.meta.url).href);
