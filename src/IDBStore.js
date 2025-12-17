import { Store } from './Store.js';
export { Store };

export class IDBStore extends Store {

    static #dbCache = new Map;

    #db;
    #dbName;
    #storeName;
    #channel;

    constructor({ dbName = 'webqit_store', channel = null, ...options }) {
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
            IDBStore.#dbCache.delete(this.#dbName);

            this.#db = null;
        };
    }

    async #open() {
        const cacheKey = this.#dbName;

        if (IDBStore.#dbCache.has(cacheKey)) {
            this.#db = IDBStore.#dbCache.get(cacheKey);
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

        IDBStore.#dbCache.set(cacheKey, this.#db);
        this.#attachDBLifecycle(this.#db);
        return this.#db;
    }

    #tx(mode = 'readonly') {
        return this.#db
            .transaction(this.#storeName, mode)
            .objectStore(this.#storeName);
    }

    #isExpired(node) {
        return node?.expiresAt && node.expiresAt <= Date.now();
    }

    #wrapValue(value) {
        return {
            value,
            expiresAt: this.ttl ? Date.now() + this.ttl * 1000 : null,
        };
    }

    /* ---------- public API ---------- */

    async close() {
        this.#channel?.close();
        this.#db?.close();

        IDBStore.#dbCache.delete(this.#dbName);
        this.#db = null;

        await super.close();
    }

    async has(key) {
        const v = await this.get(key);
        return v !== undefined;
    }

    async get(key) {
        await this.#open();
        return new Promise((resolve, reject) => {
            const req = this.#tx().get(key);
            req.onsuccess = async () => {
                const node = req.result;
                if (!node || this.#isExpired(node)) {
                    if (node) await this.delete(key);
                    resolve(undefined);
                } else {
                    resolve(node.value);
                }
            };
            req.onerror = () => reject(req.error);
        });
    }

    async set(key, value) {
        await this.#open();
        const event = {
            type: 'set',
            key,
            value,
            path: this.path,
            origins: this.origins,
            timestamp: Date.now(),
        };

        return new Promise((resolve, reject) => {
            const tx = this.#db.transaction(this.#storeName, 'readwrite');
            tx.objectStore(this.#storeName)
                .put(this.#wrapValue(value), key);

            tx.oncomplete = async () => {
                await this._fire(event);
                this.#channel?.postMessage(event);
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    async delete(key) {
        await this.#open();
        const event = {
            type: 'delete',
            key,
            path: this.path,
            origins: this.origins,
            timestamp: Date.now(),
        };

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
        await this.#open();
        const event = {
            type: 'clear',
            path: this.path,
            origins: this.origins,
            timestamp: Date.now(),
        };

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

    async keys() {
        await this.#open();
        return new Promise((resolve, reject) => {
            const req = this.#tx().getAllKeys();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async values() {
        await this.#open();
        return new Promise((resolve, reject) => {
            const req = this.#tx().getAll();
            req.onsuccess = () => {
                resolve(
                    req.result
                        .filter((e) => !this.#isExpired(e))
                        .map((e) => e.value)
                );
            };
            req.onerror = () => reject(req.error);
        });
    }

    async entries() {
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
                        .filter(([, e]) => !this.#isExpired(e))
                        .map(([k, e]) => [k, e.value])
                );
            };

            tx.onerror = () => reject(tx.error);
        });
    }

    async count() {
        const entries = await this.entries();
        return entries.length;
    }
}
