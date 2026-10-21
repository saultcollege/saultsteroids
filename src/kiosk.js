/**
 * The big-screen side of kiosk play: listens for phones in the lobby, gives
 * each one a plane, feeds their input to it, and tells them how they are doing.
 */
import { Color } from '../lib/littlejs.esm.min.js';
import * as game from './game.js';
import {
    MAX_PLAYERS, PLAYER_TIMEOUT_SECONDS, HOST_HEARTBEAT_SECONDS,
    NAME_ADJECTIVES, NAME_ANIMALS,
    lobbyChannel, playerChannel, isPlayerId, makePlayerName, pickColor, inputToControls,
} from './net/protocol.js';

/** Credits can change several times a second; phones hear about it at most this often. */
const STATUS_MIN_INTERVAL = 0.5;
/** How long to keep a channel open after telling a phone the kiosk is full. */
const FULL_LINGER_SECONDS = 1;

/** Only names the game itself makes are shown on the big screen. */
function isGeneratedName(name)
{
    if (typeof name !== 'string')
        return false;
    const [adjective, animal, ...rest] = name.split(' ');
    return !rest.length && NAME_ADJECTIVES.includes(adjective) && NAME_ANIMALS.includes(animal);
}

export class KioskHost
{
    /**
     * @param {object} options
     * @param {{join: Function}} options.transport
     * @param {string} options.room
     * @param {() => number} [options.now] clock in seconds
     * @param {number} [options.maxPlayers]
     */
    constructor({ transport, room, now = () => performance.now() / 1000, maxPlayers = MAX_PLAYERS })
    {
        this.transport = transport;
        this.room = room;
        this.now = now;
        this.maxPlayers = maxPlayers;
        /** @type {Map<string, {id, channel, name, colorHex, lastSeen, lastStatus, lastStatusAt}>} */
        this.connections = new Map();
        this.pending = new Set();
        this.closing = [];
        this.lobby = null;
    }

    async start()
    {
        this.lobby = await this.transport.join(lobbyChannel(this.room), (m) => this.onLobbyMessage(m));
    }

    stop()
    {
        for (const id of [...this.connections.keys()])
            this.drop(id);
        this.lobby?.leave();
        this.lobby = null;
    }

    /** Players currently connected, with their game records, for the scoreboard. */
    players()
    {
        return [...this.connections.values()].map((c) => ({ ...c, player: game.state.players.get(c.id) }));
    }

    async onLobbyMessage(message)
    {
        if (message?.t !== 'join' || !isPlayerId(message.id))
            return;

        const existing = this.connections.get(message.id);
        if (existing)
        {
            // a phone that missed its welcome, or lost touch for a moment
            existing.lastSeen = this.now();
            this.sendWelcome(existing);
            return;
        }
        if (this.pending.has(message.id))
            return;

        this.pending.add(message.id);
        let channel;
        try
        {
            channel = await this.transport.join(playerChannel(this.room, message.id), (m) => this.onPlayerMessage(message.id, m));
        }
        catch
        {
            return; // the phone will ask again
        }
        finally
        {
            this.pending.delete(message.id);
        }

        if (this.connections.size >= this.maxPlayers)
        {
            channel.send({ t: 'full' });
            this.closing.push({ channel, at: this.now() + FULL_LINGER_SECONDS });
            return;
        }

        const name = isGeneratedName(message.name) ? message.name : makePlayerName();
        const colorHex = pickColor([...this.connections.values()].map((c) => c.colorHex));
        game.addPlayer(message.id, { name, color: new Color().setHex(colorHex) });
        const connection = { id: message.id, channel, name, colorHex, lastSeen: this.now(), lastStatus: null, lastStatusAt: -Infinity };
        this.connections.set(message.id, connection);
        this.sendWelcome(connection);
    }

    onPlayerMessage(id, message)
    {
        const connection = this.connections.get(id);
        if (!connection || !message)
            return;
        connection.lastSeen = this.now();

        if (message.t === 'in')
            game.setPlayerControls(id, inputToControls(message));
        else if (message.t === 'again')
            game.restartPlayer(id);
        else if (message.t === 'leave')
            this.drop(id);
    }

    sendWelcome(connection)
    {
        connection.channel.send({ t: 'welcome', name: connection.name, color: connection.colorHex });
        connection.lastStatus = null; // follow up with a fresh status
    }

    drop(id)
    {
        const connection = this.connections.get(id);
        if (!connection)
            return;
        this.connections.delete(id);
        game.removePlayer(id);
        connection.channel.leave();
    }

    /** Call every frame: drops silent phones and keeps phones up to date. */
    update()
    {
        const now = this.now();

        for (const connection of [...this.connections.values()])
        {
            const player = game.state.players.get(connection.id);
            if (!player || now - connection.lastSeen > PLAYER_TIMEOUT_SECONDS)
            {
                this.drop(connection.id);
                continue;
            }

            const status = { t: 'status', coffees: player.coffees, credits: player.credits, out: player.out };
            const changed = !connection.lastStatus ||
                status.coffees !== connection.lastStatus.coffees ||
                status.credits !== connection.lastStatus.credits ||
                status.out !== connection.lastStatus.out;
            const sinceLast = now - connection.lastStatusAt;
            if ((changed && sinceLast >= STATUS_MIN_INTERVAL) || sinceLast >= HOST_HEARTBEAT_SECONDS)
            {
                connection.channel.send(status);
                connection.lastStatus = status;
                connection.lastStatusAt = now;
            }
        }

        this.closing = this.closing.filter(({ channel, at }) => {
            if (now < at)
                return true;
            channel.leave();
            return false;
        });
    }
}
