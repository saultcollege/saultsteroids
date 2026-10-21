/**
 * Integration tests: the real game running in LittleJS headless mode,
 * advanced frame by frame with engineStep().
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    setHeadlessMode, setEngineManualStep, engineInit, engineStep,
    setPaused, vec2, engineVersion,
} from '../lib/littlejs.esm.min.js';
import * as game from '../src/game.js';
import { Deadline, PLANE, PENCIL, NO_CONTROLS } from '../src/entities.js';
import { TIERS, STARTING_COFFEES, semesterSetup } from '../src/rules.js';
import { playfieldHalf } from '../src/playfield.js';

const { state } = game;
const seconds = (s) => Math.ceil(s * 60);
let controls = NO_CONTROLS;
let modes = [];

/** Remove every deadline so a test can set up exactly what it needs. */
function emptySky()
{
    for (const d of state.deadlines)
        d.destroy();
    state.deadlines = [];
}

function addDeadline(pos, tier, velocity = vec2())
{
    const d = new Deadline(pos, tier, velocity);
    d.angleVelocity = 0;
    state.deadlines.push(d);
    return d;
}

before(async () => {
    setHeadlessMode(true);
    setEngineManualStep(true);
    game.setControlSource(() => controls);
    game.onModeChange((mode) => modes.push(mode));
    await engineInit(game.gameInit, game.gameUpdate, game.gameUpdatePost, game.gameRender, game.gameRenderPost);
});

beforeEach(() => {
    controls = NO_CONTROLS;
    modes = [];
    setPaused(false);
});

test('vendored LittleJS matches the version in package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
    assert.equal(pkg.devDependencies.littlejsengine, engineVersion);
});

describe('title screen', () => {
    test('starts on the title with deadlines drifting behind it', () => {
        assert.equal(state.mode, 'title');
        assert.ok(state.deadlines.length > 0);
        assert.equal(state.player, null);
    });
});

describe('starting a run', () => {
    test('resets credits, coffees and semester', () => {
        state.credits = 999;
        game.startGame();
        assert.equal(state.mode, 'playing');
        assert.deepEqual(modes, ['playing']);
        assert.equal(state.credits, 0);
        assert.equal(state.coffees, STARTING_COFFEES);
        assert.equal(state.semester, 1);
        assert.equal(state.deadlines.length, semesterSetup(1).examCount);
        assert.ok(state.deadlines.every((d) => d.tier === TIERS.EXAM));
    });

    test('exams never spawn on top of the plane', () => {
        for (let i = 0; i < 20; i++)
        {
            game.startGame();
            for (const d of state.deadlines)
                assert.ok(d.pos.distance(state.player.pos) >= game.SAFE_SPAWN_DISTANCE);
        }
    });

    test('the plane starts briefly invulnerable', () => {
        game.startGame();
        assert.equal(state.player.isInvulnerable(), true);
    });
});

describe('flying the paper airplane', () => {
    beforeEach(() => {
        game.startGame();
        emptySky();
        addDeadline(vec2(-10, -10), TIERS.QUIZ); // keep the semester from ending
    });

    test('thrust flies the plane the way it faces (up)', () => {
        controls = { ...NO_CONTROLS, thrust: 1 };
        engineStep(30);
        assert.ok(state.player.pos.y > 0.5, `y=${state.player.pos.y}`);
        assert.ok(Math.abs(state.player.pos.x) < 1e-6);
    });

    test('speed is capped', () => {
        controls = { ...NO_CONTROLS, thrust: 1 };
        engineStep(seconds(5));
        assert.ok(state.player.velocity.length() <= PLANE.maxSpeed + 1e-9);
    });

    test('turning right rotates clockwise', () => {
        controls = { ...NO_CONTROLS, turn: 1 };
        engineStep(10);
        assert.ok(state.player.angle > 0);
    });

    test('a touch stick turns the plane to face it and thrusts', () => {
        controls = { ...NO_CONTROLS, stick: vec2(1, 0) };
        engineStep(30);
        assert.ok(Math.abs(state.player.angle - Math.PI / 2) < 1e-6, `angle=${state.player.angle}`);
        assert.ok(state.player.pos.x > 0);
    });

    test('flying off one edge comes back on the other', () => {
        const half = playfieldHalf();
        state.player.pos = vec2(half.x + PLANE.radius - 0.05, 0);
        state.player.velocity = vec2(0.2, 0);
        engineStep(2);
        assert.ok(state.player.pos.x < 0, `x=${state.player.pos.x}`);
    });

    test('pencils are thrown at a limited rate and expire', () => {
        controls = { ...NO_CONTROLS, fire: true };
        engineStep(1);
        assert.equal(state.pencils.length, 1);
        engineStep(seconds(PENCIL.cooldown) - 2);
        assert.equal(state.pencils.length, 1);
        controls = NO_CONTROLS;
        engineStep(seconds(PENCIL.lifeTime) + 2);
        assert.equal(state.pencils.length, 0);
    });
});

describe('clearing deadlines', () => {
    beforeEach(() => {
        game.startGame();
        state.player.invulnerable.unset();
        emptySky();
    });

    test('a pencil breaks an exam into two assignments', () => {
        const exam = addDeadline(vec2(0, 5), TIERS.EXAM);
        addDeadline(vec2(-10, -10), TIERS.QUIZ);
        controls = { ...NO_CONTROLS, fire: true };
        engineStep(1);
        controls = NO_CONTROLS;
        engineStep(20);
        assert.equal(exam.destroyed, true);
        assert.equal(state.credits, 20);
        assert.equal(state.deadlines.filter((d) => d.tier === TIERS.ASSIGNMENT).length, 2);
        assert.equal(state.pencils.length, 0, 'the pencil is used up');
    });

    test('split pieces fly apart', () => {
        const exam = addDeadline(vec2(0, 5), TIERS.EXAM, vec2(0.05, 0));
        const [a, b] = game.hitDeadline(exam);
        engineStep(30);
        assert.ok(a.pos.distance(b.pos) > 1);
    });

    test('a quiz is cleared completely for 100 credits', () => {
        const quiz = addDeadline(vec2(5, 5), TIERS.QUIZ);
        const pieces = game.hitDeadline(quiz);
        assert.deepEqual(pieces, []);
        assert.equal(state.credits, 100);
        assert.equal(state.deadlines.length, 0);
    });

    test('clearing the sky finishes the term and starts the next', () => {
        engineStep(1);
        assert.match(state.message, /Year 1 · Fall complete!/);
        engineStep(seconds(3));
        assert.equal(state.semester, 2);
        assert.equal(state.deadlines.length, semesterSetup(2).examCount);
    });

    test('finishing semester 4 earns a diploma', () => {
        state.semester = 4;
        engineStep(1);
        assert.match(state.message, /Diploma earned/);
    });
});

describe('spilling coffee', () => {
    beforeEach(() => {
        game.startGame();
        emptySky();
        state.player.invulnerable.unset();
    });

    test('hitting a deadline spills a coffee and respawns the plane', () => {
        state.player.pos = vec2(4, 4);
        addDeadline(vec2(4, 4), TIERS.QUIZ);
        engineStep(1);
        assert.equal(state.coffees, STARTING_COFFEES - 1);
        assert.ok(state.player.pos.length() < 0.1, 'back at the centre');
        assert.equal(state.player.isInvulnerable(), true);
    });

    test('no second spill while invulnerable', () => {
        addDeadline(vec2(0, 0), TIERS.EXAM);
        engineStep(seconds(1));
        assert.equal(state.coffees, STARTING_COFFEES - 1);
    });

    test('running out of coffee ends the run and records the best', () => {
        state.best = 0;
        state.credits = 1234;
        state.coffees = 1;
        addDeadline(vec2(0, 0), TIERS.EXAM);
        engineStep(1);
        assert.equal(state.mode, 'gameover');
        assert.equal(state.player, null);
        assert.equal(state.best, 1234);
        assert.ok(modes.includes('gameover'));
    });
});

describe('pausing', () => {
    test('nothing moves while paused', () => {
        game.startGame();
        state.player.velocity = vec2(0.2, 0);
        const before = state.player.pos.copy();
        setPaused(true);
        engineStep(30);
        assert.ok(state.player.pos.distance(before) < 1e-9);
    });
});
