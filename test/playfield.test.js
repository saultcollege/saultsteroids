import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vec2 } from '../lib/littlejs.esm.min.js';
import { fitPlayfield, playfieldHalf, wrapObject, PLAYFIELD_SHORT_SIDE } from '../src/playfield.js';

test('a landscape screen gets a wide playfield with a fixed short side', () => {
    const scale = fitPlayfield(vec2(800, 400));
    assert.equal(scale, 400 / PLAYFIELD_SHORT_SIDE);
    const half = playfieldHalf();
    assert.ok(Math.abs(half.x - PLAYFIELD_SHORT_SIDE) < 1e-9, `x=${half.x}`);
    assert.ok(Math.abs(half.y - PLAYFIELD_SHORT_SIDE / 2) < 1e-9, `y=${half.y}`);
});

test('a portrait phone gets a tall playfield', () => {
    fitPlayfield(vec2(390, 844));
    const half = playfieldHalf();
    assert.equal(half.x, PLAYFIELD_SHORT_SIDE / 2);
    assert.ok(half.y > half.x);
});

test('no canvas falls back to a square playfield', () => {
    fitPlayfield(vec2(0, 0));
    assert.deepEqual({ ...playfieldHalf() }, { x: PLAYFIELD_SHORT_SIDE / 2, y: PLAYFIELD_SHORT_SIDE / 2 });
});

test('wrapObject wraps both axes', () => {
    fitPlayfield(vec2(0, 0));
    const object = { pos: vec2(12, -12) };
    wrapObject(object);
    assert.ok(Math.abs(object.pos.x - -10) < 1e-9 && Math.abs(object.pos.y - 10) < 1e-9);
});

test('playfieldHalf returns a copy', () => {
    playfieldHalf().set(99, 99);
    assert.notEqual(playfieldHalf().x, 99);
});
