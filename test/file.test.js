import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { FileStore } from '../src/FileStore.js';
import { runStoreContract } from './helpers/storeContract.js';

describe('FileStore', () => {

    let dir;
    let store;

    beforeEach(async () => {
        dir = await fs.mkdtemp(
            path.join(os.tmpdir(), 'filestore-test-')
        );

        store = new FileStore({
            dir,
            path: ['test'],
            ttl: 1
        });
    });

    afterEach(async () => {
        await store?.close?.();
        await fs.rm(dir, { recursive: true, force: true });
    });

    runStoreContract(async () => store);
});
