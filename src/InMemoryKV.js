import { KV } from './KV.js';
export { KV };

export class InMemoryKV extends KV {

    #exists(node) {
        if (!node?.subtree.has('value')) return;
        const expires = node.subtree.get('expires');
        if (expires && expires <= Date.now()) {
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

    /* ---------- public API ---------- */

    async close() { }

    async count() { return (await this.keys()).length; }

    async keys() { return (await this.#entries()).map(([k]) => k); }

    async values() { return (await this.#entries()).map(([, e]) => e); }

    async entries() { return await this.#entries(); }

    async #entries(dump = false) {
        return [...(this._path(this.path)?.subtree.entries() || [])]
            .filter(([, node]) => this.#exists(node))
            .map(([key, node]) => [key, dump ? Object.fromEntries(node.subtree) : node.subtree.get('value')]);
    }

    async has(key) {
        key = typeof key === 'object' && key ? key.key : key;
        const fieldPath = this.path.concat(key);
        return !!this.#exists(this._path(fieldPath, false));
    }

    async get(key) {
        const isSelector = typeof key === 'object' && key;
        key = isSelector ? key.key : key;

        const fieldPath = this.path.concat(key);
        const node = this._path(fieldPath, false);

        if (isSelector) return Object.fromEntries(node.subtree);
        return this.#exists(node)?.subtree.get('value');
    }

    async set(key, value) {
        let rest, event;
        ({ key, value, rest, event } = this._resolveSet(key, value));

        const fieldPath = this.path.concat(key);
        const node = this._path(fieldPath);
        node.subtree.set('value', value);
        Object.entries(rest).forEach(([k, v]) => node.subtree.set(k, v));

        await this._fire(event);
    }

    async delete(key) {
        key = typeof key === 'object' && key ? key.key : key;

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
        const event = { type: 'clear' };
        for (const node of this._path(this.path, false)?.subtree.values() || []) {
            this.#drop(node);
        }
        await this._fire(event);
    }

    async json(arg = null, options = {}) {
        if (arg && arg !== true) {
            const { data, event } = this._resolveInputJson(arg, options);

            if (!options.merge) {
                for (const node of this._path(this.path, false)?.subtree.values() || []) {
                    this.#drop(node);
                }
            }

            for (const [key, value] of Object.entries(data)) {
                const fieldPath = this.path.concat(key);
                const node = this._path(fieldPath);
                Object.entries(value).forEach(([k, v]) => node.subtree.set(k, v));
            }

            await this._fire(event);
            return;
        }

        return Object.fromEntries(await this.#entries(arg));
    }
}