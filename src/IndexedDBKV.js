import { KV } from './KV.js';
export { KV };

export class IndexedDBKV extends KV {

    static #dbCache = new Map;

    #db;
    #dbName;
    #storeName;
    #channel;

    constructor({ dbName = 'webqit_keyval', channel = null, ...options }) {
        super(options);
        this.#dbName = dbName;
        this.#storeName = this.path.join(':');
        if (channel) {
            this.#channel = new BroadcastChannel(channel);
        }
    }

    /* ---------- internal helpers ---------- */

    #attachDBLifecycle(db) {
        db.onversionchange = () => {
            // Another tab wants to upgrade the DB
            db.close();

            // Invalidate local handle so next op reopens
            IndexedDBKV.#dbCache.delete(this.#dbName);

            this.#db = null;
        };
    }

    async #open() {
        const cacheKey = this.#dbName;

        if (IndexedDBKV.#dbCache.has(cacheKey)) {
            this.#db = IndexedDBKV.#dbCache.get(cacheKey);
            if (this.#db.objectStoreNames.contains(this.#storeName)) {
                return this.#db;
            }
            // store missing → upgrade required
        }

        const openWithUpgrade = async (version) => {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(this.#dbName, version);

                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(this.#storeName)) {
                        db.createObjectStore(this.#storeName);
                    }
                };

                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        };

        // First open: get current version
        const initialDB = await new Promise((resolve, reject) => {
            const req = indexedDB.open(this.#dbName);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        if (!initialDB.objectStoreNames.contains(this.#storeName)) {
            const nextVersion = initialDB.version + 1;
            initialDB.close();
            this.#db = await openWithUpgrade(nextVersion);
        } else {
            this.#db = initialDB;
        }

        IndexedDBKV.#dbCache.set(cacheKey, this.#db);
        this.#attachDBLifecycle(this.#db);
        return this.#db;
    }

    #tx(mode = 'readonly') {
        return this.#db
            .transaction(this.#storeName, mode)
            .objectStore(this.#storeName);
    }

    /* ---------- public API ---------- */

    async close() {
        this.#channel?.close();
        this.#db?.close();

        IndexedDBKV.#dbCache.delete(this.#dbName);
        this.#db = null;

        await super.close();
    }

    async count() { return (await this.keys()).length; }

    async keys() { return (await this.#entries()).map(([k]) => k); }

    async values() { return (await this.#entries()).map(([, e]) => e); }

    async entries() { return await this.#entries(); }

    async #entries(dump = false) {
        await this.#open();
        return new Promise((resolve, reject) => {
            const tx = this.#db.transaction(this.#storeName, 'readonly');
            const store = tx.objectStore(this.#storeName);

            const valuesReq = store.getAll();
            const keysReq = store.getAllKeys();

            let values, keys;

            valuesReq.onsuccess = () => { values = valuesReq.result; };
            keysReq.onsuccess = () => { keys = keysReq.result; };

            tx.oncomplete = () => {
                resolve(
                    keys
                        .map((k, i) => [k, values[i]])
                        .filter(([, e]) => !this._expired(e))
                        .map(([k, e]) => [k, dump ? e : e.value])
                );
            };

            tx.onerror = () => reject(tx.error);
        });
    }

    async has(key) {
        key = typeof key === 'object' && key ? key.key : key;
        return (await this.keys()).includes(key);
    }

    async get(key) {
        const isSelector = typeof key === 'object' && key;
        key = isSelector ? key.key : key;

        await this.#open();
        return new Promise((resolve, reject) => {
            const req = this.#tx().get(key);
            req.onsuccess = async () => {
                const node = req.result;
                if (!node || this._expired(node)) {
                    if (node) {
                        const tx = this.#db.transaction(this.#storeName, 'readwrite');
                        tx.objectStore(this.#storeName).delete(key);
                        tx.oncomplete = () => resolve();
                        tx.onerror = () => reject(tx.error);
                    } else resolve();
                } else {
                    resolve(isSelector ? node : node.value);
                }
            };
            req.onerror = () => reject(req.error);
        });
    }

    async set(key, value) {
        let rest, event;
        ({ key, value, rest, event } = this._resolveSet(key, value));

        await this.#open();
        return new Promise((resolve, reject) => {
            const tx = this.#db.transaction(this.#storeName, 'readwrite');
            tx.objectStore(this.#storeName)
                .put({ value, ...rest }, key);

            tx.oncomplete = async () => {
                await this._fire(event);
                this.#channel?.postMessage(event);
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    async delete(key) {
        key = typeof key === 'object' && key ? key.key : key;

        const event = {
            type: 'delete',
            key,
            path: this.path,
            origins: this.origins,
            timestamp: Date.now(),
        };

        await this.#open();
        return new Promise((resolve, reject) => {
            const tx = this.#db.transaction(this.#storeName, 'readwrite');
            tx.objectStore(this.#storeName).delete(key);

            tx.oncomplete = async () => {
                await this._fire(event);
                this.#channel?.postMessage(event);
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    async clear() {
        const event = {
            type: 'clear',
            path: this.path,
            origins: this.origins,
            timestamp: Date.now(),
        };

        await this.#open();
        return new Promise((resolve, reject) => {
            const tx = this.#db.transaction(this.#storeName, 'readwrite');
            tx.objectStore(this.#storeName).clear();

            tx.oncomplete = async () => {
                await this._fire(event);
                this.#channel?.postMessage(event);
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    async json(arg = null, options = {}) {
        if (arg && arg !== true) {
            const { data, event } = this._resolveInputJson(arg, options);

            await this.#open();
            return new Promise((resolve, reject) => {
                const tx = this.#db.transaction(this.#storeName, 'readwrite');

                const store = tx.objectStore(this.#storeName);
                if (!options.merge) {
                    store.clear();
                }

                for (const [key, value] of Object.entries(data)) {
                    store.put(value, key);
                }

                tx.oncomplete = async () => {
                    await this._fire(event);
                    this.#channel?.postMessage(event);
                    resolve();
                };
                tx.onerror = () => reject(tx.error);
            });
        }

        return Object.fromEntries(await this.#entries(arg));
    }
}
