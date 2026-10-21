import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    TIERS, TIER_RADIUS, TIER_CREDITS, wrapCoordinate, childTier, creditsFor,
    semesterSetup, semesterLabel, earnsDiploma, angleDelta, turnToward,
    circlesOverlap, stickSteering, splitAngles,
} from '../src/rules.js';

const close = (actual, expected, epsilon = 1e-9) =>
    assert.ok(Math.abs(actual - expected) < epsilon, `${actual} is not close to ${expected}`);

describe('wrapCoordinate', () => {
    test('leaves values inside the playfield alone', () => {
        assert.equal(wrapCoordinate(3, 10), 3);
        assert.equal(wrapCoordinate(-9.5, 10), -9.5);
    });

    test('wraps past the right edge to the left', () => {
        close(wrapCoordinate(11, 10), -9);
    });

    test('wraps past the left edge to the right', () => {
        close(wrapCoordinate(-12, 10), 8);
    });

    test('margin lets objects fully leave before reappearing', () => {
        assert.equal(wrapCoordinate(10.5, 10, 1), 10.5);
        close(wrapCoordinate(11.5, 10, 1), -10.5);
    });

    test('handles values many playfields away', () => {
        close(wrapCoordinate(45, 10), 5);
    });

    test('degenerate playfield collapses to 0', () => {
        assert.equal(wrapCoordinate(5, 0), 0);
    });
});

describe('splitting deadlines', () => {
    test('exams split into assignments, assignments into quizzes', () => {
        assert.equal(childTier(TIERS.EXAM), TIERS.ASSIGNMENT);
        assert.equal(childTier(TIERS.ASSIGNMENT), TIERS.QUIZ);
    });

    test('quizzes are fully cleared', () => {
        assert.equal(childTier(TIERS.QUIZ), null);
    });

    test('smaller deadlines are smaller and worth more credits', () => {
        assert.ok(TIER_RADIUS[0] < TIER_RADIUS[1] && TIER_RADIUS[1] < TIER_RADIUS[2]);
        assert.ok(TIER_CREDITS[0] > TIER_CREDITS[1] && TIER_CREDITS[1] > TIER_CREDITS[2]);
        assert.equal(creditsFor(TIERS.QUIZ), 100);
    });

    test('unknown tiers are rejected', () => {
        assert.throws(() => creditsFor(7), RangeError);
    });

    test('split angles fan around the parent heading', () => {
        const [a, b] = splitAngles(1, 2, Math.PI / 2);
        close(a, 1 - Math.PI / 4);
        close(b, 1 + Math.PI / 4);
        assert.deepEqual(splitAngles(2, 1), [2]);
    });
});

describe('semesters', () => {
    test('difficulty ramps up', () => {
        const first = semesterSetup(1), later = semesterSetup(4);
        assert.equal(first.examCount, 3);
        assert.ok(later.examCount > first.examCount);
        assert.ok(later.speed > first.speed);
    });

    test('difficulty is capped so phones stay playable', () => {
        const extreme = semesterSetup(1000);
        assert.equal(extreme.examCount, 9);
        assert.equal(extreme.speed, 0.08);
    });

    test('bad semester numbers are treated as semester 1', () => {
        assert.deepEqual(semesterSetup(0), semesterSetup(1));
        assert.equal(semesterLabel(-3), 'Year 1 · Fall');
    });

    test('labels follow the academic calendar', () => {
        assert.equal(semesterLabel(1), 'Year 1 · Fall');
        assert.equal(semesterLabel(2), 'Year 1 · Winter');
        assert.equal(semesterLabel(3), 'Year 2 · Fall');
    });

    test('a diploma every four semesters', () => {
        assert.deepEqual([1, 2, 3, 4, 5, 8].map(earnsDiploma), [false, false, false, true, false, true]);
    });
});

describe('steering', () => {
    test('angleDelta takes the short way round', () => {
        close(angleDelta(0, Math.PI / 2), Math.PI / 2);
        close(angleDelta(0.1, Math.PI * 2 - 0.1), -0.2);
    });

    test('turnToward limits the turn rate', () => {
        close(turnToward(0, 1, 0.25), 0.25);
        close(turnToward(0, -1, 0.25), -0.25);
        assert.equal(turnToward(0, 0.1, 0.25), 0.1);
    });

    test('stick up aims up (angle 0) at full thrust', () => {
        const { aim, thrust } = stickSteering(0, 1);
        close(aim, 0);
        close(thrust, 1);
    });

    test('stick right aims clockwise a quarter turn', () => {
        close(stickSteering(1, 0).aim, Math.PI / 2);
    });

    test('a resting thumb does nothing', () => {
        assert.deepEqual(stickSteering(0.05, 0.05), { aim: null, thrust: 0 });
    });

    test('thrust is clamped for over-long stick readings', () => {
        assert.equal(stickSteering(3, 0).thrust, 1);
    });
});

describe('circlesOverlap', () => {
    test('touching circles overlap, distant ones do not', () => {
        assert.equal(circlesOverlap(0, 0, 1, 1.5, 0, 1), true);
        assert.equal(circlesOverlap(0, 0, 1, 3, 0, 1), false);
    });
});
