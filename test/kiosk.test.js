/**
 * Kiosk integration tests: the real game running headless, a KioskHost, and
 * phone Controllers, all talking through an in-memory network with a fake
 * clock, so every scenario is fast and repeatable.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setHeadlessMode, setEngineManualStep, engineInit, engineStep, vec2 } from '../lib/littlejs.esm.min.js';
import * as game from '../src/game.js';
import { KioskHost } from '../src/kiosk.js';
import { Controller } from '../src/controller.js';
import { Deadline } from '../src/entities.js';
import { TIERS, STARTING_COFFEES } from '../src/rules.js';
import {
    MAX_PLAYERS, PLAYER_COLORS, PLAYER_TIMEOUT_SECONDS, HOST_TIMEOUT_SECONDS,
    NAME_ADJECTIVES, NAME_ANIMALS, lobbyChannel,
} from '../src/net/protocol.js';
import { createMemoryHub } from './helpers/memory-transport.js';

const { state } = game;
const ROOM = 'TEST';
let clock, hub, host, phones;

/** Run the whole system for some seconds of game time, one 60fps frame at a time. */
async function advance(seconds)
{
    for (let f = Math.round(seconds * 60); f--;)
    {
        clock += 1 / 60;
        for (const phone of phones)
            phone.update();
        host?.update();
        engineStep(1);
        await hub.flush();
    }
}

async function newPhone()
{
    const phone = new Controller({ transport: hub.transport, room: ROOM, now: () => clock });
    phones.push(phone);
    await phone.start();
    await hub.flush();
    return phone;
}

async function newHost()
{
    host = new KioskHost({ transport: hub.transport, room: ROOM, now: () => clock });
    await host.start();
}

const planeOf = (phone) => state.players.get(phone.id)?.plane;
const playerOf = (phone) => state.players.get(phone.id);

/** Remove all deadlines so nothing hits a plane unless a test puts it there. */
function emptySky()
{
    for (const d of state.deadlines)
        d.destroy();
    state.deadlines = [];
    // a far-off quiz keeps the semester from ending mid-test
    const keeper = new Deadline(vec2(-10.5, -10.5), TIERS.QUIZ);
    keeper.angleVelocity = 0;
    state.deadlines.push(keeper);
}

before(async () => {
    setHeadlessMode(true);
    setEngineManualStep(true);
    await engineInit(game.gameInit, game.gameUpdate, game.gameUpdatePost, game.gameRender, game.gameRenderPost);
});

beforeEach(async () => {
    clock = 0;
    hub = createMemoryHub();
    phones = [];
    game.startKiosk();
    emptySky();
    await newHost();
});

describe('joining', () => {
    test('the kiosk starts with an empty sky of exams and no players', () => {
        game.startKiosk();
        assert.equal(state.mode, 'kiosk');
        assert.equal(state.players.size, 0);
        assert.ok(state.deadlines.length > 0);
    });

    test('a phone is welcomed with a name and colour, and a plane appears', async () => {
        const phone = await newPhone();
        await advance(0.1);
        assert.equal(phone.state.phase, 'playing');
        assert.equal(phone.state.color, PLAYER_COLORS[0]);
        assert.equal(phone.state.coffees, STARTING_COFFEES);
        assert.ok(planeOf(phone), 'plane on the big screen');
        assert.equal(planeOf(phone).label, phone.state.name);
    });

    test('players get different colours', async () => {
        const a = await newPhone(), b = await newPhone();
        await advance(0.1);
        assert.notEqual(a.state.color, b.state.color);
    });

    test('names the game did not make are replaced', async () => {
        const phone = new Controller({ transport: hub.transport, room: ROOM, now: () => clock });
        phone.state.name = 'Something Rude Here';
        phones.push(phone);
        await phone.start();
        await advance(0.1);
        const [adjective, animal] = phone.state.name.split(' ');
        assert.ok(NAME_ADJECTIVES.includes(adjective) && NAME_ANIMALS.includes(animal), phone.state.name);
    });

    test('junk in the lobby is ignored', async () => {
        const rogue = await hub.transport.join(lobbyChannel(ROOM), () => {});
        rogue.send({ t: 'join', id: '../../etc', name: 'x' });
        rogue.send({ t: 'nonsense' });
        rogue.send(null);
        await advance(0.1);
        assert.equal(state.players.size, 0);
    });

    test(`only ${MAX_PLAYERS} players fit; the next is told the kiosk is full`, async () => {
        for (let i = 0; i < MAX_PLAYERS; i++)
            await newPhone();
        const extra = await newPhone();
        await advance(0.1);
        assert.equal(state.players.size, MAX_PLAYERS);
        assert.equal(extra.state.phase, 'full');
        assert.ok(phones.slice(0, MAX_PLAYERS).every((p) => p.state.phase === 'playing'));
    });

    test('a full phone can retry once someone leaves', async () => {
        for (let i = 0; i < MAX_PLAYERS; i++)
            await newPhone();
        const extra = await newPhone();
        await advance(0.1);
        phones[0].leave();
        await advance(0.1);
        extra.retry();
        await advance(0.1);
        assert.equal(extra.state.phase, 'playing');
    });

    test('a lost join is retried', async () => {
        host.stop();
        const phone = await newPhone();
        await advance(0.5);
        assert.equal(phone.state.phase, 'connecting');
        await newHost();
        await advance(4);
        assert.equal(phone.state.phase, 'playing');
    });
});

describe('flying from a phone', () => {
    test('a phone steers only its own plane', async () => {
        const a = await newPhone(), b = await newPhone();
        await advance(0.1);
        const bStart = planeOf(b).pos.copy();
        a.setInput(1, 0, false); // full right
        await advance(1);
        assert.ok(Math.abs(planeOf(a).angle - Math.PI / 2) < 1e-6, `angle ${planeOf(a).angle}`);
        assert.ok(planeOf(a).velocity.x > 0.1);
        assert.ok(planeOf(b).pos.distance(bStart) < 1e-9, 'other plane untouched');
    });

    test('fire throws pencils credited to the thrower, and the phone hears about it', async () => {
        const a = await newPhone(), b = await newPhone();
        await advance(0.1);
        planeOf(a).pos = vec2(0, 0);
        planeOf(a).angle = 0;
        planeOf(b).pos = vec2(8, -8);
        const quiz = new Deadline(vec2(0, 4), TIERS.QUIZ);
        state.deadlines.push(quiz);
        a.setInput(0, 0, true);
        await advance(1);
        assert.equal(quiz.destroyed, true);
        assert.equal(playerOf(a).credits, 100);
        assert.equal(playerOf(b).credits, 0);
        assert.equal(a.state.credits, 100, 'status reached the phone');
    });

    test('spilling coffee only costs that player', async () => {
        const a = await newPhone(), b = await newPhone();
        await advance(0.1);
        planeOf(a).invulnerable.unset();
        const exam = new Deadline(planeOf(a).pos.copy(), TIERS.EXAM);
        state.deadlines.push(exam);
        planeOf(b).pos = planeOf(a).pos.add(vec2(9, 0));
        await advance(1);
        assert.equal(playerOf(a).coffees, STARTING_COFFEES - 1);
        assert.equal(playerOf(b).coffees, STARTING_COFFEES);
        assert.equal(a.state.coffees, STARTING_COFFEES - 1);
    });

    test('running out of coffee takes the plane away; play again brings it back fresh', async () => {
        const phone = await newPhone();
        await advance(0.1);
        playerOf(phone).coffees = 1;
        playerOf(phone).credits = 640;
        planeOf(phone).invulnerable.unset();
        state.deadlines.push(new Deadline(planeOf(phone).pos.copy(), TIERS.EXAM));
        await advance(1);
        assert.equal(phone.state.phase, 'out');
        assert.equal(phone.state.credits, 640, 'final score shown on the phone');
        assert.equal(planeOf(phone), null);
        assert.equal(state.mode, 'kiosk', 'the kiosk keeps going');

        phone.playAgain();
        await advance(1);
        assert.equal(phone.state.phase, 'playing');
        assert.equal(phone.state.coffees, STARTING_COFFEES);
        assert.equal(phone.state.credits, 0);
        assert.ok(planeOf(phone));
    });
});

describe('leaving', () => {
    test('leaving removes the plane straight away, for good', async () => {
        const phone = await newPhone();
        await advance(0.1);
        phone.leave();
        await advance(0.1);
        assert.equal(state.players.size, 0);
        await advance(HOST_TIMEOUT_SECONDS + 5);
        assert.equal(state.players.size, 0, 'a phone that left does not rejoin by itself');
        assert.equal(phone.state.phase, 'left');
    });

    test('a phone that goes silent is dropped', async () => {
        const phone = await newPhone();
        await advance(0.1);
        phones = []; // stops calling update(): no input, no keepalives
        await advance(PLAYER_TIMEOUT_SECONDS + 1);
        assert.equal(state.players.size, 0);
        void phone;
    });

    test('a quiet but connected phone is kept by keepalives', async () => {
        await newPhone();
        await advance(PLAYER_TIMEOUT_SECONDS * 2);
        assert.equal(state.players.size, 1);
    });

    test('phones reconnect to a restarted kiosk', async () => {
        const phone = await newPhone();
        await advance(0.1);
        host.stop();
        game.startKiosk();
        emptySky();
        await advance(HOST_TIMEOUT_SECONDS + 0.5);
        assert.equal(phone.state.phase, 'reconnecting');
        await newHost();
        await advance(4);
        assert.equal(phone.state.phase, 'playing');
        assert.ok(planeOf(phone));
    });

    test('an empty kiosk resets to a fresh first semester', async () => {
        const phone = await newPhone();
        await advance(0.1);
        state.semester = 5;
        phone.leave();
        await advance(game.KIOSK_IDLE_RESET_SECONDS + 1);
        assert.equal(state.semester, 1);
        assert.ok(state.deadlines.every((d) => d.tier === TIERS.EXAM));
    });
});

describe('Supabase Free plan budget', () => {
    test('a full kiosk with every thumb moving stays under 100 messages a second', async () => {
        for (let i = 0; i < MAX_PLAYERS; i++)
            await newPhone();
        await advance(0.5);
        for (const p of state.players.values())
            p.plane.invulnerable.set(999); // keep everyone flying the whole time

        const before = hub.total();
        const seconds = 10;
        for (let f = 0; f < seconds * 60; f++)
        {
            // every phone's stick changes every frame: the worst case
            phones.forEach((phone, i) => phone.setInput(Math.sin(f / 7 + i), Math.cos(f / 7 + i), f % 20 < 10));
            await advance(1 / 60);
        }
        const perSecond = (hub.total() - before) / seconds;
        assert.ok(perSecond <= 100, `${perSecond} messages/s`);
    });

    test('an idle kiosk with nobody playing sends nothing', async () => {
        const before = hub.total();
        await advance(30);
        assert.equal(hub.total(), before);
    });
});

describe('join link', async () => {
    const { joinUrl } = await import('../src/kiosk-ui.js');

    test('points phones at play/ beside the game, with the room', () => {
        assert.equal(joinUrl('ABCD', 'https://saultcollege.github.io/saultsteroids/?kiosk&room=ABCD'),
            'https://saultcollege.github.io/saultsteroids/play/?room=ABCD');
        assert.equal(joinUrl('ABCD', 'https://example.org/game/index.html?kiosk'),
            'https://example.org/game/play/?room=ABCD');
    });

    test('keeps the local development transport', () => {
        assert.match(joinUrl('ABCD', 'http://localhost:8080/?kiosk&transport=local'), /transport=local/);
    });
});
