import { KV } from './KV.js';
import { CookieStoreKV } from './CookieStoreKV.js';
import { IndexedDBKV } from './IndexedDBKV.js';
import { InMemoryKV } from './InMemoryKV.js';
import { WebStorageKV } from './WebStorageKV.js';

if (!globalThis.webqit) {
    globalThis.webqit = {};
}

Object.assign(globalThis.webqit, {
    KV,
    CookieStoreKV,
    IndexedDBKV,
    InMemoryKV,
    WebStorageKV,
});