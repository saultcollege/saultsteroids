/**
 * The playfield is the visible area of the screen, centred on the origin.
 * Everything wraps around its edges, Asteroids style.
 */
import { vec2 } from '../lib/littlejs.esm.min.js';
import { wrapCoordinate } from './rules.js';

/** Shortest side of the playfield in world units, whatever the screen shape. */
export const PLAYFIELD_SHORT_SIDE = 22;

const half = vec2(PLAYFIELD_SHORT_SIDE / 2);

/** Half the playfield size; read-only to callers. */
export function playfieldHalf()
{
    return half.copy();
}

/** Resize the playfield to match a screen of the given pixel size. Returns the camera scale to use. */
export function fitPlayfield(screenSize)
{
    // headless (tests) has no canvas: use a square playfield
    if (!(screenSize.x > 0 && screenSize.y > 0))
    {
        half.set(PLAYFIELD_SHORT_SIDE / 2, PLAYFIELD_SHORT_SIDE / 2);
        return 1;
    }
    const scale = Math.min(screenSize.x, screenSize.y) / PLAYFIELD_SHORT_SIDE;
    half.set(screenSize.x / scale / 2, screenSize.y / scale / 2);
    return scale;
}

/** Wrap an object's position around the playfield edges, letting it fully leave first. */
export function wrapObject(object, margin = 0)
{
    object.pos.set(
        wrapCoordinate(object.pos.x, half.x, margin),
        wrapCoordinate(object.pos.y, half.y, margin));
}
