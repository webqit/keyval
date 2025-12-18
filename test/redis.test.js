import { RedisStore } from '../src/RedisStore.js';
import { runStoreContract } from './helpers/storeContract.js';
import { redisAvailable } from './helpers/redis.js';

const redisUrl = "redis://default:urWaszGnagYdKekImCsoAgRcFHDLpmam@shinkansen.proxy.rlwy.net:39377";
describe('RedisStore', async () => {
    before(async function () {
        this.timeout(20000);
        if (!(await redisAvailable(redisUrl))) {
            this.skip();
        }
    });

    let redisStore;

    beforeEach(async () => {
        redisStore = new RedisStore({
            redisUrl,
            path: ['test'],
            channel: 'test-events',
            ttl: 1
        });
    });

    afterEach(async () => {
        await redisStore?.close();
    });

    runStoreContract(async () => redisStore);
});
