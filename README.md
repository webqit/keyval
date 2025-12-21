# Keyval – _Simple Dictionary API for Modern Apps_

[![npm version][npm-version-src]][npm-version-href]<!--[![npm downloads][npm-downloads-src]][npm-downloads-href]-->
[![bundle][bundle-src]][bundle-href]
[![License][license-src]][license-href]

**Keyval** is a small key/value storage layer with a consistent API across environments and backends:

* **In-memory backend** (fast, ephemeral)
* **Browser storage backend** (WebStorage, IndexedDB, Cookie Store)
* **File storage backend** (Node.js)
* **Redis backend** (shared server-side storage)

It gives you a simple dictionary API for state—regardless of where that state physically lives.

---

## Install

```bash
npm i @webqit/keyval
```

---

## Imports

You import the implementation you need by subpath:

```js
import { InMemoryKV } from '@webqit/keyval/inmemory';
import { FileKV } from '@webqit/keyval/file';
import { WebStorageKV } from '@webqit/keyval/webstorage';
import { IndexedDBKV } from '@webqit/keyval/indexeddb';
import { CookieStoreKV } from '@webqit/keyval/cookiestore';
import { RedisKV } from '@webqit/keyval/redis';
```

Each implementation follows the same interface.

```js
const kv = new InMemoryKV({
  path: ['session', 'session-123'],
});

await kv.set('step', 1);
await kv.set('flags', { beta: true });

console.log(await kv.get('step'));  // 1
console.log(await kv.get('flags')); // { beta: true }
```

---

## Design concepts

Keyval is designed around at least four useful concepts.

### 1. Paths

The first thing you do is map an instance to a storage path:

```js
const kv = new InMemoryKV({
  path: ['session', 'session-123'],
});
```

This `path` defines a **storage namespace**.

A namespace can represent *anything meaningful in your system*:

* a user → `['user', userId]`
* a session → `['session', sessionId]`
* a request → `['request', requestId]`
* a tenant → `['tenant', tenantId]`
* a document → `['document', docId]`
* a workflow → `['workflow', workflowId]`
* a cache window → `['cache', cacheKey]`
* a logical subsystem → `['feature', featureName]`

Examples:

```js
// per-user state
new IndexedDBKV({ path: ['user', userId] });

// per-session state
new InMemoryKV({ path: ['session', sessionId] });

// per-tenant configuration
new RedisKV({ path: ['tenant', tenantId] });

// per-document draft
new WebStorageKV({ path: ['draft', docId] });
```

Whatever your path scheme or depth:

* everything written through the instance lives *under that namespace*
* everything read through the instance is isolated to that namespace
* clearing the instance clears *only that namespace*

### 2. Map-like interface

Each Keyval instance is like a simple JavaScript map – **a dictionary**:

```js
await kv.set('state', 'active');
await kv.set('flags', { beta: true });
```

But Keyval diverges from the `Map` contract in a few ways:

* Methods are async.
* An async `.count()` method is the equivalent of `Map.size`.
* No `.forEach()` method. You use `.entries()` instead.

And Keyval extends the contract with additional methods like `.observe()`, `.close()`, etc.

### 3. Field metadata

Keyval ensures a transparent mapping between what you set and what you get. But internally, each key is held as a **metadata object** containing the actual value and optional user-supplied metadata. This typically looks like:

```ts
{
  value: any,
  ...meta
}
```

This makes it possible to support field-level metadata when needed: 

```js
kv.set('key1', 22);
kv.set({ key: 'key1', value: 22, expires: Date.now() + 60 * 60 * 1000 });
```

Metadata remains unexposed until explicitly requested:

```js
console.log(await kv.get('key1')); // 22
console.log(await kv.get({ key: 'key1' })); // { value: 22, expires: ... }
```

You’ll see this concept again in the API section.

### 4. Universal model

Across KV types, you get the same API, and same mental model.

Swap the backend implementation — nothing else changes:

```js
import { RedisKV } from '@webqit/keyval/redis';

const kv = new RedisKV({
  path: ['user', 'user-123'],
  redisUrl: process.env.REDIS_URL,
});

await kv.set('state', { step: 2 });
```

This is the central promise of Keyval:
**you design your state model once, and choose the storage backend separately.**

---

## Usage concepts

Once an instance exists, these are the operations you’ll use most often:

```js
await kv.set(key, value);
await kv.get(key);
await kv.has(key);
await kv.delete(key);
await kv.clear();
```

For working with structured state:

```js
await kv.json({ a: 1, b: 2 });
const all = await kv.json();
```

For reacting to changes:

```js
kv.observe((event) => {
  console.log(event.type, event.key);
});
```

Everything else in the documentation builds on these primitives.

### Clearing an instance

When the lifecycle of the thing your instance represents ends, you can clear it in one operation:

```js
await kv.clear();
```

This removes **only** the data associated with `['session', 'session-123']`. Other sessions, users, or subsystems are unaffected.

This pattern is especially natural for:

* session teardown
* logout flows
* request-level caches
* workflow resets

### Working with structured state

Very often, the data to persist is a JSON object of multiple fields, not just a field value. Sometimes too, you want the whole dictionary returned as plain JSON object.

Keyval’s `json()` method lets you do that.

#### Writing multiple keys at once

```js
await kv.json({
  profile: { theme: 'dark', locale: 'en' },
  flags: { beta: true },
});
```

This **resets** the dictionary with new values in one operation.

If you want to **patch** the dictionary instead, use merge mode:

```js
await kv.json(
  { flags: { beta: false } },
  { merge: true }
);
```

This updates `flags` while leaving other keys untouched.

#### Reading the full dictionary

```js
const state = await kv.json();

console.log(state);
// {
//   profile: { theme: 'dark', locale: 'en' },
//   flags: { beta: true }
// }
```

To have each field return their full metadata, pass the boolean `true` to `.json()`:

```js
const state = await kv.json(true);
// {
//   profile: { value: { theme: 'dark', locale: 'en' }, expires: ... },
//   flags: { value: { beta: true }, expires: ... }
// }
```

### Observing changes

State is often shared between parts of a system: UI components, background tasks, request handlers, or sync processes.

Keyval provides a small but expressive observation API so you can react to changes.

#### Observing a specific key

```js
const stop = kv.observe('profile', (event) => {
  console.log(event.type, event.value);
});

await kv.set('profile', { theme: 'dark' });
// logs: set { theme: 'dark' }

stop();
```

This is ideal when a particular value drives behavior elsewhere in your app.

#### Observing the entire namespace

```js
const stop = kv.observe((event) => {
  console.log(event.type, event.key);
});

await kv.set('flags', { beta: true });
// logs: set flags

stop();
```

This is useful for:

* debugging
* synchronization
* derived state
* audit or logging pipelines

#### One-time observers and cancellation

Observers can be configured to auto-dispose:

```js
kv.observe('flags', (event) => {
  console.log('flags changed once:', event.value);
}, { once: true });
```

They can also be bound to an `AbortSignal`, which is especially convenient in async workflows:

```js
const controller = new AbortController();

kv.observe('state', handler, { signal: controller.signal });

// later
controller.abort();
```

#### Cross process observability

Many KV types support cross-process observability. This means that you can observe changes to a namespace from multiple processes – e.g. a KV instance in another worker, tab, or even another machine (for RedisKV).

Supporting implementations are: `RedisKV`, `WebStorageKV`, `CookieStoreKV`, `IndexedDBKV`.

**`RedisKV`**

`RedisKV` supports cross-process observability out of the box using Redis pub/sub. `RedisKV` instances operate globally in the channel name specified in the `options.channel` parameter. This is `null` by default. When not set, only local mutations are observed.

When set, multiple `RedisKV` instances connected to the same Redis server and channel will observe changes to the same namespace – even if they live on different machines. The `observe()` method lets you opt-in or out of global events:

```js
kv.observe((e) => {

}, { scope: 0/* only locaal events */ });
```

How it works: TODO

**`WebStorageKV`, `CookieStoreKV`, `IndexedDBKV`**

These KV types support cross-process observability out of the box using `BroadcastChannel`. Instances operate globally in the channel name specified in the `options.channel` parameter. This is `null` by default. When not set, only local mutations are observed.

When set, multiple instances connected to the same channel will observe changes to the same namespace – even if they live in different tabs or processes (e.g. different tabs, the Service Worker or a Web Worker vs the main browser window). The `observe()` method lets you opt-in or out of global events:

```js
kv.observe((e) => {

}, { scope: 0/* only locaal events */ });
```

How it works: TODO

### Expiry and lifetime management

Keyval supports expiry at two levels: **per-namespace TTL** and **field-level expiry**.

#### Per-namespace TTL

```js
import { InMemoryKV } from '@webqit/keyval/inmemory';

const kv = new InMemoryKV({
  path: ['request', 'req-98f3'],
  ttl: 5_000, // 5 seconds
});
```

The `ttl` option accepts:

* numeric time intervals (milliseconds)

This namespace and its fields will automatically expire after 5 seconds.

A value of zero (or a negative value) expires the namespace immediately.

#### Field-level expiry

On top of the namespace-level TTL, Keyval supports field-level expiry.

```js
await kv.set({
  key: 'challenge',
  value: 'abc123',
  expires: Date.now() + 60_000, // 1 minute
});
```

The `expires` field accepts:

* `Date`
* ISO date string
* numeric timestamps (milliseconds)

> Keyval normalizes these internally so you don’t have to.

This field will expire after 1 minute.

**Important:** Field-level expiry only takes effect when namespace-level `ttl` is set – even if `0`.

* `ttl` defines the *lifetime of the storage namespace*.
* `expires` defines the *lifetime of a field within that namespace*.

**Unless this condition is met, the `expires` metadata is not treated specially by Keyval.**

This rule applies consistently across **all KV types**, including Redis.

But since Redis does not natively have a per-field expiry behavior, Keyval requires an additional opt-in to field-level expiry for Redis instances: `{ fieldLevelExpiry: true }`.

```js
const kv = new RedisKV({
  path: ['user', userId],
  ttl: 60_000,
  fieldLevelExpiry: true,
});
```

When enabled:

* Field-level `expires` semantics take effect.
* On every `set()` or `json()` mutation, the namespace-level TTL is **re-applied/renewed**
* If a key has an `expires` later than the namespace-level TTL:

  * the namespace TTL is extended to ensure that the namespace lives as long as the key – and not expire *before* key expiry.
  * Other keys still expire according to their own `expires` or according to the original namespace-level TTL.

---

## Recipes

### 1. Session-scoped state (ephemeral)

```js
import { InMemoryKV } from '@webqit/keyval/inmemory';

export function createSessionStore(sessionId) {
  return new InMemoryKV({
    path: ['session', sessionId],
    ttl: 30 * 60_000, // 30 minutes
  });
}
```

Use this for:

* CSRF tokens
* auth challenges
* flash messages
* request aggregation

### 2. User-scoped persistent state (browser)

```js
import { IndexedDBKV } from '@webqit/keyval/indexeddb';

export function createUserStore(userId) {
  return new IndexedDBKV({
    path: ['user', userId],
    dbName: 'my_app',
  });
}
```

Use this for:

* preferences
* drafts
* offline-first data
* user-local caches

### 3. Tenant- or system-scoped shared state (server)

```js
import { RedisKV } from '@webqit/keyval/redis';

export function createTenantStore(tenantId) {
  return new RedisKV({
    path: ['tenant', tenantId],
    redisUrl: process.env.REDIS_URL,
    ttl: 5 * 60_000,
  });
}
```

Use this for:

* shared caches
* rate-limiting state
* coordination data
* feature rollout flags

---

## Backends

All Keyval backends share the same *conceptual* model and API surface, but they differ in:

* where data is physically stored,
* how `path` is flattened into backend-specific keys,
* how expiry is enforced,
* what metadata is supported.

This section documents those differences explicitly, so you know exactly what to expect when choosing a backend.

### InMemoryKV

```js
import { InMemoryKV } from '@webqit/keyval/inmemory';

const kv = new InMemoryKV({
  path: ['session', sessionId],
});
```

**What it is**

A process-local, in-memory dictionary backed by JavaScript Maps.

**Persistence & sharing**

* Data exists only for the lifetime of the process.
* Not shared across processes, workers, or browser tabs.

**Path flattening**

* `path` is used to structure the instance internally.
* Path flattening or serialization as a concept is not applicable.

**Metadata**

* Arbitrary field-level metadata is supported: `kv.set({ key, value, ...meta })`.

**Expiry**

* Field-level expiry is supported (when a namespace-level TTL is set).
* Expired keys are removed lazily on next access.

**Typical use cases**

* request- or session-scoped state
* hot caches
* tests and local tooling

### FileKV (Node.js)

```js
import { FileKV } from '@webqit/keyval/file';

const kv = new FileKV({
  path: ['user', userId],
  dir: '.webqit_keyval',
});
```

**What it is**

A persistent key/value dictionary backed by the filesystem.

**Path flattening**

* The `path` array is flattened using `:` and mapped to a file name:

```
<dir>/<path.join(':')>.json
```

Example structure:

```txt
.webqit_keyval/         ← Directory
└── user:user-42.json   ← File – a KV instance
```

**Persistence & sharing**

* Persists in the filesystem.
* Not concurrency-safe across multiple processes unless the filesystem is shared and externally synchronized.

**Metadata**

* Arbitrary field-level metadata is supported: `kv.set({ key, value, ...meta })`.

**Expiry**

* Field-level expiry is supported (when a namespace-level TTL is set).
* Expired keys are removed lazily on next access.

**Typical use cases**

* CLI tools
* small Node services
* local persistence without Redis or a database

### WebStorageKV (Browser)

```js
import { WebStorageKV } from '@webqit/keyval/webstorage';

const kv = new WebStorageKV({
  path: ['session', sessionId],
  storage: 'local', // or 'session'
});
```

**What it is**

A Keyval dictionary backed by `localStorage` or `sessionStorage`.

**Path flattening**

* Keys are flattened as:

```
<path.join(':')>:<key>
```

Example structure:

```txt
session:abc123:flags    ← { value, ...meta }
session:abc123:profile  ← { value, ...meta }
```

**Persistence & sharing**

* `localStorage`: persists across reloads, shared across tabs.
* `sessionStorage`: scoped to a single tab/session.
* Optional `BroadcastChannel` publishing for cross-tab signaling.

**Metadata**

* Arbitrary field-level metadata is supported: `kv.set({ key, value, ...meta })`.

**Expiry**

* Field-level expiry is supported (when a namespace-level TTL is set).
* Expired keys are removed lazily on next access.

**Caveats**

* Standard Web Storage size limits apply.
* Underlying storage is synchronous (even though Keyval’s API is async).

### IndexedDBKV (Browser)

```js
import { IndexedDBKV } from '@webqit/keyval/indexeddb';

const kv = new IndexedDBKV({
  path: ['user', userId],
  dbName: 'my_app',
});
```

**What it is**

An async Keyval dictionary backed by IndexedDB.

**Path flattening**

* Each `path` maps to **one object store**.
* The object store name is:

```
path.join(':')
```

Example structure:

```txt
my_app                  ← Database
└── user:user-42        ← Store – a KV instance
```

**Persistence & sharing**

* Persists in the database.
* Available offline.
* Optional `BroadcastChannel` publishing for multi-tab coordination.

**Metadata**

* Arbitrary field-level metadata is supported: `kv.set({ key, value, ...meta })`.

**Expiry**

* Field-level expiry is supported (when a namespace-level TTL is set).
* Expired keys are removed lazily on next access.

**Typical use cases**

* offline-first applications
* larger browser-resident datasets
* async-safe browser persistence

### CookieStoreKV (For supporting browsers)

```js
import { CookieStoreKV } from '@webqit/keyval/cookiestore';

const kv = new CookieStoreKV({
  path: ['session', sessionId],
  cookiePath: '/',
});
```

**What it is**

A Keyval dictionary backed by the Cookie Store API (`cookieStore`) or a compatible storage interface.

**Path flattening**

* Cookie names are flattened as:

```
<path.join(':')>:<key>
```

Example structure:

```txt
session:abc123:csrf     ← { value, ...meta }
user:user-42:profile    ← { value, ...meta }
```

**Metadata (Constrained)**

* Only metadata supported by the Cookie API is allowed:

  * `expires`
  * `maxAge`
  * `path`
  * `domain`
  * `secure`
  * `sameSite`

**Expiry**

* Enforced natively by the browser via cookie semantics.

**Typical use cases**

* cookie-centric auth flows
* interoperability with existing cookie-based systems
* lightweight persistence with strict constraints

### RedisKV (Node.js / server)

```js
import { RedisKV } from '@webqit/keyval/redis';

const kv = new RedisKV({
  path: ['user', userId],
  redisUrl: process.env.REDIS_URL,
  ttl: 60_000,
});
```

**What it is**

A Keyval dictionary backed by Redis hashes.

**Path flattening**

* Each instance maps to **one Redis hash key**:

```
<namespace>:<path.join(':')>
```

Default namespace is `*`.

Example structure:

```txt
*:user:user-42          ← Redis hash (instance)
└── profile             ← { value, ...meta }
```

**Metadata**

* Arbitrary field-level metadata is supported: `kv.set({ key, value, ...meta })`.

**Expiry**

* Standard hash-level TTL is enforced natively by Redis.
* Field-level expiry is supported (when a namespace-level TTL is set and `options.fieldLevelExpiry` is set).
* Expired keys are removed lazily on next access.

**Typical use cases**

* shared caches
* session storage at scale
* coordination state across server instances

---

## API

All Keyval instances—regardless of backend—expose the same API.

> **All methods are async except `observe()`**.

### `set()`

```js
await kv.set(key, value);
```

or

```js
await kv.set({
  key,
  value,
  ...meta
});
```

#### Object form (`set(object)`)

You may include **any metadata** you want as metadata—**except** where restricted by the backend (notably CookieStoreKV)–and it will be stored alongside the value.

Example:

```js
await kv.set({
  key: 'profile',
  value: { theme: 'dark' },
  expires: Date.now() + 60_000,
  source: 'sync',
  revision: 4,
});
```

Backend notes:

* All backends except CookieStoreKV allow arbitrary metadata.
* CookieStoreKV allows only cookie-supported attributes as metadata.

Also, for the Cookie Store API, you **do not** call:

```js
cookieStore.set({ name, ... })
```

With Keyval, you always use:

```js
kv.set({ key, ... })
```

Keyval maps `key` to `name` internally.

The same applies to `get()`:

```js
await kv.get({ key });
```

### `get()`

```js
await kv.get(key);
```

or

```js
await kv.get({ key });
```

* Returns the stored `value`.
* If the key is expired or missing, returns `undefined`.

#### Object form (`get(object)`)

The object form returns the full field metadata.

### `has()`

```js
await kv.has(key);
await kv.has({ key });
```

Returns `true` if the key exists and is not expired.

### `delete()`

```js
await kv.delete(key);
await kv.delete({ key });
```

Removes the key and its metadata.

### `clear()`

```js
await kv.clear();
```

Clears **all keys within the namespace**.

### `json()`

#### Write

```js
await kv.json(object);
```

or

```js
await kv.json(object, options);
```

#### Options

```js
{
  merge?: boolean;
  hashed?: boolean;
}
```

#### `options.hashed`

Where fields in the input JSON object are **full metadata objects**, not raw values, set `options.hashed: true` to tell the `.json()` method to treat them as such.

Example:

```js
await kv.json(
  {
    profile: {
      value: { theme: 'dark' },
      expires: Date.now() + 60_000,
      source: 'import',
    },
  },
  { hashed: true }
);
```

This allows bulk writes with field-level metadata.

#### Read

```js
await kv.json();       // returns { key: value }
await kv.json(true);   // returns { key: { value, ...meta } }
```

Passing `true` returns the full field metadata.

### Enumeration methods

All enumeration methods are async.

```js
await kv.count();   // async equivalent of Map.size
await kv.keys();
await kv.values();
await kv.entries();
```

These methods always reflect the active, non-expired fields.

### `observe()`

```js
const stop = kv.observe(key?, handler, options?);
```

* The only **synchronous** method.
* Returns an unsubscribe function.

Supports:

* observing a specific key
* observing the entire namespace
* `{ once: true }`
* `{ signal: AbortSignal }`

Observer callbacks receive an event describing the mutation (`type`, `key`, `value`, etc.).

### Lifecycle

```js
kv.cleanup(); // auto unbinds all observers
await kv.close(); // releases backend resources
```

---

## Contributing

All forms of contributions are welcome at this time. For example, syntax and other implementation details are all up for discussion. Also, help is needed with more formal documentation. And here are specific links:

+ [Project](https://github.com/webqit/keyval)
+ [Documentation](https://github.com/webqit/keyval/wiki)
+ [Discusions](https://github.com/webqit/keyval/discussions)
+ [Issues](https://github.com/webqit/keyval/issues)

## License

MIT.

[npm-version-src]: https://img.shields.io/npm/v/@webqit/keyval?style=flat&colorA=18181B&colorB=F0DB4F
[npm-version-href]: https://npmjs.com/package/@webqit/keyval
[npm-downloads-src]: https://img.shields.io/npm/dm/@webqit/keyval?style=flat&colorA=18181B&colorB=F0DB4F
[npm-downloads-href]: https://npmjs.com/package/@webqit/keyval
[bundle-src]: https://img.shields.io/bundlephobia/minzip/@webqit/keyval?style=flat&colorA=18181B&colorB=F0DB4F
[bundle-href]: https://bundlephobia.com/result?p=@webqit/keyval
[license-src]: https://img.shields.io/github/license/webqit/keyval.svg?style=flat&colorA=18181B&colorB=F0DB4F
[license-href]: https://github.com/webqit/keyval/blob/master/LICENSE
