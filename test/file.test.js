import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { FileKV } from '../src/FileKV.js';
import { runKVContract } from './helpers/kvContract.js';

describe('FileKV', () => {

    let dir;
    let store;

    beforeEach(async () => {
        dir = await fs.mkdtemp(
            path.join(os.tmpdir(), 'filestore-test-')
        );

        store = new FileKV({
            dir,
            path: ['test'],
            ttl: 1
        });
    });

    afterEach(async () => {
        await store?.close?.();
        await fs.rm(dir, { recursive: true, force: true });
    });

    runKVContract(async () => store);
});
