import { KV } from './KV.js';
export { KV };

export class CookieStoreKV extends KV {

    #storage;
    #prefix;
    #channel;
    #cookiePath;

    constructor({
        storage = null,
        channel = null,
        cookiePath = '/',
        ...options
    } = {}) {
        super(options);
        if (!storage && typeof cookieStore === 'undefined') {
            throw new Error(`cookieStore is not available in this environment`);
        }
        this.#storage = storage || cookieStore;
        this.#prefix = this.path.join(':');
        this.#cookiePath = cookiePath;
        if (channel) {
            this.#channel = new BroadcastChannel(channel);
        }
    }

    #fullKey(key) { return `${this.#prefix}:${key}`; }

    #ownsCookieName(name) { return name?.startsWith(this.#prefix + ':'); }

    async #access(c, deserialize = true) {
        if (typeof c === 'string') {
            c = await this.#storage.get(c);
        }
        if (!c) return;
        if (this._expired(c)) {
            // Best-effort cleanup
            await this.#storage.delete(c.name, { path: this.#cookiePath }).catch(() => { });
            return;
        }
        if (deserialize) {
            c.value = this._deserialize(c.value);
        }
        return c;
    }

    /* ---------- public API ---------- */

    async close() {
        this.#channel?.close();
        await super.close();
    }

    async count() { return (await this.keys()).length; }

    async keys() { return (await this.#entries()).map(([k]) => k); }

    async values() { return (await this.#entries()).map(([, v]) => v); }

    async entries() { return await this.#entries(); }

    async #entries(dump = false) {
        const cookies = await this.#storage.getAll();
        const out = [];

        for (let c of cookies) {
            if (!this.#ownsCookieName(c.name)
                || !(c = await this.#access(c))) continue;
            const key = c.name.slice(this.#prefix.length + 1);
            delete c.name;
            out.push([key, dump ? c : c.value]);
        }

        return out;
    }

    async has(key) {
        key = typeof key === 'object' && key ? key.key : key;

        if (!await this.#access(this.#fullKey(key), false)) return false;
        return true;
    }

    async get(key) {
        const isSelector = typeof key === 'object' && key;
        key = isSelector ? key.key : key;

        const c = await this.#access(this.#fullKey(key));
        if (!c) return;

        delete c.name;
        return isSelector ? c : c.value;
    }

    async set(key, value) {
        let rest, event;
        ({ key, value, rest, event } = this._resolveSet(key, value));

        await this.#storage.set({
            path: this.#cookiePath,
            ...rest,
            name: this.#fullKey(key),
            value: this._serialize(value),
        });

        this.#channel?.postMessage(event);
        await this._fire(event);
    }

    async delete(key) {
        key = typeof key === 'object' && key ? key.key : key;

        await this.#storage.delete(this.#fullKey(key), { path: this.#cookiePath });

        const event = {
            type: 'delete',
            key,
            path: this.path,
            origins: this.origins,
            timestamp: Date.now(),
        };

        this.#channel?.postMessage(event);
        await this._fire(event);
    }

    async clear() {
        const cookies = await this.#storage.getAll();
        for (const c of cookies) {
            if (this.#ownsCookieName(c.name)) {
                await this.#storage.delete(c.name, { path: this.#cookiePath }).catch(() => { });
            }
        }

        const event = {
            type: 'clear',
            path: this.path,
            origins: this.origins,
            timestamp: Date.now(),
        };

        this.#channel?.postMessage(event);
        await this._fire(event);
    }

    async json(arg = null, options = {}) {
        if (arg && arg !== true) {
            const { data, event } = this._resolveInputJson(arg, options);

            if (!options.merge) {
                const cookies = await this.#storage.getAll();
                for (const c of cookies) {
                    if (this.#ownsCookieName(c.name)) {
                        await this.#storage.delete(c.name, { path: this.#cookiePath }).catch(() => { });
                    }
                }
            }

            for (const [key, { value, ...rest }] of Object.entries(data)) {
                await this.#storage.set({
                    path: this.#cookiePath,
                    ...rest,
                    name: this.#fullKey(key),
                    value: this._serialize(value),
                });
            }

            this.#channel?.postMessage(event);
            await this._fire(event);
            return;
        }

        return Object.fromEntries(await this.#entries(arg));
    }
}
