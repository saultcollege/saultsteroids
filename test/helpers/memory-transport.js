/**
 * An in-memory stand-in for Supabase Broadcast. Messages queue up until
 * flush(), so tests control exactly when they arrive, and every message is
 * counted the way Supabase bills them: one sent plus one per receiver.
 */
export function createMemoryHub()
{
    const channels = new Map(); // name -> Set of endpoints
    const queue = [];
    const counts = { sent: 0, received: 0, byChannel: new Map() };

    const transport = {
        async join(name, onMessage)
        {
            const endpoint = { onMessage };
            if (!channels.has(name))
                channels.set(name, new Set());
            const members = channels.get(name);
            members.add(endpoint);
            return {
                send(message)
                {
                    counts.sent++;
                    counts.byChannel.set(name, (counts.byChannel.get(name) ?? 0) + 1);
                    for (const other of members)
                        if (other !== endpoint)
                            queue.push({ to: other, members, message: structuredClone(message) });
                },
                leave() { members.delete(endpoint); },
            };
        },
    };

    /** Deliver everything queued, including messages sent while delivering. */
    async function flush()
    {
        for (let round = 0; round < 20; round++)
        {
            while (queue.length)
            {
                const { to, members, message } = queue.shift();
                if (members.has(to))
                {
                    counts.received++;
                    to.onMessage(message);
                }
            }
            // let awaited joins finish, then deliver anything they sent
            await new Promise((resolve) => setImmediate(resolve));
            if (!queue.length)
                return;
        }
    }

    return { transport, flush, counts, channels, total: () => counts.sent + counts.received };
}
