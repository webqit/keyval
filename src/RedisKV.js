import { KV } from './KV.js';
import { createClient } from 'redis';
export { createClient };
export { KV };

export class RedisKV extends KV {

    #redis;
    #redisPath;
    #channel;
    #serialize;
    #deserialize;
    #connect;

    #keyLevelTTL;
    get keyLevelTTL() { return this.#keyLevelTTL; }

    constructor({ redisUrl = null, channel = null, namespace = '*', keyLevelTTL = false, serialize = null, deserialize = null, ...options }) {
        super(options);
        this.#redis = redisUrl ? createClient({ url: redisUrl }) : createClient();
        this.#redis.on('error', (err) => console.error('Redis error:', err));
        this.#connect = this.#redis.connect();
        this.#redisPath = `${namespace}:${this.path.join(':')}`;
        this.#channel = channel;
        this.#keyLevelTTL = keyLevelTTL;
        this.#serialize = serialize || ((val) => (val === undefined ? null : JSON.stringify(val)));
        this.#deserialize = deserialize || ((val) => (val === null ? undefined : JSON.parse(val)));
    }

    /* ---------- public API ---------- */

    async close() {
        try {
            await this.#redis.quit();
        } catch (e) { }
        await super.close();
    }

    async count() {
        if (this.#keyLevelTTL) {
            return (await this.keys()).length;
        }
        await this.#connect;
        return this.#redis.hLen(this.#redisPath);
    }

    async keys() {
        if (this.#keyLevelTTL) {
            return (await this.#entries()).map(([k]) => k);
        }
        await this.#connect;
        return await this.#redis.hKeys(this.#redisPath);
    }

    async values() {
        if (this.#keyLevelTTL) {
            return (await this.#entries()).map(([, v]) => v);
        }
        await this.#connect;
        return (await this.#redis.hVals(this.#redisPath)).map((v) => this.#deserialize(v)?.value);
    }

    async entries() { return await this.#entries(); }

    async #entries(dump = false) {
        await this.#connect;
        let entries = Object.entries(
            await this.#redis.hGetAll(this.#redisPath)
        ).map(([key, value]) => [key, this.#deserialize(value)]);
        if (this.#keyLevelTTL) {
            entries = entries.filter(([, e]) => !this._expired(e));
        }
        return entries.map(([key, value]) => [key, dump ? value : value?.value]);
    }

    async has(key) {
        key = typeof key === 'object' && key ? key.key : key;
        if (this.#keyLevelTTL) {
            return (await this.keys()).includes(key);
        }
        await this.#connect;
        return (await this.#redis.hExists(this.#redisPath, key)) === 1;
    }

    async get(key) {
        const isSelector = typeof key === 'object' && key;
        key = isSelector ? key.key : key;
        await this.#connect;
        const jsonValue = await this.#redis.hGet(this.#redisPath, key);
        const valHash = this.#deserialize(jsonValue);
        if (this.#keyLevelTTL && this._expired(valHash)) {
            await this.#redis.hDel(this.#redisPath, key);
            return;
        }
        return isSelector ? valHash : valHash?.value;
    }

    async set(key, value) {
        let rest, event;
        ({ key, value, rest, event } = this._resolveSet(key, value));

        const jsonValue = this.#serialize({ value, ...rest });

        await this.#connect;
        const op = this.#redis.multi()
            .hSet(this.#redisPath, key, jsonValue);
        if (this.#channel) {
            const eventJson = JSON.stringify(event);
            op.publish(this.#channel, eventJson);
        }
        if (this.ttl/* IMPORTANT */) {
            const effectiveTTL = Math.max(this.ttl, this.#keyLevelTTL && rest.expires ? rest.expires - Date.now() : 0);
            op.pExpire(this.#redisPath, effectiveTTL);
        }
        await op.exec();

        await this._fire(event);
    }

    async delete(key) {
        key = typeof key === 'object' && key ? key.key : key;

        const event = {
            type: 'delete',
            key,
            path: this.path,
            origins: this.origins,
            timestamp: Date.now(),
        };

        await this.#connect;
        const op = this.#redis.multi()
            .hDel(this.#redisPath, key);
        if (this.#channel) {
            const eventJson = JSON.stringify(event);
            op.publish(this.#channel, eventJson);
        }
        await op.exec();

        await this._fire(event);
    }

    async clear() {
        const event = {
            type: 'clear',
            path: this.path,
            origins: this.origins,
            timestamp: Date.now(),
        };

        await this.#connect;
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
        if (arg && arg !== true) {
            const { data, event } = this._resolveInputJson(arg, options);

            await this.#connect;
            const op = this.#redis.multi();
            if (!options.merge) {
                op.del(this.#redisPath);
            }
            let effectiveTTL = this.ttl || 0;
            for (const [key, value] of Object.entries(data)) {
                const jsonValue = this.#serialize(value);
                op.hSet(this.#redisPath, key, jsonValue);
                if (this.ttl && this.#keyLevelTTL && value.expires) {
                    effectiveTTL = Math.max(effectiveTTL, value.expires - Date.now());
                }
            }
            if (this.#channel) {
                const eventJson = JSON.stringify(event);
                op.publish(this.#channel, eventJson);
            }
            if (this.ttl/* IMPORTANT */ && effectiveTTL) {
                op.pExpire(this.#redisPath, effectiveTTL);
            }
            await op.exec();

            await this._fire(event);
            return;
        }

        return Object.fromEntries(await this.#entries(arg));
    }
}