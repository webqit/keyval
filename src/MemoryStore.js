import { Store } from './Store.js';
export { Store };

export class MemoryStore extends Store {

    #exists(node) {
        if (!node?.subtree.has('value')) return;
        const expiresAt = node.subtree.get('expiresAt');
        if (expiresAt && expiresAt <= Date.now()) {
            node.subtree.clear();
            return;
        }
        return node;
    }

    async keys() { return [...(this._path(this.path)?.subtree.entries() || [])].filter(([, node]) => this.#exists(node)).map(([key]) => key); }
    async values() { return [...(this._path(this.path)?.subtree.values() || [])].filter((node) => this.#exists(node)).map((node) => node.subtree.get('value')); }
    async entries() { return [...(this._path(this.path)?.subtree.entries() || [])].filter(([, node]) => this.#exists(node)).map(([key, node]) => [key, node.subtree.get('value')]); }
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

    async getHash(key) {
        const fieldPath = this.path.concat(key);
        const node = this._path(fieldPath, false);
        return Object.fromEntries(this.#exists(node)?.subtree || []);
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

    async setHash(key, { value, ...properties } = {}) {
        const fieldPath = this.path.concat(key);
        const node = this._path(fieldPath);
        for (const k in properties) {
            node.subtree.set(k, properties[k]);
        }
        return await this.set(key, value);
    }

    async delete(key) {
        const event = {
            type: 'delete',
            key,
        };
        const fieldPath = this.path.concat(key);
        this._path(fieldPath, false)?.subtree.clear();
        await this._fire(event);
    }

    async clear() {
        const event = {
            type: 'clear',
        };
        for (const node of this._path(this.path, false)?.subtree.values() || []) {
            node.subtree.clear();
        }
        await this._fire(event);
    }
}