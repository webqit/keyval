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
        await this.#redis.quit();
        await super.close();
    }

    async has(key) {
        await this.#connect;
        return (await this.#redis.hexists(this.#redisPath, key)) === 1;
    }

    async keys() {
        await this.#connect;
        return await this.#redis.hkeys(this.#redisPath);
    }

    async values() {
        await this.#connect;
        return (await this.#redis.hvals(this.#redisPath)).map((v) => this.#deserialize(v));
    }

    async entries() {
        await this.#connect;
        return Object.entries(await this.#redis.hgetall(this.#redisPath)).map(([key, value]) => [key, this.#deserialize(value)]);
    }

    async count() {
        await this.#connect;
        return this.#redis.hlen(this.#redisPath);
    }

    async get(key) {
        await this.#connect;
        const jsonValue = await this.#redis.hget(this.#redisPath, key);
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
            .hset(this.#redisPath, key, jsonValue);
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
            .hdel(this.#redisPath, key);
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
}