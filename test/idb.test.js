import 'fake-indexeddb/auto';
import { IDBStore } from '../src/IDBStore.js';
import { runStoreContract } from './helpers/storeContract.js';

describe('IDBStore', () => {
    runStoreContract(async () => {
        return new IDBStore({
            path: ['test'],
            channel: 'test-events',
            ttl: 1
        });
    });
});
