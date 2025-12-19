import { KV } from './KV.js';
export { KV };

export class InMemoryKV extends KV {

    #exists(node) {
        if (!node?.subtree.has('value')) return;
        const expiresAt = node.subtree.get('expiresAt');
        if (expiresAt && expiresAt <= Date.now()) {
            this.#drop(node);
            return;
        }
        return node;
    }

    #drop(node) {
        if (node && !node.entries.size) {
            node.dispose();
        } else {
            node?.subtree.clear();
        }
    }

    async keys() {
        return [...(this._path(this.path)?.subtree.entries() || [])]
            .filter(([, node]) => this.#exists(node))
            .map(([key]) => key);
    }
    
    async values() {
        return [...(this._path(this.path)?.subtree.values() || [])]
            .filter((node) => this.#exists(node))
            .map((node) => node.subtree.get('value'));
    }
    
    async entries() { return await this.#entries(); }
    
    async #entries(dump = false) {
        return [...(this._path(this.path)?.subtree.entries() || [])]
            .filter(([, node]) => this.#exists(node))
            .map(([key, node]) => [key, dump ? Object.fromEntries(node.subtree) : node.subtree.get('value')]);
    }

    async count() { return this.keys().then((k) => k.length); }

    async has(key) {
        const fieldPath = this.path.concat(key);
        return !!this.#exists(this._path(fieldPath, false));
    }

    async get(key) {
        const fieldPath = this.path.concat(key);
        const node = this._path(fieldPath, false);
        return this.#exists(node)?.subtree.get('value');
    }

    async set(key, value) {
        const event = {
            type: 'set',
            key,
            value,
        };
        const fieldPath = this.path.concat(key);
        const node = this._path(fieldPath);
        node.subtree.set('value', value);
        if (this.ttl) {
            node.subtree.set('expiresAt', Date.now() + this.ttl * 1000);
        }
        await this._fire(event);
    }

    async delete(key) {
        const event = {
            type: 'delete',
            key,
        };
        const fieldPath = this.path.concat(key);
        const node = this._path(fieldPath, false);
        this.#drop(node);
        await this._fire(event);
    }

    async clear() {
        const event = {
            type: 'clear',
        };
        for (const node of this._path(this.path, false)?.subtree.values() || []) {
            this.#drop(node);
        }
        await this._fire(event);
    }

    async json(arg = null, options = {}) {
        if (arg && arg !== true) {
            if (typeof arg !== 'object') {
                throw new Error(`Argument must be a valid JSON object`);
            }

            const expiresAt = this.ttl ? Date.now() + this.ttl * 1000 : null;
            const unhashed = {};
            const data = {};
            for (const [key, value] of Object.entries(arg)) {
                if (options.hashed && !(value && typeof value === 'object')) {
                    throw new Error(`A hash expected for field ${key}`);
                }
                unhashed[key] = options.hashed ? value.value : value;
                data[key] = options.hashed
                    ? { value: undefined, ...value, expiresAt }
                    : { value, expiresAt };
            }

            const event = {
                type: 'json',
                data: unhashed,
                options,
                path: this.path,
                origins: this.origins,
                timestamp: Date.now(),
            };

            if (!options.merge) {
                for (const node of this._path(this.path, false)?.subtree.values() || []) {
                    this.#drop(node);
                }
            }

            for (const [key, value] of Object.entries(data)) {
                const fieldPath = this.path.concat(key);
                const node = this._path(fieldPath);
                node.subtree = new Map(Object.entries(value));
            }

            await this._fire(event);
            return;
        }

        return Object.fromEntries(await this.#entries(arg));
    }
}