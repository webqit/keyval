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
            return JSON.parse(data);
        } catch (e) {
            if (e.code === 'ENOENT') return {};
            throw e;
        }
    }

    async #save(data) {
        await fs.mkdir(Path.dirname(this.#file), { recursive: true });
        await fs.writeFile(this.#file, JSON.stringify(data, null, 2), 'utf8');
    }

    /* ---------- public API ---------- */

    async close() { }

    async count() { return (await this.keys()).length; }

    async keys() { return (await this.#entries()).map(([k]) => k); }

    async values() { return (await this.#entries()).map(([, e]) => e); }

    async entries() { return await this.#entries(); }

    async #entries(dump = false) {
        const data = await this.#load();
        return Object.entries(data)
            .filter(([, e]) => !this._expired(e))
            .map(([k, e]) => [k, dump ? e : e.value]);
    }

    async has(key) {
        key = typeof key === 'object' && key ? key.key : key;

        const data = await this.#load();
        const node = data[key];

        if (!node || this._expired(node)) return false;
        return true;
    }

    async get(key) {
        const isSelector = typeof key === 'object' && key;
        key = isSelector ? key.key : key;

        const data = await this.#load();
        const node = data[key];

        if (!node || this._expired(node)) {
            if (node) {
                delete data[key];
                await this.#save(data);
            }
            return undefined;
        }

        if (isSelector) return node;
        return node.value;
    }

    async set(key, value) {
        let rest, event;
        ({ key, value, rest, event } = this._resolveSet(key, value));

        const data = await this.#load();
        data[key] = { value, ...rest };
        await this.#save(data);

        await this._fire(event);
    }

    async delete(key) {
        key = typeof key === 'object' && key ? key.key : key;

        const event = {
            type: 'delete',
            key
        };

        const data = await this.#load();
        delete data[key];
        await this.#save(data);

        await this._fire(event);
    }

    async clear() {
        const event = { type: 'clear' };
        await this.#save({});
        await this._fire(event);
    }

    async json(arg = null, options = {}) {
        if (arg && arg !== true) {
            let { data, event } = this._resolveInputJson(arg, options);
            if (options.merge) {
                const existingData = await this.#load();
                Object.assign(existingData, data);
                data = existingData;
            }
            await this.#save(data);
            await this._fire(event);
            return;
        }

        return Object.fromEntries(await this.#entries(arg));
    }
}
