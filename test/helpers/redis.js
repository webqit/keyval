import { createClient } from 'redis';

export async function redisAvailable(redisUrl = null) {
    const client = createClient({ url: redisUrl });
    try {
        await client.connect();
        await client.quit();
        return true;
    } catch (e) {
        return false;
    }
}