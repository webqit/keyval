import { KV } from './KV.js';
export { KV };

export class WebStorageKV extends KV {

    #storage;
    #prefix;
    #channel;

    constructor({
        storage = 'local',              // 'local' | 'session' | Storage instance
        channel = null,
        ...options
    } = {}) {
        super(options);
        this.#storage =
            typeof storage === 'string'
                ? (storage === 'session' ? window.sessionStorage : window.localStorage)
                : storage;
        this.#prefix = this.path.join(':');
        if (channel) {
            this.#channel = new BroadcastChannel(channel);
        }
    }

    #fullKey(key) { return `${this.#prefix}:${key}`; }

    #ownsStorageKey(storageKey) { return storageKey?.startsWith(this.#prefix + ':'); }

    #access(key) {
        const fullKey = this.#fullKey(key);
        const raw = this.#storage.getItem(fullKey);
        if (raw == null) return;

        let fieldNode;
        try {
            fieldNode = this._deserialize(raw);
        } catch {
            // Corrupt/unexpected value -> treat as absent
            this.#storage.removeItem(fullKey);
            return;
        }

        if (this._expired(fieldNode)) {
            this.#storage.removeItem(fullKey);
            return;
        }

        return fieldNode;
    }

    #saveNode(key, fieldNode) {
        const fullKey = this.#fullKey(key);
        this.#storage.setItem(fullKey, this._serialize(fieldNode));
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

    async json({ meta = false } = {}) {
        return Object.fromEntries(await this.#entries({ meta }));
    }

    async #entries({ meta = false } = {}) {
        const out = [];
        for (let i = 0; i < this.#storage.length; i++) {
            const storageKey = this.#storage.key(i);
            if (!this.#ownsStorageKey(storageKey)) continue;

            const key = storageKey.slice(this.#prefix.length + 1);
            const fieldNode = this.#access(key);
            if (!fieldNode) continue;

            out.push([key, meta ? fieldNode : fieldNode.value]);
        }
        return out;
    }

    async has(key) {
        key = typeof key === 'object' && key ? key.key : key;
        return !!this.#access(key);
    }

    async get(key) {
        const isSelector = typeof key === 'object' && key;
        key = isSelector ? key.key : key;

        const fieldNode = this.#access(key);
        if (!fieldNode) return;

        return isSelector ? fieldNode : fieldNode.value;
    }

    async set(key, value, options = {}) {
        let rest, event;
        ({ key, value, rest, event } = this._resolveSet(key, value, options));

        this.#saveNode(key, { value, ...rest });

        // Fire events locally + across tabs
        this.#channel?.postMessage(event);
        await this._fire(event);
    }

    async patch(obj = null, options = {}) {
        let { data, event } = this._resolveInputPatch(obj, options);

        if (options.replace) {
            for (let i = this.#storage.length - 1; i >= 0; i--) {
                const k = this.#storage.key(i);
                if (this.#ownsStorageKey(k)) {
                    this.#storage.removeItem(k);
                }
            }
        }

        for (const [key, fieldNode] of Object.entries(data)) {
            const storedNode = { ...fieldNode };
            this.#saveNode(key, storedNode);
        }

        this.#channel?.postMessage(event);
        await this._fire(event);
    }

    async delete(key, options = {}) {
        let event;
        ({ key, event } = this._resolveDelete(key, options));

        this.#storage.removeItem(this.#fullKey(key));

        this.#channel?.postMessage(event);
        await this._fire(event);
    }

    async clear(options = {}) {
        const { event } = this._resolveClear(options);

        // Remove only keys within this KV path prefix
        for (let i = this.#storage.length - 1; i >= 0; i--) {
            const k = this.#storage.key(i);
            if (this.#ownsStorageKey(k)) {
                this.#storage.removeItem(k);
            }
        }

        this.#channel?.postMessage(event);
        await this._fire(event);
    }
}
