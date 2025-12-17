import { createClient } from 'redis';

export async function redisAvailable() {
    const client = createClient();
    try {
        await client.connect();
        await client.quit();
        return true;
    } catch {
        return false;
    }
}