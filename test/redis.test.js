import { RedisStore } from '../src/RedisStore.js';
import { runStoreContract } from './helpers/storeContract.js';
import { redisAvailable } from './helpers/redis.js';

describe('RedisStore', async () => {
    before(async function () {
        if (!(await redisAvailable())) {
            this.skip();
        }
    });

    let redisStore;

    before(async () => {
        redisStore = new RedisStore({
            path: ['test'],
            channel: 'test-events',
            ttl: 1
        });
    });

    after(async () => {
        await redisStore?.close();
    });

    runStoreContract(async () => redisStore);
});
