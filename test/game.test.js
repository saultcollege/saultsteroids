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
const me = () => game.localPlayer();
const plane = () => me().plane;
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
        assert.equal(state.players.size, 0);
    });
});

describe('starting a run', () => {
    test('resets credits, coffees and semester', () => {
        game.startGame();
        me().credits = 999;
        game.startGame();
        assert.equal(state.mode, 'playing');
        assert.deepEqual(modes, ['playing', 'playing']);
        assert.equal(me().credits, 0);
        assert.equal(me().coffees, STARTING_COFFEES);
        assert.equal(state.semester, 1);
        assert.equal(state.deadlines.length, semesterSetup(1).examCount);
        assert.ok(state.deadlines.every((d) => d.tier === TIERS.EXAM));
    });

    test('exams never spawn on top of the plane', () => {
        for (let i = 0; i < 20; i++)
        {
            game.startGame();
            for (const d of state.deadlines)
                assert.ok(d.pos.distance(plane().pos) >= game.SAFE_SPAWN_DISTANCE);
        }
    });

    test('the plane starts briefly invulnerable', () => {
        game.startGame();
        assert.equal(plane().isInvulnerable(), true);
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
        assert.ok(plane().pos.y > 0.5, `y=${plane().pos.y}`);
        assert.ok(Math.abs(plane().pos.x) < 1e-6);
    });

    test('speed is capped', () => {
        controls = { ...NO_CONTROLS, thrust: 1 };
        engineStep(seconds(5));
        assert.ok(plane().velocity.length() <= PLANE.maxSpeed + 1e-9);
    });

    test('turning right rotates clockwise', () => {
        controls = { ...NO_CONTROLS, turn: 1 };
        engineStep(10);
        assert.ok(plane().angle > 0);
    });

    test('a touch stick turns the plane to face it and thrusts', () => {
        controls = { ...NO_CONTROLS, stick: vec2(1, 0) };
        engineStep(30);
        assert.ok(Math.abs(plane().angle - Math.PI / 2) < 1e-6, `angle=${plane().angle}`);
        assert.ok(plane().pos.x > 0);
    });

    test('flying off one edge comes back on the other', () => {
        const half = playfieldHalf();
        plane().pos = vec2(half.x + PLANE.radius - 0.05, 0);
        plane().velocity = vec2(0.2, 0);
        engineStep(2);
        assert.ok(plane().pos.x < 0, `x=${plane().pos.x}`);
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
        plane().invulnerable.unset();
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
        assert.equal(me().credits, 20);
        assert.equal(state.deadlines.filter((d) => d.tier === TIERS.ASSIGNMENT).length, 2);
        assert.equal(state.pencils.length, 0, 'the pencil is used up');
    });

    test('credit goes to whoever threw the pencil, not just anyone', () => {
        const quiz = addDeadline(vec2(5, 5), TIERS.QUIZ);
        game.hitDeadline(quiz);
        assert.equal(me().credits, 0);
    });

    test('split pieces fly apart', () => {
        const exam = addDeadline(vec2(0, 5), TIERS.EXAM, vec2(0.05, 0));
        const [a, b] = game.hitDeadline(exam);
        engineStep(30);
        assert.ok(a.pos.distance(b.pos) > 1);
    });

    test('a quiz is cleared completely for 100 credits', () => {
        const quiz = addDeadline(vec2(5, 5), TIERS.QUIZ);
        const pieces = game.hitDeadline(quiz, me());
        assert.deepEqual(pieces, []);
        assert.equal(me().credits, 100);
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
        plane().invulnerable.unset();
    });

    test('hitting a deadline spills a coffee and respawns the plane', () => {
        plane().pos = vec2(4, 4);
        addDeadline(vec2(4, 4), TIERS.QUIZ);
        engineStep(1);
        assert.equal(me().coffees, STARTING_COFFEES - 1);
        assert.ok(plane().pos.distance(vec2(4, 4)) > 4, 'respawned clear of the quiz');
        assert.equal(plane().isInvulnerable(), true);
    });

    test('no second spill while invulnerable', () => {
        addDeadline(vec2(0, 0), TIERS.EXAM);
        engineStep(seconds(1));
        assert.equal(me().coffees, STARTING_COFFEES - 1);
    });

    test('running out of coffee ends the run and records the best', () => {
        state.best = 0;
        me().credits = 1234;
        me().coffees = 1;
        addDeadline(vec2(0, 0), TIERS.EXAM);
        engineStep(1);
        assert.equal(state.mode, 'gameover');
        assert.equal(plane(), null);
        assert.equal(me().out, true);
        assert.equal(state.best, 1234);
        assert.ok(modes.includes('gameover'));
    });
});

describe('pausing', () => {
    test('nothing moves while paused', () => {
        game.startGame();
        plane().velocity = vec2(0.2, 0);
        const before = plane().pos.copy();
        setPaused(true);
        engineStep(30);
        assert.ok(plane().pos.distance(before) < 1e-9);
    });
});
