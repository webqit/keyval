import fs from 'fs/promises';
import Path from 'path';
import { KV } from './KV.js';
export { KV };

export class FileKV extends KV {

    #file;

    constructor({ dir = '.webqit_keyval', ...options }) {
        super(options);
        const safePath = this.path.map(p =>
            p.replace(/[\/\\]/g, '_')
        );
        this.#file = Path.join(dir, ...safePath) + '.json';
    }

    /* ---------- internals ---------- */

    async #load() {
        try {
            const data = await fs.readFile(this.#file, 'utf8');
            return this._deserialize(data);
        } catch (e) {
            if (e.code === 'ENOENT') return {};
            throw e;
        }
    }

    async #access(data, key) {
        const fieldNode = data[key];
        if (!fieldNode || this._expired(fieldNode)) {
            if (fieldNode) {
                delete data[key];
                await this.#save(data);
            }
            return;
        }
        return fieldNode;
    }

    async #save(data) {
        await fs.mkdir(Path.dirname(this.#file), { recursive: true });
        await fs.writeFile(this.#file, this._serialize(data, null, 2), 'utf8');
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
        const data = await this.#load();
        const out = [];
        for (const k of Object.keys(data)) {
            const fieldNode = await this.#access(data, k);
            if (!fieldNode) continue;
            out.push([k, meta ? fieldNode : fieldNode.value]);
        }
        return out;
    }

    async has(key) {
        key = typeof key === 'object' && key ? key.key : key;

        const data = await this.#load();
        const fieldNode = await this.#access(data, key);

        if (!fieldNode) return false;
        return true;
    }

    async get(key) {
        const isSelector = typeof key === 'object' && key;
        key = isSelector ? key.key : key;

        const data = await this.#load();
        const fieldNode = await this.#access(data, key);
        if (!fieldNode) return;

        if (isSelector) return fieldNode;
        return fieldNode.value;
    }

    async set(key, value, options = {}) {
        let rest, event;
        ({ key, value, rest, event } = this._resolveSet(key, value, options));

        const data = await this.#load();
        data[key] = { value, ...rest };
        await this.#save(data);

        await this._fire(event);
    }

    async patch(obj = null, options = {}) {
        let { data, event } = this._resolveInputPatch(obj, options);
        if (!options.replace) {
            const existingData = await this.#load();
            Object.assign(existingData, data);
            data = existingData;
        }
        await this.#save(data);
        await this._fire(event);
    }

    async delete(key, options = {}) {
        let event;
        ({ key, event } = this._resolveDelete(key, options));

        const data = await this.#load();
        delete data[key];
        await this.#save(data);

        await this._fire(event);
    }

    async clear(options = {}) {
        const { event } = this._resolveClear(options);

        await this.#save({});
        await this._fire(event);
    }
}
