import { KV } from './KV.js';
export { KV };

export class InMemoryKV extends KV {

    #touch(fieldNode) {
        if (!fieldNode?.subtree.has('value')) return;
        const expires = fieldNode.subtree.get('expires');
        if (expires && expires <= Date.now()) {
            this.#drop(fieldNode);
            return;
        }
        return fieldNode;
    }

    #drop(fieldNode) {
        if (fieldNode && !fieldNode.entries.size) {
            fieldNode.dispose();
        } else {
            fieldNode?.subtree.clear();
        }
    }

    /* ---------- public API ---------- */

    async close() { }

    async count() { return (await this.keys()).length; }

    async keys() { return (await this.#entries()).map(([k]) => k); }

    async values() { return (await this.#entries()).map(([, e]) => e); }

    async entries() { return await this.#entries(); }

    async json({ meta = false } = {}) {
        return Object.fromEntries(await this.#entries({ meta }));
    }

    async #entries({ meta = false } = {}) {
        return [...(this._path(this.path)?.subtree.entries() || [])]
            .filter(([, fieldNode]) => this.#touch(fieldNode))
            .map(([key, fieldNode]) => [key, meta ? Object.fromEntries(fieldNode.subtree) : fieldNode.subtree.get('value')]);
    }

    async has(key) {
        key = typeof key === 'object' && key ? key.key : key;
        const fieldPath = this.path.concat(key);
        return !!this.#touch(this._path(fieldPath, false));
    }

    async get(key) {
        const isSelector = typeof key === 'object' && key;
        key = isSelector ? key.key : key;

        const fieldPath = this.path.concat(key);
        const fieldNode = this.#touch(this._path(fieldPath, false));
        if (!fieldNode) return;

        if (isSelector) return Object.fromEntries(fieldNode.subtree);
        return fieldNode.subtree.get('value');
    }

    async set(key, value, options = {}) {
        let rest, event;
        ({ key, value, rest, event } = this._resolveSet(key, value, options));

        const fieldPath = this.path.concat(key);
        const fieldNode = this._path(fieldPath);
        fieldNode.subtree.set('value', value);
        Object.entries(rest).forEach(([k, v]) => fieldNode.subtree.set(k, v));

        await this._fire(event);
    }

    async patch(obj = null, options = {}) {
        const { data, event } = this._resolveInputPatch(obj, options);

        if (options.replace) {
            for (const fieldNode of this._path(this.path, false)?.subtree.values() || []) {
                this.#drop(fieldNode);
            }
        }

        for (const [key, value] of Object.entries(data)) {
            const fieldPath = this.path.concat(key);
            const fieldNode = this._path(fieldPath);
            Object.entries(value).forEach(([k, v]) => fieldNode.subtree.set(k, v));
        }

        await this._fire(event);
    }

    async delete(key, options = {}) {
        let event;
        ({ key, event } = this._resolveDelete(key, options));

        const fieldPath = this.path.concat(key);
        const fieldNode = this._path(fieldPath, false);
        this.#drop(fieldNode);

        await this._fire(event);
    }

    async clear(options = {}) {
        const { event } = this._resolveClear(options);

        for (const fieldNode of this._path(this.path, false)?.subtree.values() || []) {
            this.#drop(fieldNode);
        }
        await this._fire(event);
    }
}