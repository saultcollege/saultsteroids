/**
 * Game objects: the student's paper airplane, the pencils it throws, and the
 * deadlines (exams, assignments and quizzes) drifting through the night sky.
 *
 * All art is drawn with LittleJS shape primitives, so there are no sprite
 * sheets to load and everything stays crisp at any screen density.
 */
import {
    EngineObject, Timer, vec2, rand, randInt,
    drawPoly, drawLine, drawRect, drawText,
} from '../lib/littlejs.esm.min.js';
import { TIER_RADIUS, stickSteering, turnToward } from './rules.js';
import { COLORS, FONT, TEXTBOOK_COVERS, TIER_LABELS } from './theme.js';
import { wrapObject } from './playfield.js';

/** Tuning for the plane, in LittleJS per-frame units. */
export const PLANE = Object.freeze({
    radius: 0.55,
    turnSpeed: 0.075,     // radians per frame from keyboard
    aimTurnSpeed: 0.14,   // radians per frame when steering with a stick
    thrust: 0.011,        // acceleration per frame at full throttle
    maxSpeed: 0.32,
    damping: 0.99,
    brakeDamping: 0.94,
    invulnerableTime: 2.5,
});

export const PENCIL = Object.freeze({
    speed: 0.5,
    lifeTime: 0.9,
    radius: 0.2,
    cooldown: 0.2,
});

/** No input at all; also what tests start from. */
export const NO_CONTROLS = Object.freeze({ turn: 0, thrust: 0, brake: false, stick: null, fire: false });

/** Unit vector pointing along a LittleJS angle (0 up, clockwise). */
const direction = (angle) => vec2().setAngle(angle, 1);

export class PaperPlane extends EngineObject
{
    constructor(pos)
    {
        super(pos, vec2(1.4));
        this.damping = PLANE.damping;
        this.controls = NO_CONTROLS;
        this.invulnerable = new Timer(PLANE.invulnerableTime);
        this.thrusting = 0;
        this.renderOrder = 10;
    }

    get radius() { return PLANE.radius; }

    isInvulnerable() { return this.invulnerable.active(); }

    update()
    {
        const c = this.controls;
        let thrust = c.thrust;

        this.angle += c.turn * PLANE.turnSpeed;
        if (c.stick)
        {
            const steer = stickSteering(c.stick.x, c.stick.y, 0.1);
            if (steer.aim !== null)
                this.angle = turnToward(this.angle, steer.aim, PLANE.aimTurnSpeed);
            thrust = Math.max(thrust, steer.thrust);
        }

        this.thrusting = thrust;
        if (thrust > 0)
            this.velocity = this.velocity.add(direction(this.angle).scale(thrust * PLANE.thrust))
                .clampLength(PLANE.maxSpeed);
        this.damping = c.brake ? PLANE.brakeDamping : PLANE.damping;

        super.update();
        wrapObject(this, this.radius);
    }

    /** Where pencils leave the plane. */
    nosePosition()
    {
        return this.localToWorld(vec2(0, 0.7));
    }

    render()
    {
        // blink while invulnerable after a spill
        if (this.isInvulnerable() && (this.invulnerable.get() * 8 | 0) % 2)
            return;

        const nose = vec2(0, 0.75), tail = vec2(0, -0.35);
        const leftTip = vec2(-0.6, -0.6), rightTip = vec2(0.6, -0.6);

        // speed lines behind the plane while thrusting
        if (this.thrusting > 0)
            for (let i = 3; i--;)
            {
                const x = (i - 1) * 0.3;
                const length = 0.3 + rand(0.5) * this.thrusting;
                drawLine(vec2(x, -0.55), vec2(x, -0.55 - length), 0.06,
                    COLORS.blue.withAlpha(0.8), this.pos, this.angle);
            }

        drawPoly([nose, leftTip, tail], COLORS.paper, 0.05, COLORS.slate, this.pos, this.angle);
        drawPoly([nose, tail, rightTip], COLORS.paperShade, 0.05, COLORS.slate, this.pos, this.angle);
        // brand green fold down the keel
        drawLine(nose, tail, 0.1, COLORS.green, this.pos, this.angle);
    }
}

export class Pencil extends EngineObject
{
    constructor(pos, angle, inheritedVelocity = vec2())
    {
        super(pos, vec2(0.16, 0.7), undefined, angle);
        this.velocity = direction(angle).scale(PENCIL.speed).add(inheritedVelocity);
        this.life = new Timer(PENCIL.lifeTime);
        this.renderOrder = 5;
    }

    get radius() { return PENCIL.radius; }

    update()
    {
        super.update();
        wrapObject(this);
        if (this.life.elapsed())
            this.destroy();
    }

    render()
    {
        drawRect(this.pos, vec2(0.16, 0.5), COLORS.pencil, this.angle);
        drawRect(this.localToWorld(vec2(0, -0.28)), vec2(0.16, 0.12), COLORS.eraser, this.angle);
        drawPoly([vec2(-0.08, 0), vec2(0.08, 0), vec2(0, 0.16)], COLORS.ink, 0, undefined,
            this.localToWorld(vec2(0, 0.25)), this.angle);
    }
}

/**
 * A deadline drifting through space. Tier 2 is an exam (a textbook),
 * tier 1 an assignment (a sheet of paper), tier 0 a quiz (a sticky note).
 */
export class Deadline extends EngineObject
{
    constructor(pos, tier, velocity = vec2())
    {
        const radius = TIER_RADIUS[tier];
        super(pos, vec2(radius * 2));
        this.tier = tier;
        this.velocity = velocity.copy();
        this.angle = rand(Math.PI * 2);
        this.angleVelocity = rand(-0.02, 0.02) / (tier + 1);
        const labels = TIER_LABELS[tier];
        this.label = labels[randInt(labels.length)];
        this.cover = TEXTBOOK_COVERS[randInt(TEXTBOOK_COVERS.length)];
    }

    get radius() { return TIER_RADIUS[this.tier]; }

    update()
    {
        super.update();
        wrapObject(this, this.radius);
    }

    render()
    {
        const r = this.radius;
        if (this.tier === 2)
            this.renderTextbook(r);
        else if (this.tier === 1)
            this.renderAssignment(r);
        else
            this.renderQuiz(r);
    }

    renderTextbook(r)
    {
        const size = vec2(r * 1.6, r * 1.25);
        // pages peek out along one edge
        drawRect(this.localToWorld(vec2(size.x * 0.06, -size.y * 0.06)), size, COLORS.paper, this.angle);
        drawRect(this.pos, size, this.cover, this.angle);
        drawRect(this.localToWorld(vec2(-size.x * 0.42, 0)), vec2(size.x * 0.12, size.y), COLORS.night.withAlpha(0.35), this.angle);
        this.drawLabel(COLORS.white, r * 0.36, size.x * 0.75);
    }

    renderAssignment(r)
    {
        const size = vec2(r * 1.3, r * 1.65);
        drawRect(this.pos, size, COLORS.paper, this.angle);
        for (let i = 0; i < 4; i++)
        {
            const y = size.y * (0.3 - i * 0.2);
            drawLine(vec2(-size.x * 0.38, y), vec2(size.x * 0.38, y), 0.04, COLORS.blue.withAlpha(0.6), this.pos, this.angle);
        }
        // dog-eared corner
        const cx = size.x / 2, cy = size.y / 2, fold = r * 0.35;
        drawPoly([vec2(cx - fold, cy), vec2(cx, cy - fold), vec2(cx - fold, cy - fold)], COLORS.paperShade, 0, undefined, this.pos, this.angle);
        this.drawLabel(COLORS.red, r * 0.4, size.x * 0.85);
    }

    renderQuiz(r)
    {
        const size = vec2(r * 1.5);
        drawRect(this.pos, size, COLORS.sticky, this.angle);
        drawRect(this.localToWorld(vec2(0, size.y * 0.4)), vec2(size.x, size.y * 0.2), COLORS.night.withAlpha(0.08), this.angle);
        this.drawLabel(COLORS.ink, r * 0.42, size.x * 0.85);
    }

    drawLabel(color, size, maxWidth)
    {
        drawText(this.label, this.pos, size, color, 0, undefined, 'center', FONT, 'bold', maxWidth, this.angle);
    }
}
