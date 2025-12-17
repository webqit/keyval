import assert from 'assert';

export function runStoreContract(createStore, { supportsTTL = true } = {}) {
    describe('Store contract', () => {
        let store;
        const events = [];

        beforeEach(async () => {
            events.length = 0;
            store = await createStore();
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

        if (supportsTTL) {
            it('expires values after TTL', async () => {
                await store.set('ttl', 'x');
                await new Promise(r => setTimeout(r, 1100));
                assert.equal(await store.get('ttl'), undefined);
            });
        }
    });
}
