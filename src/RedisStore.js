import { Store } from './Store.js';
import { createClient } from 'redis';
export { createClient };
export { Store };

export class RedisStore extends Store {

    #redis;
    #redisPath;
    #channel;
    #serialize;
    #deserialize;
    #connect;

    constructor({ redisUrl = null, channel = null, host = '*', serialize = null, deserialize = null, ...options }) {
        super(options);
        this.#redis = redisUrl ? createClient({ url: redisUrl }) : createClient();
        this.#redis.on('error', (err) => console.error('Redis error:', err));
        this.#connect = this.#redis.connect();
        this.#redisPath = `${host}:${this.path.join(':')}`;
        this.#channel = channel;
        this.#serialize = serialize || ((val) => (val === undefined ? null : JSON.stringify(val)));
        this.#deserialize = deserialize || ((val) => (val === null ? undefined : JSON.parse(val)));
    }

    async close() {
        try {
            await this.#redis.quit();
        } catch (e) {}
        await super.close();
    }

    async has(key) {
        await this.#connect;
        return (await this.#redis.hExists(this.#redisPath, key)) === 1;
    }

    async keys() {
        await this.#connect;
        return await this.#redis.hKeys(this.#redisPath);
    }

    async values() {
        await this.#connect;
        return (await this.#redis.hVals(this.#redisPath)).map((v) => this.#deserialize(v));
    }

    async entries() {
        await this.#connect;
        return Object.entries(await this.#redis.hGetAll(this.#redisPath)).map(([key, value]) => [key, this.#deserialize(value)]);
    }

    async count() {
        await this.#connect;
        return this.#redis.hLen(this.#redisPath);
    }

    async get(key) {
        await this.#connect;
        const jsonValue = await this.#redis.hGet(this.#redisPath, key);
        return this.#deserialize(jsonValue);
    }

    async set(key, value) {
        await this.#connect;
        const event = {
            type: 'set',
            key,
            value,
            path: this.path,
            origins: this.origins,
            timestamp: Date.now(),
        };
        const jsonValue = this.#serialize(value);
        const op = this.#redis.multi()
            .hSet(this.#redisPath, key, jsonValue);
        if (this.#channel) {
            const eventJson = JSON.stringify(event);
            op.publish(this.#channel, eventJson);
        }
        if (this.ttl) {
            op.expire(this.#redisPath, this.ttl);
        }
        await op.exec();
        await this._fire(event);
    }

    async delete(key) {
        await this.#connect;
        const event = {
            type: 'delete',
            key,
            path: this.path,
            origins: this.origins,
            timestamp: Date.now(),
        };
        const op = this.#redis.multi()
            .hDel(this.#redisPath, key);
        if (this.#channel) {
            const eventJson = JSON.stringify(event);
            op.publish(this.#channel, eventJson);
        }
        if (this.ttl) {
            op.expire(this.#redisPath, this.ttl);
        }
        await op.exec();
        await this._fire(event);
    }

    async clear() {
        await this.#connect;
        const event = {
            type: 'clear',
            path: this.path,
            origins: this.origins,
            timestamp: Date.now(),
        };
        const op = this.#redis.multi()
            .del(this.#redisPath);
        if (this.#channel) {
            const eventJson = JSON.stringify(event);
            op.publish(this.#channel, eventJson);
        }
        await op.exec();
        await this._fire(event);
    }

    async json(arg = null, options = {}) {
        await this.#connect;

        if (arg && arg !== true) {
            if (typeof arg !== 'object') {
                throw new Error(`Argument must be a valid JSON object`);
            }
            
            if (options.hashed) {
                throw new Error('Hashed data not supported');
            }

            const event = {
                type: 'json',
                data: arg,
                options,
                path: this.path,
                origins: this.origins,
                timestamp: Date.now(),
            };

            const op = this.#redis.multi();
            if (!options.merge) {
                op.del(this.#redisPath);
            }
            for (const [key, value] of Object.entries(arg)) {
                const jsonValue = this.#serialize(value);
                op.hSet(this.#redisPath, key, jsonValue);
            }
            if (this.#channel) {
                const eventJson = JSON.stringify(event);
                op.publish(this.#channel, eventJson);
            }
            await op.exec();

            await this._fire(event);
            return;
        }

        return Object.fromEntries(await this.entries());
    }
}