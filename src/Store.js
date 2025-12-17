export class Store {

    static create(options) { return new this(options); }

    #path;
    #registry;
    #origins;

    get path() { return this.#path; }
    get registry() { return this.#registry; }
    get origins() { return this.#origins; }

    constructor({ path, registry = new Map, origins = [] } = {}) {
        this.#path = path;
        this.#registry = registry;
        this.#origins = origins;
    }

    _path(path, create = true) {
        if (!Array.isArray(path) || !path.length || path.length > this.#path.length + 1) {
            throw new Error(`Path length must be between 1 and ${this.#path.length + 1}`);
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
        return path.reduce((context, key, i) => {
            if (create === 0 && i && !context.subtree.has(key)) {
                return context;
            }
            if (create && !context.subtree.has(key)) {
                const subtree = new Map;
                const entries = new Set;
                const dispose = () => context.subtree.delete(key);
                context.subtree.set(key, { subtree, entries, context, dispose });
            }
            return context?.subtree.get(key);
        }, { subtree: this.#registry });
    }

    _observe(path, callback, options = {}) {
        const context = this._path(path, true);

        const dispose = () => {
            context.entries.delete(subscription);
            if (!context.entries.size) {
                context.dispose();
            }
        };

        const subscription = { callback, options, origins: this.#origins, dispose };
        context.entries.add(subscription);

        if (options.signal) {
            options.signal.addEventListener('abort', dispose);
        }

        return dispose;
    }

    async _fire({ path = this.#path, origins = this.#origins, timestamp = Date.now(), ...event }) {
        if (!['set', 'delete', 'clear'].includes(event.type)) {
            throw new Error(`Invalid event`);
        }
        const context = this._path(path, 0);
        if (!context) return;

        const entries = [];
        let _context = context;
        while (_context) {
            entries.push(..._context.entries);
            _context = _context.context;
        }

        const returnValues = [];
        const fire = (subscription, _path = path) => {
            const { callback, options, origins: subscriptionOrigins, dispose } = subscription;

            let i = this.#origins.length - 1;
            for (; i >= (options.scope || 0); i --) {
                if (subscriptionOrigins[i] !== this.#origins[i]) return;
            }

            returnValues.push(callback({ ...event, path: _path, scope: i + 1, origins, timestamp }));

            if (options.once) dispose();
        };

        entries.forEach(fire);

        if (event.type === 'clear') {
            const context = this._path(path, false);
            for (const [key, field] of context?.subtree.entries() || []) {
                for (const subscription of field.entries) {
                    fire(subscription, path.concat(key));
                }
            }
        }

        await Promise.all(returnValues);
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
}