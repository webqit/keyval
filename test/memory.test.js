import { MemoryStore } from '../src/MemoryStore.js';
import { runStoreContract } from './helpers/storeContract.js';

describe('MemoryStore', () => {
    runStoreContract(async () => {
        return new MemoryStore({
            path: ['test'],
            channel: 'test-events',
            ttl: 1
        });
    });
});
