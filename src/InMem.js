import { Store } from './Store.js';
export { Store };

export class InMem extends Store {

    async keys() { return [...(this._path(this.path)?.subtree.keys() || [])]; }
    async values() { return [...(this._path(this.path)?.subtree.values() || [])].map((e) => e.subtree.get('value')); }
    async entries() { return [...(this._path(this.path)?.subtree.entries() || [])].map(([k, e]) => [k, e.subtree.get('value')]); }
    async count() { return this.keys().then((k) => k.length); }

    async has(key) {
        const fieldPath = this.path.concat(key);
        return !!this._path(fieldPath, false)?.subtree.has('value');
    }

    async get(key) {
        const fieldPath = this.path.concat(key);
        return this._path(fieldPath, false)?.subtree.get('value');
    }

    async getHash(key) {
        const fieldPath = this.path.concat(key);
        return Object.fromEntries(this._path(fieldPath, false)?.subtree);
    }

    async set(key, value) {
        const event = {
            type: 'set',
            key,
            value,
        };
        const fieldPath = this.path.concat(key);
        this._path(fieldPath).subtree.set('value', value);
        await this._fire(event);
    }

    async setHash(key, { value, ...properties } = {}) {
        const fieldPath = this.path.concat(key);
        const map = this._path(fieldPath).subtree;
        for (const k in properties) {
            map.set(k, properties[k]);
        }
        return await this.set(key, value);
    }

    async delete(key) {
        const event = {
            type: 'delete',
            key,
        };
        const fieldPath = this.path.concat(key);
        this._path(fieldPath).subtree.clear();
        await this._fire(event);
    }

    async clear() {
        const event = {
            type: 'clear',
        };
        for (const field of this._path(this.path)?.subtree.values() || []) {
            field.subtree.clear();
        }
        await this._fire(event);
    }
}