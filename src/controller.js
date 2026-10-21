/**
 * The phone side of kiosk play: joins the kiosk's room, sends stick and
 * fire input, and tracks how this player is doing. No DOM here; the page
 * (controller-ui.js) calls setInput() and update() and renders `state`.
 */
import {
    INPUT_HZ, KEEPALIVE_SECONDS, HOST_TIMEOUT_SECONDS, JOIN_RETRY_SECONDS,
    lobbyChannel, playerChannel, makePlayerId, makePlayerName, quantizeInput, sameInput,
} from './net/protocol.js';

/**
 * Phases:
 *  connecting   asked to join, waiting for the kiosk
 *  playing      flying a plane
 *  out          out of coffee; can play again
 *  full         the kiosk has no room right now
 *  reconnecting lost touch with the kiosk; asking to join again
 *  left         this phone left; nothing more is sent
 */
export class Controller
{
    /**
     * @param {object} options
     * @param {{join: Function}} options.transport
     * @param {string} options.room
     * @param {() => number} [options.now] clock in seconds
     * @param {() => number} [options.random]
     * @param {(state: object) => void} [options.onChange]
     */
    constructor({ transport, room, now = () => performance.now() / 1000, random = Math.random, onChange = () => {} })
    {
        this.transport = transport;
        this.room = room;
        this.now = now;
        this.onChange = onChange;
        this.id = makePlayerId(random);
        this.state = { phase: 'connecting', name: makePlayerName(random), color: null, coffees: null, credits: 0 };
        this.input = quantizeInput(0, 0, false);
        this.lastSent = null;
        this.lastSentAt = -Infinity;
        this.lastJoinAt = -Infinity;
        this.lastHeardAt = -Infinity;
    }

    async start()
    {
        // listen on our own channel before asking to join, so the welcome is not missed
        this.channel = await this.transport.join(playerChannel(this.room, this.id), (m) => this.onMessage(m));
        this.lobby = await this.transport.join(lobbyChannel(this.room), () => {});
        this.sendJoin();
    }

    sendJoin()
    {
        this.lobby.send({ t: 'join', id: this.id, name: this.state.name });
        this.lastJoinAt = this.now();
    }

    /** Stick x right / y up (length up to 1) and whether fire is held. */
    setInput(x, y, fire)
    {
        this.input = quantizeInput(x, y, fire);
    }

    /** Ask to join again after the kiosk was full. */
    retry()
    {
        this.setPhase('connecting');
        this.sendJoin();
    }

    playAgain()
    {
        this.channel.send({ t: 'again' });
    }

    /** Leave the kiosk for good: this controller stops sending anything. */
    leave()
    {
        this.channel?.send({ t: 'leave' });
        this.left = true;
        this.setPhase('left');
    }

    setPhase(phase)
    {
        if (this.state.phase !== phase)
        {
            this.state = { ...this.state, phase };
            this.onChange(this.state);
        }
    }

    sendInput(input)
    {
        this.channel.send(input);
        this.lastSent = input;
        this.lastSentAt = this.now();
    }

    /** Call often (every animation frame is fine): sends are rate limited here. */
    update()
    {
        const now = this.now();
        const { phase } = this.state;

        if (!this.lobby || phase === 'full' || this.left)
            return;

        if (phase === 'connecting' || phase === 'reconnecting')
        {
            if (now - this.lastJoinAt >= JOIN_RETRY_SECONDS)
                this.sendJoin();
            return;
        }

        if (now - this.lastHeardAt > HOST_TIMEOUT_SECONDS)
        {
            this.setPhase('reconnecting');
            this.sendJoin();
            return;
        }

        const input = phase === 'playing' ? this.input : quantizeInput(0, 0, false);
        const sinceLast = now - this.lastSentAt;
        const changed = !sameInput(input, this.lastSent);
        if ((changed && sinceLast >= 1 / INPUT_HZ) || sinceLast >= KEEPALIVE_SECONDS)
            this.sendInput(input);
    }

    onMessage(message)
    {
        if (!message || this.left)
            return;
        this.lastHeardAt = this.now();

        if (message.t === 'welcome')
        {
            this.state = { ...this.state, name: message.name, color: message.color };
            this.lastSent = null; // resend input straight away
            this.setPhase(this.state.phase === 'out' ? 'out' : 'playing');
            this.onChange(this.state);
        }
        else if (message.t === 'full')
            this.setPhase('full');
        else if (message.t === 'status' && this.state.phase !== 'full')
        {
            this.state = { ...this.state, coffees: message.coffees, credits: message.credits };
            this.setPhase(message.out ? 'out' : 'playing');
            this.onChange(this.state);
        }
    }
}
