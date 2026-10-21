/**
 * Kiosk screen furniture: the "scan to play" QR code, the room code, the
 * scoreboard, and the connection to the relay. Open the game with `?kiosk`.
 */
import * as game from './game.js';
import { KioskHost } from './kiosk.js';
import { makeRoomCode, normalizeRoomCode } from './net/protocol.js';

const QR_LIBRARY = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm';
const RETRY_SECONDS = 5;

const $ = (id) => document.getElementById(id);

/** The link phones open: play/ next to this page, with the room (and dev transport) in the query. */
export function joinUrl(room, pageUrl = location.href)
{
    const url = new URL('play/', pageUrl);
    url.searchParams.set('room', room);
    if (new URL(pageUrl).searchParams.get('transport') === 'local')
        url.searchParams.set('transport', 'local');
    return url.href;
}

async function renderQr(text)
{
    try
    {
        const { default: qrcode } = await import(QR_LIBRARY);
        const qr = qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        $('kiosk-qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    }
    catch
    {
        $('kiosk-qr').hidden = true; // the URL and room code are still shown
    }
}

function renderScoreboard(host)
{
    const rows = (host?.players() ?? [])
        .filter((c) => c.player)
        .sort((a, b) => b.player.credits - a.player.credits);
    const list = $('scoreboard');
    list.replaceChildren(...rows.map(({ name, colorHex, player }) => {
        const li = document.createElement('li');
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = colorHex;
        const who = document.createElement('span');
        who.className = 'who';
        who.textContent = name;
        const score = document.createElement('span');
        score.className = 'score';
        score.textContent = player.out ? `${player.credits} · out of coffee` : `${player.credits} · ${'☕'.repeat(player.coffees)}`;
        li.append(dot, who, score);
        return li;
    }));
    $('scoreboard-empty').hidden = rows.length > 0;
}

/**
 * Turn this page into the kiosk.
 * @param {() => Promise<{join: Function}>} makeTransport
 * @returns {{ update: () => void }} call update() every frame
 */
export function startKiosk(makeTransport)
{
    const params = new URLSearchParams(location.search);
    const room = normalizeRoomCode(params.get('room')) ?? makeRoomCode();
    // keep the room in the address bar so reloading the kiosk keeps phones' links working
    const local = params.get('transport') === 'local' ? '&transport=local' : '';
    history.replaceState(null, '', `?kiosk&room=${room}${local}`);

    document.body.classList.add('kiosk');
    $('kiosk-panel').hidden = false;
    $('kiosk-code').textContent = room;
    const link = joinUrl(room);
    $('kiosk-url').textContent = link.replace(/^https?:\/\//, '');
    renderQr(link);

    navigator.wakeLock?.request('screen').catch(() => {});
    game.startKiosk();

    let host = null;
    const status = $('kiosk-status');
    async function connect()
    {
        status.textContent = 'Connecting to the game server…';
        try
        {
            const candidate = new KioskHost({ transport: await makeTransport(), room });
            await candidate.start();
            host = candidate;
            status.textContent = '';
        }
        catch (error)
        {
            console.warn('Kiosk could not connect:', error);
            status.textContent = `Can't reach the game server. Retrying in ${RETRY_SECONDS} seconds…`;
            setTimeout(connect, RETRY_SECONDS * 1000);
        }
    }
    connect();

    setInterval(() => renderScoreboard(host), 250);
    return { update: () => host?.update() };
}
