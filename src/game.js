/**
 * Saultsteroids game state and loop.
 *
 * This module knows nothing about the DOM: the browser entry point
 * (main.js) wires up input and the HTML menus, and tests drive it headless
 * through startGame(), setControlSource() and LittleJS's engineStep().
 */
import {
    vec2, rand, Timer, Sound,
    keyIsDown, keyWasPressed, mouseIsDown, gamepadIsDown, gamepadStick,
    drawRect, drawEllipseGradient, drawCircle, drawTextScreen,
    setCameraPos, setCameraScale, mainCanvasSize, paused, setPaused,
    engineObjectsDestroy, particleEffect, readSaveData, writeSaveData,
    oscillate, time,
} from '../lib/littlejs.esm.min.js';
import {
    TIERS, STARTING_COFFEES, SPLIT_COUNT,
    childTier, creditsFor, semesterSetup, semesterLabel, earnsDiploma,
    circlesOverlap, splitAngles,
} from './rules.js';
import { PaperPlane, Pencil, Deadline, PLANE, PENCIL, NO_CONTROLS } from './entities.js';
import { COLORS, FONT } from './theme.js';
import { fitPlayfield, playfieldHalf } from './playfield.js';

const SAVE_NAME = 'saultsteroids';
/** Exams never spawn closer than this to the plane. */
export const SAFE_SPAWN_DISTANCE = 7;
const MESSAGE_TIME = 2.2;

/** ZzFX sound effects, made in gameInit once the engine's audio is set up. */
let sounds;
function makeSounds()
{
    return {
        throw: new Sound([.4, .05, 900, .01, .02, .05, 1, 1.5, -15]),
        pop: new Sound([.8, .1, 320, .01, .04, .12, 4, 1.5, , , , , , 1.2, , .1, , .6, .05]),
        spill: new Sound([1.2, .05, 160, .05, .2, .5, 2, 1.5, -4, , , , , .6, , .3, , .5, .2]),
        term: new Sound([.7, 0, 520, .02, .15, .3, 1, 1.5, , , 260, .08, .1]),
    };
}

/** Everything about the current run, exported read-only for tests and the UI. */
export const state = {
    mode: 'title',        // 'title' | 'playing' | 'gameover'
    semester: 1,
    credits: 0,
    coffees: STARTING_COFFEES,
    best: 0,
    player: null,
    pencils: [],
    deadlines: [],
    message: '',
    messageTimer: new Timer(),
    nextSemesterTimer: new Timer(),
    fireCooldown: new Timer(),
};

let controlSource = readInputControls;
let modeListener = () => {};
let stars = [];

/** Replace where controls come from (tests use this; input is not available headless). */
export function setControlSource(source)
{
    controlSource = source || readInputControls;
}

/** Called with the new mode whenever it changes, so the UI can show menus. */
export function onModeChange(listener)
{
    modeListener = listener || (() => {});
}

/** Read keyboard, mouse, gamepad and the on-screen touch gamepad. */
export function readInputControls()
{
    const right = keyIsDown('ArrowRight') ? 1 : 0;
    const left = keyIsDown('ArrowLeft') ? 1 : 0;
    return {
        turn: right - left,
        thrust: keyIsDown('ArrowUp') ? 1 : 0,
        brake: keyIsDown('ArrowDown'),
        stick: gamepadStick(0),
        fire: keyIsDown('Space') || mouseIsDown(0) || gamepadIsDown(0),
    };
}

function setMode(mode)
{
    state.mode = mode;
    modeListener(mode);
}

function showMessage(text, seconds = MESSAGE_TIME)
{
    state.message = text;
    state.messageTimer.set(seconds);
}

function clearField()
{
    engineObjectsDestroy();
    state.player = null;
    state.pencils = [];
    state.deadlines = [];
}

/** Spawn the exams for a semester, away from the plane. */
function spawnSemester(semester)
{
    const { examCount, speed } = semesterSetup(semester);
    const half = playfieldHalf();
    const centre = state.player ? state.player.pos : vec2();
    for (let i = 0; i < examCount; i++)
    {
        let pos;
        do
            pos = vec2(rand(-half.x, half.x), rand(-half.y, half.y));
        while (pos.distance(centre) < SAFE_SPAWN_DISTANCE);
        const velocity = vec2().setAngle(rand(Math.PI * 2), speed * rand(0.7, 1.3));
        state.deadlines.push(new Deadline(pos, TIERS.EXAM, velocity));
    }
}

function startSemester(semester)
{
    state.semester = semester;
    spawnSemester(semester);
    showMessage(semesterLabel(semester));
}

/** Begin a new run from semester 1. */
export function startGame()
{
    clearField();
    state.credits = 0;
    state.coffees = STARTING_COFFEES;
    state.nextSemesterTimer.unset();
    state.fireCooldown.unset();
    state.player = new PaperPlane(vec2());
    state.player.invulnerable.set(1);
    setPaused(false);
    startSemester(1);
    setMode('playing');
}

/** Show drifting deadlines behind the title menu. */
export function showTitle()
{
    clearField();
    state.semester = 1;
    spawnSemester(2);
    state.message = '';
    setMode('title');
}

/** Break a deadline apart, award credits, and spawn its pieces. */
export function hitDeadline(deadline)
{
    state.credits += creditsFor(deadline.tier);
    state.deadlines = state.deadlines.filter((d) => d !== deadline);
    deadline.destroy();
    particleEffect('confetti', deadline.pos, { scale: deadline.radius });
    sounds.pop.play(deadline.pos);

    const tier = childTier(deadline.tier);
    if (tier === null)
        return [];

    const speed = Math.max(deadline.velocity.length(), semesterSetup(state.semester).speed) * 1.4;
    const heading = deadline.velocity.lengthSquared() ? deadline.velocity.angle() : rand(Math.PI * 2);
    const pieces = splitAngles(heading + rand(-0.5, 0.5), SPLIT_COUNT).map((angle) =>
        new Deadline(deadline.pos.copy(), tier, vec2().setAngle(angle, speed)));
    state.deadlines.push(...pieces);
    return pieces;
}

/** The plane hit a deadline: spill a coffee, and maybe end the run. */
export function spillCoffee()
{
    const player = state.player;
    state.coffees--;
    particleEffect('splash', player.pos, { scale: 1.5, hue: 0.07, saturation: 0.6 });
    sounds.spill.play(player.pos);

    if (state.coffees <= 0)
    {
        player.destroy();
        state.player = null;
        if (state.credits > state.best)
        {
            state.best = state.credits;
            writeSaveData(SAVE_NAME, { best: state.best });
        }
        setMode('gameover');
        return;
    }

    player.pos = vec2();
    player.velocity = vec2();
    player.angle = 0;
    player.invulnerable.set(PLANE.invulnerableTime);
}

function throwPencil()
{
    const player = state.player;
    state.pencils.push(new Pencil(player.nosePosition(), player.angle, player.velocity.scale(0.5)));
    state.fireCooldown.set(PENCIL.cooldown);
    sounds.throw.play(player.pos);
}

function handleCollisions()
{
    for (const pencil of state.pencils)
        for (const deadline of state.deadlines)
            if (!pencil.destroyed && !deadline.destroyed &&
                circlesOverlap(pencil.pos.x, pencil.pos.y, pencil.radius, deadline.pos.x, deadline.pos.y, deadline.radius))
            {
                pencil.destroy();
                hitDeadline(deadline);
            }

    const player = state.player;
    if (player && !player.isInvulnerable())
        for (const deadline of state.deadlines)
            // a little forgiveness: corners of paper do not count
            if (circlesOverlap(player.pos.x, player.pos.y, player.radius, deadline.pos.x, deadline.pos.y, deadline.radius * 0.85))
            {
                spillCoffee();
                break;
            }

    state.pencils = state.pencils.filter((p) => !p.destroyed);
}

function updateSemesterProgress()
{
    if (state.deadlines.length || state.mode !== 'playing')
        return;

    if (!state.nextSemesterTimer.isSet())
    {
        const done = `${semesterLabel(state.semester)} complete!`;
        showMessage(earnsDiploma(state.semester) ? `${done}\n🎓 Diploma earned!` : done, MESSAGE_TIME + 0.5);
        state.nextSemesterTimer.set(MESSAGE_TIME + 0.5);
        sounds.term.play();
    }
    else if (state.nextSemesterTimer.elapsed())
    {
        state.nextSemesterTimer.unset();
        startSemester(state.semester + 1);
    }
}

///////////////////////////////////////////////////////////////////////////////
// LittleJS callbacks

export function gameInit()
{
    sounds = makeSounds();
    state.best = readSaveData(SAVE_NAME, { best: 0 }).best || 0;
    stars = Array.from({ length: 90 }, () => ({
        x: rand(-1, 1), y: rand(-1, 1), size: rand(0.05, 0.14), phase: rand(10),
    }));
    fitCamera();
    showTitle();
}

function fitCamera()
{
    setCameraPos(vec2());
    setCameraScale(fitPlayfield(mainCanvasSize));
}

export function gameUpdate()
{
    fitCamera();

    if (keyWasPressed('KeyP') || keyWasPressed('Escape'))
        if (state.mode === 'playing')
            setPaused(!paused);

    if (state.mode === 'playing' && state.player)
    {
        const controls = controlSource() || NO_CONTROLS;
        state.player.controls = controls;
        if (controls.fire && !state.fireCooldown.active())
            throwPencil();
    }

    handleCollisions();
    updateSemesterProgress();
}

export function gameUpdatePost() {}

export function gameRender()
{
    const half = playfieldHalf();
    const size = half.scale(2);
    drawRect(vec2(), size, COLORS.night);

    // northern lights over the Sault: soft swaying glows in brand green and blue
    for (let i = 0; i < 3; i++)
    {
        const sway = Math.sin(time * 0.15 + i * 2.1) * size.x * 0.12;
        const pos = vec2((i - 1) * size.x * 0.38 + sway, half.y - size.y * (0.12 + 0.05 * i));
        const color = (i % 2 ? COLORS.blue : COLORS.green).withAlpha(0.16 + oscillate(0.1, 0.05, time, i));
        drawEllipseGradient(pos, vec2(size.x * 0.7, size.y * 0.35), color, color.withAlpha(0), Math.sin(time * 0.1 + i) * 0.2);
    }

    for (const s of stars)
    {
        const twinkle = 0.5 + 0.5 * Math.sin(time * 2 + s.phase);
        drawCircle(vec2(s.x * half.x, s.y * half.y), s.size, COLORS.white.withAlpha(0.3 + 0.5 * twinkle));
    }
}

export function gameRenderPost()
{
    if (state.mode === 'title')
        return;

    const w = mainCanvasSize.x;
    const unit = Math.min(w, mainCanvasSize.y) / 22;
    const pad = unit * 0.8;
    const textSize = unit * 0.9;

    drawTextScreen(`${state.credits} credits`, vec2(pad, pad + textSize / 2), textSize, COLORS.white, 0, undefined, 'left', FONT, 'bold');
    drawTextScreen('☕'.repeat(Math.max(state.coffees, 0)), vec2(w - pad, pad + textSize / 2), textSize, COLORS.white, 0, undefined, 'right', FONT);
    drawTextScreen(semesterLabel(state.semester), vec2(w / 2, pad + textSize / 2), textSize * 0.75, COLORS.blue, 0, undefined, 'center', FONT);

    const centre = vec2(w / 2, mainCanvasSize.y * 0.35);
    if (paused)
        drawTextScreen('Paused', centre, unit * 1.6, COLORS.white, unit * 0.1, COLORS.night, 'center', FONT, 'bold');
    else if (state.mode === 'playing' && state.messageTimer.active())
        drawTextScreen(state.message, centre, unit * 1.3, COLORS.white, unit * 0.1, COLORS.night, 'center', FONT, 'bold');
}
