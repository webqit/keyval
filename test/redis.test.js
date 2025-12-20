import { RedisKV } from '../src/RedisKV.js';
import { runKVContract } from './helpers/kvContract.js';
import { redisAvailable } from './helpers/redis.js';

const redisUrl = null;
describe('RedisKV', async () => {
    before(async function () {
        this.timeout(20000);
        if (!(await redisAvailable(redisUrl))) {
            this.skip();
        }
    });

    let redisKV;

    beforeEach(async () => {
        redisKV = new RedisKV({
            redisUrl,
            path: ['test'],
            channel: 'test-events',
            ttl: 1500,
            keyLevelTTL: false
        });
    });

    afterEach(async () => {
        await redisKV?.close();
    });

    runKVContract(async () => redisKV);
});
