import { KV } from './KV.js';
import { createClient } from 'redis';
export { createClient };
export { KV };

export class RedisKV extends KV {

    #redis;
    #redisPath;
    #channel;
    #connect;

    #fieldLevelExpiry;
    get fieldLevelExpiry() { return this.#fieldLevelExpiry; }

    constructor({ redisUrl = null, channel = null, namespace = '*', fieldLevelExpiry = false, ...options }) {
        super(options);
        this.#redis = redisUrl ? createClient({ url: redisUrl }) : createClient();
        this.#redis.on('error', (err) => console.error('Redis error:', err));
        this.#connect = this.#redis.connect();
        this.#redisPath = `${namespace}:${this.path.join(':')}`;
        this.#channel = channel;
        this.#fieldLevelExpiry = fieldLevelExpiry;
    }

    /* ---------- public API ---------- */

    async close() {
        try {
            await this.#redis.quit();
        } catch (e) { }
        await super.close();
    }

    async count() {
        if (this.#fieldLevelExpiry) {
            return (await this.keys()).length;
        }
        await this.#connect;
        return this.#redis.hLen(this.#redisPath);
    }

    async keys() {
        if (this.#fieldLevelExpiry) {
            return (await this.#entries()).map(([k]) => k);
        }
        await this.#connect;
        return await this.#redis.hKeys(this.#redisPath);
    }

    async values() {
        if (this.#fieldLevelExpiry) {
            return (await this.#entries()).map(([, v]) => v);
        }
        await this.#connect;
        return (await this.#redis.hVals(this.#redisPath)).map((v) => this._deserialize(v)?.value);
    }

    async entries() { return await this.#entries(); }

    async json({ meta = false } = {}) {
        return Object.fromEntries(await this.#entries({ meta }));
    }

    async #entries({ meta = false } = {}) {
        await this.#connect;
        let entries = Object.entries(
            await this.#redis.hGetAll(this.#redisPath)
        ).map(([key, value]) => [key, this._deserialize(value)]);
        if (this.#fieldLevelExpiry) {
            const expired = [];
            entries = entries.filter(([k, e]) => {
                if (this._expired(e)) {
                    expired.push(k);
                    return false;
                }
                return true;
            });
            if (expired.length) {
                const op = this.#redis.multi();
                expired.forEach((k) => op.hDel(this.#redisPath, k));
                await op.exec();
            }
        }
        return entries.map(([key, value]) => [key, meta ? value : value?.value]);
    }

    async has(key) {
        key = typeof key === 'object' && key ? key.key : key;
        if (this.#fieldLevelExpiry) {
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
        const valHash = this._deserialize(jsonValue);
        if (this.#fieldLevelExpiry && this._expired(valHash)) {
            await this.#redis.hDel(this.#redisPath, key);
            return;
        }
        return isSelector ? valHash : valHash?.value;
    }

    async set(key, value, options = {}) {
        let rest, event;
        ({ key, value, rest, event } = this._resolveSet(key, value, options));

        const jsonValue = this._serialize({ value, ...rest });

        await this.#connect;
        const op = this.#redis.multi()
            .hSet(this.#redisPath, key, jsonValue);
        if (this.#channel) {
            const eventJson = JSON.stringify(event);
            op.publish(this.#channel, eventJson);
        }
        if (this.hasTTL/* IMPORTANT */) {
            const effectiveTTL = Math.max(this.ttl, this.#fieldLevelExpiry && rest.expires ? rest.expires - Date.now() : 0);
            op.pExpire(this.#redisPath, effectiveTTL);
        }
        await op.exec();

        await this._fire(event);
    }

    async patch(obj = null, options = {}) {
        const { data, event } = this._resolveInputPatch(obj, options);

        await this.#connect;
        const op = this.#redis.multi();
        if (options.replace) {
            op.del(this.#redisPath);
        }
        let effectiveTTL = this.ttl || 0;
        for (const [key, value] of Object.entries(data)) {
            const jsonValue = this._serialize(value);
            op.hSet(this.#redisPath, key, jsonValue);
            if (this.hasTTL && this.#fieldLevelExpiry && value.expires) {
                effectiveTTL = Math.max(effectiveTTL, value.expires - Date.now());
            }
        }
        if (this.#channel) {
            const eventJson = JSON.stringify(event);
            op.publish(this.#channel, eventJson);
        }
        if (this.hasTTL/* IMPORTANT */ && effectiveTTL) {
            op.pExpire(this.#redisPath, effectiveTTL);
        }
        await op.exec();

        await this._fire(event);
    }

    async delete(key, options = {}) {
        let event;
        ({ key, event } = this._resolveDelete(key, options));

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

    async clear(options = {}) {
        const { event } = this._resolveClear(options);

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
}