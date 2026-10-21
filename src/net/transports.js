/**
 * Transports carry protocol messages between the kiosk and phones. Each has
 * one method:
 *
 *   join(channelName, onMessage) -> Promise<{ send(message), leave() }>
 *
 * Messages are plain JSON objects and are never delivered back to the sender.
 */
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
const SUBSCRIBE_TIMEOUT_MS = 15000;

/** Supabase Realtime Broadcast over a secure WebSocket: works on networks that block peer-to-peer. */
export async function createSupabaseTransport(url = SUPABASE_URL, key = SUPABASE_KEY)
{
    const { createClient } = await import(SUPABASE_JS);
    const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        // the client-side throttle defaults to 10/s; the kiosk talks to several phones at once
        realtime: { params: { eventsPerSecond: 60 } },
    });

    return {
        join(name, onMessage)
        {
            return new Promise((resolve, reject) => {
                const channel = client.channel(name, { config: { broadcast: { self: false, ack: false } } });
                channel.on('broadcast', { event: 'm' }, ({ payload }) => onMessage(payload));
                const timer = setTimeout(() => reject(new Error(`Timed out joining ${name}`)), SUBSCRIBE_TIMEOUT_MS);
                let joined = false;
                channel.subscribe((status, error) => {
                    if (status === 'SUBSCRIBED' && !joined)
                    {
                        joined = true;
                        clearTimeout(timer);
                        resolve({
                            send: (message) => channel.send({ type: 'broadcast', event: 'm', payload: message }),
                            leave: () => client.removeChannel(channel),
                        });
                    }
                    else if (!joined && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'))
                    {
                        clearTimeout(timer);
                        reject(error ?? new Error(`${status} joining ${name}`));
                    }
                });
            });
        },
    };
}

/** Same-browser transport for development: open the kiosk and a phone controller in two tabs. */
export function createLocalTransport()
{
    return {
        async join(name, onMessage)
        {
            const channel = new BroadcastChannel(name);
            channel.onmessage = (event) => onMessage(event.data);
            return {
                send: (message) => channel.postMessage(message),
                leave: () => channel.close(),
            };
        },
    };
}

/** Pick a transport from the page URL: `?transport=local` for development, Supabase otherwise. */
export function createTransportFromUrl(search = location.search)
{
    return new URLSearchParams(search).get('transport') === 'local'
        ? Promise.resolve(createLocalTransport())
        : createSupabaseTransport();
}
