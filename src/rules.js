/**
 * Pure game rules for Saultsteroids.
 *
 * Nothing in here touches LittleJS, the DOM, or global state, so every rule
 * can be unit tested directly (see test/rules.test.js).
 *
 * Angles follow the LittleJS convention: radians, 0 is "up", clockwise.
 */

/** Hazard tiers, largest first. Each split drops one tier. */
export const TIERS = Object.freeze({ EXAM: 2, ASSIGNMENT: 1, QUIZ: 0 });

/** Collision radius (world units) for each tier. */
export const TIER_RADIUS = Object.freeze([0.6, 0.95, 1.5]);

/** Credits awarded for clearing each tier; smaller is harder to hit, so worth more. */
export const TIER_CREDITS = Object.freeze([100, 50, 20]);

/** How many pieces a hazard breaks into when hit. */
export const SPLIT_COUNT = 2;

/** Lives are coffees. Three is a reasonable amount of coffee. */
export const STARTING_COFFEES = 3;

/** Semesters per diploma; finishing one shows a graduation message. */
export const SEMESTERS_PER_DIPLOMA = 4;

/**
 * Wrap a single coordinate so objects leaving one edge re-enter on the other.
 * The playfield spans [-half - margin, half + margin] so objects fully leave
 * the screen before they reappear.
 */
export function wrapCoordinate(value, half, margin = 0)
{
    const extent = half + margin;
    const span = extent * 2;
    if (span <= 0)
        return 0;
    return ((value + extent) % span + span) % span - extent;
}

/** The tier a hazard breaks into, or null when it is fully cleared. */
export function childTier(tier)
{
    return tier > TIERS.QUIZ ? tier - 1 : null;
}

/** Credits earned for clearing a hazard of the given tier. */
export function creditsFor(tier)
{
    const credits = TIER_CREDITS[tier];
    if (credits === undefined)
        throw new RangeError(`Unknown tier: ${tier}`);
    return credits;
}

/**
 * How a semester starts: how many exams drift in, and how fast.
 * Difficulty ramps up but is capped so the game stays playable on a phone.
 */
export function semesterSetup(semester)
{
    const n = Math.max(1, Math.floor(semester));
    return {
        examCount: Math.min(2 + n, 9),
        speed: Math.min(0.03 + 0.006 * (n - 1), 0.08),
    };
}

/** A human label for a semester number: 1 -> "Year 1 · Fall", 2 -> "Year 1 · Winter". */
export function semesterLabel(semester)
{
    const n = Math.max(1, Math.floor(semester));
    const year = Math.ceil(n / 2);
    const term = n % 2 ? 'Fall' : 'Winter';
    return `Year ${year} · ${term}`;
}

/** True when finishing this semester completes a diploma. */
export function earnsDiploma(semester)
{
    return semester > 0 && semester % SEMESTERS_PER_DIPLOMA === 0;
}

/** Signed shortest difference between two angles, in (-PI, PI]. */
export function angleDelta(from, to)
{
    const twoPi = Math.PI * 2;
    let d = ((to - from) % twoPi + twoPi) % twoPi;
    if (d > Math.PI)
        d -= twoPi;
    return d;
}

/** Rotate `current` toward `target`, turning at most `maxStep` radians. */
export function turnToward(current, target, maxStep)
{
    const d = angleDelta(current, target);
    if (Math.abs(d) <= maxStep)
        return target;
    return current + Math.sign(d) * maxStep;
}

/** Do two circles overlap? */
export function circlesOverlap(ax, ay, ar, bx, by, br)
{
    const dx = ax - bx, dy = ay - by, r = ar + br;
    return dx * dx + dy * dy < r * r;
}

/**
 * Turn an analog stick reading into steering: the plane turns to face the
 * stick and thrusts harder the further it is pushed. A small dead zone keeps
 * a resting thumb from drifting the plane.
 */
export function stickSteering(x, y, deadZone = 0.2)
{
    const length = Math.min(Math.hypot(x, y), 1);
    if (length < deadZone)
        return { aim: null, thrust: 0 };
    // LittleJS angles: 0 is up (+y), clockwise, so atan2(x, y)
    const aim = Math.atan2(x, y);
    const thrust = (length - deadZone) / (1 - deadZone);
    return { aim, thrust };
}

/**
 * Directions for each piece of a split hazard: evenly fanned around the
 * direction the parent was travelling, so pieces fly apart.
 */
export function splitAngles(parentAngle, count = SPLIT_COUNT, spread = Math.PI / 2)
{
    if (count <= 1)
        return [parentAngle];
    const angles = [];
    for (let i = 0; i < count; i++)
        angles.push(parentAngle - spread / 2 + spread * i / (count - 1));
    return angles;
}
