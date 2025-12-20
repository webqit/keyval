import 'fake-indexeddb/auto';
import { IndexedDBKV } from '../src/IndexedDBKV.js';
import { runKVContract } from './helpers/kvContract.js';

describe('IndexedDBKV', () => {
    runKVContract(async () => {
        return new IndexedDBKV({
            path: ['test'],
            channel: 'test-events',
            ttl: 1500
        });
    });
});
