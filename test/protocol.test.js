import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    AIM_STEPS, THRUST_STEPS, PLAYER_COLORS, MAX_PLAYERS, INPUT_HZ,
    makeRoomCode, isRoomCode, normalizeRoomCode, lobbyChannel, playerChannel,
    makePlayerId, isPlayerId, makePlayerName, NAME_ADJECTIVES, NAME_ANIMALS,
    pickColor, quantizeInput, sameInput, inputToControls,
} from '../src/net/protocol.js';

/** A predictable stand-in for Math.random. */
function sequence(...values)
{
    let i = 0;
    return () => values[i++ % values.length];
}

describe('room codes', () => {
    test('are four easy-to-read letters', () => {
        for (let i = 0; i < 200; i++)
        {
            const code = makeRoomCode();
            assert.ok(isRoomCode(code), code);
            assert.doesNotMatch(code, /[ILO01]/);
        }
    });

    test('typed codes are tidied up, and junk is rejected', () => {
        assert.equal(normalizeRoomCode(' abcd '), 'ABCD');
        assert.equal(normalizeRoomCode('ab cd'), 'ABCD');
        assert.equal(normalizeRoomCode('ABCDE'), null);
        assert.equal(normalizeRoomCode('ABIO'), null);
        assert.equal(normalizeRoomCode(undefined), null);
    });

    test('channels are namespaced by room', () => {
        assert.equal(lobbyChannel('ABCD'), 'saultsteroids:ABCD:lobby');
        assert.equal(playerChannel('ABCD', 'x1'), 'saultsteroids:ABCD:p:x1');
    });
});

describe('players', () => {
    test('ids are 10 lowercase letters or digits', () => {
        const id = makePlayerId();
        assert.ok(isPlayerId(id), id);
        assert.equal(isPlayerId('<script>'), false);
        assert.equal(isPlayerId(42), false);
    });

    test('names come from the friendly lists', () => {
        assert.equal(makePlayerName(sequence(0, 0)), `${NAME_ADJECTIVES[0]} ${NAME_ANIMALS[0]}`);
        assert.equal(makePlayerName(sequence(0.999, 0.999)), `${NAME_ADJECTIVES.at(-1)} ${NAME_ANIMALS.at(-1)}`);
    });

    test('colours are handed out without repeats while any are free', () => {
        assert.equal(pickColor([]), PLAYER_COLORS[0]);
        assert.equal(pickColor([PLAYER_COLORS[0]]), PLAYER_COLORS[1]);
        assert.ok(PLAYER_COLORS.length >= MAX_PLAYERS);
        assert.ok(PLAYER_COLORS.includes(pickColor(PLAYER_COLORS)));
    });
});

describe('input', () => {
    test('a resting stick means no aim and no thrust', () => {
        assert.deepEqual(quantizeInput(0.05, 0, false), { t: 'in', a: -1, p: 0, f: 0 });
        assert.deepEqual(quantizeInput(NaN, NaN, true), { t: 'in', a: -1, p: 0, f: 1 });
    });

    test('stick up is aim 0 at full thrust', () => {
        assert.deepEqual(quantizeInput(0, 1, true), { t: 'in', a: 0, p: THRUST_STEPS, f: 1 });
    });

    test('aim runs clockwise from up', () => {
        assert.equal(quantizeInput(1, 0, false).a, AIM_STEPS / 4);
        assert.equal(quantizeInput(0, -1, false).a, AIM_STEPS / 2);
        assert.equal(quantizeInput(-1, 0, false).a, AIM_STEPS * 3 / 4);
        assert.equal(quantizeInput(-0.01, 1, false).a, 0, 'just left of up rounds to up, not 64');
    });

    test('a gentle push is a little thrust, never none', () => {
        assert.equal(quantizeInput(0, 0.2, false).p, 1);
        assert.equal(quantizeInput(0, 5, false).p, THRUST_STEPS);
    });

    test('small wobbles quantize to the same message', () => {
        assert.ok(sameInput(quantizeInput(0.70, 0.70, false), quantizeInput(0.71, 0.69, false)));
        assert.ok(!sameInput(quantizeInput(0.7, 0.7, false), quantizeInput(0.7, 0.7, true)));
        assert.ok(!sameInput(null, quantizeInput(0, 0, false)));
    });

    test('round trip to controls', () => {
        const controls = inputToControls(quantizeInput(1, 0, true));
        assert.ok(Math.abs(controls.aim - Math.PI / 2) < 1e-9);
        assert.equal(controls.thrust, 1);
        assert.equal(controls.fire, true);
        assert.equal(inputToControls(quantizeInput(0, 0, false)).aim, null);
    });

    test('malformed input is ignored rather than trusted', () => {
        for (const bad of [null, {}, { a: 999, p: 1 }, { a: 1, p: 99 }, { a: '3', p: 1 }])
        {
            const controls = inputToControls(bad);
            assert.equal(controls.thrust, 0);
            assert.equal(controls.aim, null);
            assert.equal(controls.fire, false);
        }
    });

    test('a full kiosk stays within the Supabase Free plan rate', () => {
        // each phone message is 1 sent + 1 received by the kiosk
        assert.ok(MAX_PLAYERS * INPUT_HZ * 2 <= 100);
    });
});
