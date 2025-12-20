export class KV {

    static create(options) { return new this(options); }

    #path;
    #ttl;
    #registry;
    #origins;
    #options;

    get path() { return this.#path; }
    get ttl() { return this.#ttl; }
    get registry() { return this.#registry; }
    get origins() { return this.#origins; }
    get options() { return this.#options; }
    get keyLevelExpires() { return true; }

    constructor({ path, ttl = 0, registry = new Map, origins = [], ...options } = {}) {
        this.#path = path;
        this.#ttl = ttl;
        this.#registry = registry;
        this.#origins = origins;
        this.#options = options;
    }

    _path(path, create = true) {
        if (!Array.isArray(path) || !path.length) {
            throw new Error(`Path length cannot be 0`);
        }
        /*
        base -> {
            subtree: uuid -> {
                    subtree: field -> {
                            subtree,
                            entries: Set<fn>
                        },
                    entries: Set<fn>
                },
            entries: Set<fn>
        }
        */
        return path.reduce((node, key, i) => {
            if (create && !node?.subtree.has(key)) {
                const subtree = new Map;
                const entries = new Set;
                const dispose = () => {
                    node.subtree.delete(key);
                    if (!node.subtree.size && !node.entries?.size) {
                        //node.dispose?.();
                    }
                };
                node.subtree.set(key, { subtree, entries, context: node, dispose });
            }
            if (create === 0 && i && !node?.subtree.has(key)) {
                return node;
            }
            return node?.subtree.get(key);
        }, { subtree: this.#registry });
    }

    _observe(path, callback, options = {}) {
        const node = this._path(path, true);

        const dispose = () => {
            node.entries.delete(subscription);
            if (!node.entries.size) {
                node.dispose();
            }
        };

        const subscription = { callback, options, origins: this.#origins, dispose };
        node.entries.add(subscription);

        if (options.signal) {
            options.signal.addEventListener('abort', dispose);
        }

        return dispose;
    }

    async _fire({ path = this.#path, origins = this.#origins, timestamp = Date.now(), ...event }) {
        if (!['set', 'delete', 'clear', 'json'].includes(event.type)) {
            throw new Error(`Invalid event`);
        }
        const node = this._path(event.key ? path.concat(event.key) : path, 0);
        if (!node) return;

        const entries = [];
        let _node = node;
        do {
            entries.push(..._node.entries);
        } while ((_node = _node.context) && _node.entries);

        const returnValues = [];
        const fire = (subscription, _event = event) => {
            const { callback, options, origins: subscriptionOrigins, dispose } = subscription;

            let i = origins.length - 1;
            for (; i >= (options.scope || 0); i--) {
                if (subscriptionOrigins[i] !== origins[i]) return;
            }

            returnValues.push(callback({ ..._event, path, scope: i + 1, origins, timestamp }));

            if (options.once) dispose();
        };

        entries.forEach((subscription) => fire(subscription));

        if (event.type === 'clear' || event.type === 'json') {
            const node = this._path(path, false);
            for (const [key, _node] of node?.subtree.entries() || []) {

                let _event = { type: 'delete', key };
                if (event.type === 'json' && event.data && typeof event.data === 'object') {
                    if (key in event.data) {
                        _event = { type: 'set', key, value: event.data[key] };
                    } else if (event.options?.merge) {
                        continue;
                    }
                }

                for (const subscription of _node.entries) {
                    fire(subscription, _event);
                }
            }
        }

        await Promise.all(returnValues);
    }

    _normalizeExpires(expires) {
        if (!(expires ?? false)) return;

        // Date instance
        if (expires instanceof Date) {
            return expires.getTime();
        }

        // Numeric timestamp (seconds or ms)
        if (typeof expires === 'number') {
            // Heuristic: seconds are too small to be ms
            return expires < 1e12
                ? expires * 1000
                : expires;
        }

        // ISO date string
        if (typeof expires === 'string') {
            const ts = Date.parse(expires);
            if (!Number.isNaN(ts)) return ts;
        }

        throw new TypeError(`Invalid expires value: ${expires}`);
    }

    _expired(node) {
        if (!this.ttl || !this.keyLevelExpires) return false;
        return !!(node?.expires && node.expires <= Date.now());
    }

    _resolveSet(key, value) {
        const isSelector = typeof key === 'object' && key;
        let rest;
        ({ key, value, ...rest } = isSelector ? key : { key, value });
        if (this.ttl && this.keyLevelExpires) {
            if (!rest.expires) {
                // Auto-derived from top-level TTL
                rest.expires = Date.now() + this.ttl;
            } else {
                // Normalize expires
                rest.expires = this._normalizeExpires(rest.expires);
            }
        }

        const event = {
            type: 'set',
            key,
            value,
            path: this.path,
            origins: this.origins,
            timestamp: Date.now(),
        };

        return { key, value, rest, event };
    }

    _resolveInputJson(arg, options) {
        if (typeof arg !== 'object') {
            throw new Error(`Argument must be a valid JSON object`);
        }

        const expires = this.ttl && this.keyLevelExpires ? Date.now() + this.ttl : null;
        const unhashed = {};
        const data = {};
        for (const [key, value] of Object.entries(arg)) {
            if (options.hashed && !(value && typeof value === 'object')) {
                throw new Error(`A hash expected for field ${key}`);
            }
            unhashed[key] = options.hashed ? value.value : value;
            data[key] = options.hashed ? value : { value };
            if (expires && !data[key].expires) {
                // Auto-derived from top-level TTL
                data[key].expires = expires;
            } else if (this.ttl && this.keyLevelExpires && data[key].expires) {
                // Normalize expires
                data[key].expires = this._normalizeExpires(data[key].expires);
            }
        }

        const event = {
            type: 'json',
            data: unhashed,
            options,
            path: this.path,
            origins: this.origins,
            timestamp: Date.now(),
        };

        return { data, event };
    }

    // ----------

    observe(key, callback, options = {}) {
        if (typeof key === 'function') {
            options = callback || {};
            callback = key;
            key = [];
        }
        const fieldPath = this.#path.concat(key);
        return this._observe(fieldPath, callback, options);
    }

    cleanup() { this._path(this.#path, false)?.dispose(); }

    async close() { }
}