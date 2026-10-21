/**
 * Kiosk multiplayer protocol, shared by the big-screen host and the phone
 * controllers. Pure functions and constants only, so it is unit tested
 * directly (test/protocol.test.js).
 *
 * Topology: every phone has a private channel to the kiosk, so a phone's
 * messages are only ever delivered to the kiosk. Supabase counts a broadcast
 * as one message sent plus one per receiver, so each phone message costs 2.
 * Phones announce themselves on a shared lobby channel, which is rare.
 *
 *   phone -> lobby:   {t: 'join', id, name}
 *   phone -> player:  {t: 'in', a, p, f}   input (see quantizeInput)
 *                     {t: 'again'}          play again after running out of coffee
 *                     {t: 'leave'}
 *   kiosk -> player:  {t: 'welcome', name, color}
 *                     {t: 'full'}
 *                     {t: 'status', coffees, credits, out}   also the kiosk's heartbeat
 */

/** Players on the big screen at once. 6 × INPUT_HZ × 2 keeps within the Supabase Free plan's 100 messages/s. */
export const MAX_PLAYERS = 6;
/** Most input messages a phone sends per second. */
export const INPUT_HZ = 8;
/** A phone resends its input this often even when nothing changed, so the kiosk knows it is still there. */
export const KEEPALIVE_SECONDS = 2;
/** The kiosk drops a player it has not heard from for this long. */
export const PLAYER_TIMEOUT_SECONDS = 8;
/** The kiosk sends each player a status at least this often. */
export const HOST_HEARTBEAT_SECONDS = 3;
/** A phone treats the kiosk as gone after this long without hearing from it. */
export const HOST_TIMEOUT_SECONDS = 7;
/** How often a phone retries joining while it waits for a welcome. */
export const JOIN_RETRY_SECONDS = 3;

/** Aim directions a stick is rounded to. */
export const AIM_STEPS = 64;
/** Thrust levels above zero. */
export const THRUST_STEPS = 4;
/** Stick readings shorter than this are a resting thumb. */
export const STICK_DEAD_ZONE = 0.15;

// No I, L, O or 0/1 lookalikes, so codes are easy to read off a screen.
const ROOM_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 4;

export function makeRoomCode(random = Math.random)
{
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++)
        code += ROOM_LETTERS[Math.floor(random() * ROOM_LETTERS.length)];
    return code;
}

export function isRoomCode(code)
{
    return typeof code === 'string' && new RegExp(`^[${ROOM_LETTERS}]{${ROOM_CODE_LENGTH}}$`).test(code);
}

/** Room codes are typed by people: accept lower case and stray spaces. */
export function normalizeRoomCode(code)
{
    const clean = String(code ?? '').toUpperCase().replace(/\s+/g, '');
    return isRoomCode(clean) ? clean : null;
}

export const lobbyChannel = (room) => `saultsteroids:${room}:lobby`;
export const playerChannel = (room, id) => `saultsteroids:${room}:p:${id}`;

export function makePlayerId(random = Math.random)
{
    return Array.from({ length: 10 }, () => Math.floor(random() * 36).toString(36)).join('');
}

export function isPlayerId(id)
{
    return typeof id === 'string' && /^[a-z0-9]{10}$/.test(id);
}

/** Visitors get a generated name: nothing to type, and nothing unexpected on the big screen. */
export const NAME_ADJECTIVES = Object.freeze([
    'Swift', 'Clever', 'Brave', 'Sunny', 'Mighty', 'Curious', 'Rapid', 'Bold', 'Lucky', 'Keen',
    'Jolly', 'Nimble', 'Steady', 'Daring', 'Witty', 'Cosmic',
]);
export const NAME_ANIMALS = Object.freeze([
    'Cougar', 'Moose', 'Loon', 'Beaver', 'Lynx', 'Otter', 'Heron', 'Fox', 'Bear', 'Wolf',
    'Falcon', 'Raven', 'Walleye', 'Marten', 'Owl', 'Caribou',
]);

export function makePlayerName(random = Math.random)
{
    const pick = (list) => list[Math.floor(random() * list.length)];
    return `${pick(NAME_ADJECTIVES)} ${pick(NAME_ANIMALS)}`;
}

/** Plane colours, brand green and blue first, all readable on the night sky. */
export const PLAYER_COLORS = Object.freeze([
    '#8EA366', '#57B0E3', '#FFE36E', '#F08A7A', '#B79CED', '#4FD1C5', '#F5A54A', '#E8EEF2',
]);

/** The first colour not already in use. */
export function pickColor(usedColors)
{
    const used = new Set(usedColors);
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[used.size % PLAYER_COLORS.length];
}

/**
 * Round a stick reading (x right, y up, length up to 1) and the fire button
 * into a small message. Rounding means small thumb wobbles do not each cost
 * a message.
 *   a: aim step 0..AIM_STEPS-1 clockwise from up, or -1 for no aim
 *   p: thrust level 0..THRUST_STEPS
 *   f: 1 while fire is held
 */
export function quantizeInput(x, y, fire)
{
    const length = Math.min(Math.hypot(x, y), 1);
    const f = fire ? 1 : 0;
    if (!(length >= STICK_DEAD_ZONE))
        return { t: 'in', a: -1, p: 0, f };
    const angle = Math.atan2(x, y); // LittleJS: 0 up, clockwise
    const a = ((Math.round(angle / (Math.PI * 2) * AIM_STEPS) % AIM_STEPS) + AIM_STEPS) % AIM_STEPS;
    const p = Math.max(1, Math.round((length - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE) * THRUST_STEPS));
    return { t: 'in', a, p, f };
}

export function sameInput(a, b)
{
    return !!a && !!b && a.a === b.a && a.p === b.p && a.f === b.f;
}

/**
 * Turn an input message into plane controls. The plane turns to face the
 * aim and thrusts by the level; pointing without thrust just turns.
 */
export function inputToControls(message)
{
    const valid = message && Number.isInteger(message.a) && message.a >= -1 && message.a < AIM_STEPS &&
        Number.isInteger(message.p) && message.p >= 0 && message.p <= THRUST_STEPS;
    if (!valid)
        return { turn: 0, thrust: 0, brake: false, aim: null, fire: false, stick: null };
    const aim = message.a < 0 ? null : message.a / AIM_STEPS * Math.PI * 2;
    return { turn: 0, thrust: message.p / THRUST_STEPS, brake: false, aim, fire: message.f === 1, stick: null };
}
