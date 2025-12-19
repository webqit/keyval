import { InMemoryKV } from '../src/InMemoryKV.js';
import { runKVContract } from './helpers/kvContract.js';

describe('InMemoryKV', () => {
    runKVContract(async () => {
        return new InMemoryKV({
            path: ['test'],
            channel: 'test-events',
            ttl: 1
        });
    });
});
