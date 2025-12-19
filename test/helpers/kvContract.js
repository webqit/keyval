import assert from 'assert';

export function runKVContract(createKV, { supportsTTL = true } = {}) {
    describe('KV contract', () => {
        let store;
        const events = [];

        beforeEach(async () => {
            events.length = 0;
            store = await createKV();
            store.observe((e) => events.push(e));
        });

        afterEach(async () => {
            await store?.close?.();
        });

        it('sets and gets values', async () => {
            await store.set('a', 1);
            assert.equal(await store.get('a'), 1);
        });

        it('returns undefined for missing keys', async () => {
            assert.equal(await store.get('missing'), undefined);
        });

        it('has() reflects presence', async () => {
            await store.set('a', 1);
            assert.equal(await store.has('a'), true);
            assert.equal(await store.has('b'), false);
        });

        it('deletes keys', async () => {
            await store.set('a', 1);
            await store.delete('a');
            assert.equal(await store.get('a'), undefined);
        });

        it('lists keys / values / entries', async () => {
            await store.set('a', 1);
            await store.set('b', 2);

            assert.deepEqual((await store.keys()).sort(), ['a', 'b']);
            assert.deepEqual((await store.values()).sort(), [1, 2]);
            assert.deepEqual(
                (await store.entries()).sort(),
                [['a', 1], ['b', 2]]
            );
        });

        it('clears the store', async () => {
            await store.set('a', 1);
            await store.set('b', 2);
            await store.clear();

            assert.equal(await store.count(), 0);
        });

        it('fires events on mutations', async () => {
            await store.set('a', 1);
            await store.delete('a');
            await store.clear();

            assert.deepEqual(
                events.map(e => e.type),
                ['set', 'delete', 'clear']
            );
        });

        it('to json', async () => {
            await store.set('a', 1);
            await store.set('b', 2);
            await store.set('c', 3);
            await store.delete('a');
            const json = await store.json();
            assert.deepEqual(json, { b: 2, c: 3 });
        });

        it('from json', async () => {
            const rootEvents = [];
            const fieldAEvents = [];
            const fieldBEvents = [];
            store.observe((e) => rootEvents.push(e.type));
            store.observe('a', (e) => fieldAEvents.push(e.type));
            store.observe('b', (e) => fieldBEvents.push(e.type));

            await store.set('a', 1);
            await store.json({ b: 2, c: 3 });
            const json = await store.json();
            assert.deepEqual(json, { b: 2, c: 3 });

            assert.deepEqual(rootEvents, ['set', 'json']);
            assert.deepEqual(fieldAEvents, ['set', 'delete']);
            assert.deepEqual(fieldBEvents, ['set']);
        });

        it('from json with merge', async () => {
            const rootEvents = [];
            const fieldAEvents = [];
            const fieldBEvents = [];
            store.observe((e) => rootEvents.push(e.type));
            store.observe('a', (e) => fieldAEvents.push(e.type));
            store.observe('b', (e) => fieldBEvents.push(e.type));

            await store.set('a', 1);
            await store.json({ b: 2, c: 3 }, { merge: true });
            const json = await store.json();
            assert.deepEqual(json, { a: 1, b: 2, c: 3 });

            assert.deepEqual(rootEvents, ['set', 'json']);
            assert.deepEqual(fieldAEvents, ['set']);
            assert.deepEqual(fieldBEvents, ['set']);
        });

        if (supportsTTL) {
            it('expires values after TTL', async () => {
                await store.set('ttl', 'x');
                await new Promise(r => setTimeout(r, 1100));
                assert.equal(await store.get('ttl'), undefined);
            });
        }
    });
}
