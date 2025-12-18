import fs from 'fs/promises';
import Path from 'path';
import { Store } from './Store.js';
export { Store };

export class FileStore extends Store {

    #file;

    constructor({ dir = '.webqit_store', ...options }) {
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

    #wrapValue(value) {
        return {
            value,
            expiresAt: this.ttl ? Date.now() + this.ttl * 1000 : null,
        };
    }

    #expired(node) {
        return node?.expiresAt && node.expiresAt <= Date.now();
    }

    /* ---------- public API ---------- */

    async keys() {
        const data = await this.#load();
        return Object.entries(data)
            .filter(([, e]) => !this.#expired(e))
            .map(([k]) => k);
    }

    async values() {
        const data = await this.#load();
        return Object.values(data)
            .filter((e) => !this.#expired(e))
            .map((e) => e.value);
    }

    async entries() { return await this.#entries(); }

    async #entries(dump = false) {
        const data = await this.#load();
        return Object.entries(data)
            .filter(([, e]) => !this.#expired(e))
            .map(([k, e]) => [k, dump ? e : e.value]);
    }

    async count() { return (await this.keys()).length; }

    async has(key) {
        const data = await this.#load();
        const node = data[key];

        if (!node || this.#expired(node)) {
            return false;
        }

        return true;
    }

    async get(key) {
        const data = await this.#load();
        const node = data[key];

        if (!node || this.#expired(node)) {
            if (node) {
                delete data[key];
                await this.#save(data);
            }
            return undefined;
        }

        return node.value;
    }

    async set(key, value) {
        const event = { type: 'set', key, value };
        const data = await this.#load();
        data[key] = this.#wrapValue(value);
        await this.#save(data);
        await this._fire(event);
    }

    async delete(key) {
        const event = { type: 'delete', key };
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
            if (typeof arg !== 'object') {
                throw new Error(`Argument must be a valid JSON object`);
            }

            const unhashed = {};
            const data = options.merge ? await this.#load() : {};
            for (const [key, value] of Object.entries(arg)) {
                if (options.hashed && !(value && typeof value === 'object')) {
                    throw new Error(`A hash expected for field ${key}`);
                }
                unhashed[key] = options.hashed ? value.value : value;
                data[key] = options.hashed
                    ? { ...value, ...this.#wrapValue(value.value) }
                    : this.#wrapValue(value);
            }
        
            await this.#save(data);
            const event = { type: 'json', data: unhashed, options };
            await this._fire(event);
            return;
        }

        return Object.fromEntries(await this.#entries(arg));
    }
}
