import { KV } from './KV.js';
import { createClient } from 'redis';
export { createClient };
export { KV };

export class RedisKV extends KV {

    #redis;
    #redisPath;
    #channel;
    #connect;

    #keyLevelExpires;
    get keyLevelExpires() { return this.#keyLevelExpires; }

    constructor({ redisUrl = null, channel = null, namespace = '*', keyLevelExpires = false, ...options }) {
        super(options);
        this.#redis = redisUrl ? createClient({ url: redisUrl }) : createClient();
        this.#redis.on('error', (err) => console.error('Redis error:', err));
        this.#connect = this.#redis.connect();
        this.#redisPath = `${namespace}:${this.path.join(':')}`;
        this.#channel = channel;
        this.#keyLevelExpires = keyLevelExpires;
    }

    /* ---------- public API ---------- */

    async close() {
        try {
            await this.#redis.quit();
        } catch (e) { }
        await super.close();
    }

    async count() {
        if (this.#keyLevelExpires) {
            return (await this.keys()).length;
        }
        await this.#connect;
        return this.#redis.hLen(this.#redisPath);
    }

    async keys() {
        if (this.#keyLevelExpires) {
            return (await this.#entries()).map(([k]) => k);
        }
        await this.#connect;
        return await this.#redis.hKeys(this.#redisPath);
    }

    async values() {
        if (this.#keyLevelExpires) {
            return (await this.#entries()).map(([, v]) => v);
        }
        await this.#connect;
        return (await this.#redis.hVals(this.#redisPath)).map((v) => this._deserialize(v)?.value);
    }

    async entries() { return await this.#entries(); }

    async #entries(dump = false) {
        await this.#connect;
        let entries = Object.entries(
            await this.#redis.hGetAll(this.#redisPath)
        ).map(([key, value]) => [key, this._deserialize(value)]);
        if (this.#keyLevelExpires) {
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
        return entries.map(([key, value]) => [key, dump ? value : value?.value]);
    }

    async has(key) {
        key = typeof key === 'object' && key ? key.key : key;
        if (this.#keyLevelExpires) {
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
        if (this.#keyLevelExpires && this._expired(valHash)) {
            await this.#redis.hDel(this.#redisPath, key);
            return;
        }
        return isSelector ? valHash : valHash?.value;
    }

    async set(key, value) {
        let rest, event;
        ({ key, value, rest, event } = this._resolveSet(key, value));

        const jsonValue = this._serialize({ value, ...rest });

        await this.#connect;
        const op = this.#redis.multi()
            .hSet(this.#redisPath, key, jsonValue);
        if (this.#channel) {
            const eventJson = JSON.stringify(event);
            op.publish(this.#channel, eventJson);
        }
        if (this.ttl/* IMPORTANT */) {
            const effectiveTTL = Math.max(this.ttl, this.#keyLevelExpires && rest.expires ? rest.expires - Date.now() : 0);
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
                const jsonValue = this._serialize(value);
                op.hSet(this.#redisPath, key, jsonValue);
                if (this.ttl && this.#keyLevelExpires && value.expires) {
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