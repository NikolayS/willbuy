// RED stub. Implementation lands in the green commit.

import type { Server } from 'node:net';
import type { ObjectStorage } from './storage.js';
import type { CaptureStore } from './captureStore.js';

export type BrokerDeps = {
  storage: ObjectStorage;
  store: CaptureStore;
  socketPath: string;
  now?: () => string;
  newId?: () => string;
};

export type BrokerHandle = {
  server: Server;
  close(): Promise<void>;
};

export function startBroker(_deps: BrokerDeps): Promise<BrokerHandle> {
  return Promise.reject(new Error('startBroker not implemented'));
}
