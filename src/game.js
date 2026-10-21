/**
 * Saultsteroids game state and loop.
 *
 * Two ways to play:
 *  - solo ('title' -> 'playing' -> 'gameover'): one local player on this device.
 *  - kiosk ('kiosk'): the big screen at an open house; visitors join and
 *    leave from their phones (see kiosk.js), each with their own plane,
 *    coffees and credits, all clearing the same sky.
 *
 * This module knows nothing about the DOM or the network: main.js wires up
 * input and menus, kiosk.js connects phones, and tests drive it headless
 * through these exports and LittleJS's engineStep().
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
/** Exams never spawn closer than this to a plane, and planes never respawn closer than this to a deadline. */
export const SAFE_SPAWN_DISTANCE = 7;
/** With nobody playing for this long, the kiosk starts a fresh sky for the next visitors. */
export const KIOSK_IDLE_RESET_SECONDS = 20;
/** The id of the player on this device in solo play. */
export const LOCAL_PLAYER_ID = 'you';
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

/** Everything about the current game, exported read-only for tests and the UI. */
export const state = {
    mode: 'title',        // 'title' | 'playing' | 'gameover' | 'kiosk'
    semester: 1,
    best: 0,
    /** @type {Map<string, Player>} */
    players: new Map(),
    pencils: [],
    deadlines: [],
    message: '',
    messageTimer: new Timer(),
    nextSemesterTimer: new Timer(),
    idleTimer: new Timer(),
};

/**
 * @typedef {object} Player
 * @property {string} id
 * @property {string} name
 * @property {Color} color
 * @property {boolean} local     controlled from this device's keyboard, mouse or gamepad
 * @property {number} coffees
 * @property {number} credits
 * @property {boolean} out       ran out of coffee
 * @property {PaperPlane|null} plane
 * @property {object} controls   latest controls from a phone
 * @property {Timer} fireCooldown
 */

let controlSource = readInputControls;
let modeListener = () => {};
let stars = [];

/** Replace where the local player's controls come from (tests use this; input is not available headless). */
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
        aim: null,
        fire: keyIsDown('Space') || mouseIsDown(0) || gamepadIsDown(0),
    };
}

/** The solo player, if there is one. */
export function localPlayer()
{
    return state.players.get(LOCAL_PLAYER_ID);
}

/** Players still flying. */
export function activePlayers()
{
    return [...state.players.values()].filter((p) => p.plane);
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
    state.players.clear();
    state.pencils = [];
    state.deadlines = [];
    state.nextSemesterTimer.unset();
    state.idleTimer.unset();
    state.message = '';
}

function randomPosition()
{
    const half = playfieldHalf();
    return vec2(rand(-half.x, half.x), rand(-half.y, half.y));
}

/** Spawn the exams for a semester, away from every plane. */
function spawnSemester(semester)
{
    const { examCount, speed } = semesterSetup(semester);
    const planes = activePlayers().map((p) => p.plane.pos);
    const avoid = planes.length ? planes : [vec2()];
    for (let i = 0; i < examCount; i++)
    {
        let pos;
        do
            pos = randomPosition();
        while (avoid.some((p) => pos.distance(p) < SAFE_SPAWN_DISTANCE));
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

/** Somewhere for a plane to (re)appear: the centre if it is clear, otherwise the clearest spot found. */
export function safeSpawnPosition()
{
    const clearance = (pos) => Math.min(Infinity, ...state.deadlines.map((d) => pos.distance(d.pos) - d.radius));
    let best = vec2(), bestClearance = clearance(best);
    for (let i = 0; i < 40 && bestClearance < SAFE_SPAWN_DISTANCE; i++)
    {
        const pos = randomPosition().scale(0.8);
        const c = clearance(pos);
        if (c > bestClearance)
            [best, bestClearance] = [pos, c];
    }
    return best;
}

function launchPlane(player)
{
    const label = player.local ? '' : player.name;
    player.plane = new PaperPlane(safeSpawnPosition(), player.color, label);
    player.plane.invulnerable.set(PLANE.invulnerableTime);
}

/**
 * Add a player and launch their plane.
 * @returns {Player}
 */
export function addPlayer(id, { name = '', color = COLORS.green, local = false } = {})
{
    removePlayer(id);
    const player = {
        id, name, color, local,
        coffees: STARTING_COFFEES,
        credits: 0,
        out: false,
        plane: null,
        controls: NO_CONTROLS,
        fireCooldown: new Timer(),
    };
    state.players.set(id, player);
    launchPlane(player);
    return player;
}

export function removePlayer(id)
{
    const player = state.players.get(id);
    player?.plane?.destroy();
    state.players.delete(id);
}

/** A player who ran out of coffee starts over with a full tray. */
export function restartPlayer(id)
{
    const player = state.players.get(id);
    if (!player || !player.out)
        return;
    player.coffees = STARTING_COFFEES;
    player.credits = 0;
    player.out = false;
    launchPlane(player);
}

/** Set a remote player's controls (from their phone). */
export function setPlayerControls(id, controls)
{
    const player = state.players.get(id);
    if (player)
        player.controls = controls || NO_CONTROLS;
}

/** Begin a solo run from semester 1. */
export function startGame()
{
    clearField();
    setPaused(false);
    addPlayer(LOCAL_PLAYER_ID, { local: true });
    localPlayer().plane.invulnerable.set(1);
    startSemester(1);
    setMode('playing');
}

/** Show drifting deadlines behind the title menu. */
export function showTitle()
{
    clearField();
    state.semester = 1;
    spawnSemester(2);
    setMode('title');
}

/** Turn this screen into the open-house kiosk: a shared sky that phones join. */
export function startKiosk()
{
    clearField();
    setPaused(false);
    startSemester(1);
    state.message = '';
    setMode('kiosk');
}

/** Break a deadline apart, award credits to whoever hit it, and spawn its pieces. */
export function hitDeadline(deadline, player = null)
{
    if (player)
        player.credits += creditsFor(deadline.tier);
    state.deadlines = state.deadlines.filter((d) => d !== deadline);
    deadline.destroy();
    particleEffect('confetti', deadline.pos, { scale: deadline.radius });
    sounds?.pop.play(deadline.pos);

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

/** A plane hit a deadline: that player spills a coffee, and may be out. */
export function spillCoffee(player)
{
    const plane = player.plane;
    player.coffees--;
    particleEffect('splash', plane.pos, { scale: 1.5, hue: 0.07, saturation: 0.6 });
    sounds?.spill.play(plane.pos);

    if (player.coffees > 0)
    {
        plane.pos = safeSpawnPosition();
        plane.velocity = vec2();
        plane.angle = 0;
        plane.invulnerable.set(PLANE.invulnerableTime);
        return;
    }

    plane.destroy();
    player.plane = null;
    player.out = true;

    if (player.local)
    {
        if (player.credits > state.best)
        {
            state.best = player.credits;
            writeSaveData(SAVE_NAME, { best: state.best });
        }
        setMode('gameover');
    }
}

function throwPencil(player)
{
    const plane = player.plane;
    state.pencils.push(new Pencil(plane.nosePosition(), plane.angle, plane.velocity.scale(0.5), player));
    player.fireCooldown.set(PENCIL.cooldown);
    sounds?.throw.play(plane.pos);
}

function handleCollisions()
{
    for (const pencil of state.pencils)
        for (const deadline of state.deadlines)
            if (!pencil.destroyed && !deadline.destroyed &&
                circlesOverlap(pencil.pos.x, pencil.pos.y, pencil.radius, deadline.pos.x, deadline.pos.y, deadline.radius))
            {
                pencil.destroy();
                hitDeadline(deadline, pencil.owner);
            }

    for (const player of activePlayers())
    {
        const plane = player.plane;
        if (plane.isInvulnerable())
            continue;
        // a little forgiveness: corners of paper do not count
        if (state.deadlines.some((d) => circlesOverlap(plane.pos.x, plane.pos.y, plane.radius, d.pos.x, d.pos.y, d.radius * 0.85)))
            spillCoffee(player);
    }

    state.pencils = state.pencils.filter((p) => !p.destroyed);
}

function updateSemesterProgress()
{
    if (state.deadlines.length || (state.mode !== 'playing' && state.mode !== 'kiosk'))
        return;

    if (!state.nextSemesterTimer.isSet())
    {
        const done = `${semesterLabel(state.semester)} complete!`;
        showMessage(earnsDiploma(state.semester) ? `${done}\n🎓 Diploma earned!` : done, MESSAGE_TIME + 0.5);
        state.nextSemesterTimer.set(MESSAGE_TIME + 0.5);
        sounds?.term.play();
    }
    else if (state.nextSemesterTimer.elapsed())
    {
        state.nextSemesterTimer.unset();
        startSemester(state.semester + 1);
    }
}

/** With nobody playing for a while, the kiosk resets to a fresh first semester. */
function updateKioskIdle()
{
    if (state.mode !== 'kiosk')
        return;
    if (activePlayers().length)
    {
        state.idleTimer.unset();
        return;
    }
    if (!state.idleTimer.isSet())
        state.idleTimer.set(KIOSK_IDLE_RESET_SECONDS);
    else if (state.idleTimer.elapsed())
    {
        state.idleTimer.unset();
        for (const d of state.deadlines)
            d.destroy();
        state.deadlines = [];
        state.nextSemesterTimer.unset();
        startSemester(1);
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

    for (const player of activePlayers())
    {
        const controls = (player.local ? controlSource() : player.controls) || NO_CONTROLS;
        player.plane.controls = controls;
        if (controls.fire && !player.fireCooldown.active())
            throwPencil(player);
    }

    handleCollisions();
    updateSemesterProgress();
    updateKioskIdle();
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
    const top = pad + textSize / 2;

    // the kiosk's scoreboard is HTML (kiosk-ui.js); solo shows this player's numbers
    const me = localPlayer();
    if (me)
    {
        drawTextScreen(`${me.credits} credits`, vec2(pad, top), textSize, COLORS.white, 0, undefined, 'left', FONT, 'bold');
        drawTextScreen('☕'.repeat(Math.max(me.coffees, 0)), vec2(w - pad, top), textSize, COLORS.white, 0, undefined, 'right', FONT);
    }
    const labelX = state.mode === 'kiosk' ? pad : w / 2;
    drawTextScreen(semesterLabel(state.semester), vec2(labelX, top), textSize * 0.75, COLORS.blue, 0, undefined,
        state.mode === 'kiosk' ? 'left' : 'center', FONT);

    const centre = vec2(w / 2, mainCanvasSize.y * 0.35);
    if (paused)
        drawTextScreen('Paused', centre, unit * 1.6, COLORS.white, unit * 0.1, COLORS.night, 'center', FONT, 'bold');
    else if (state.messageTimer.active() && (state.mode === 'playing' || state.mode === 'kiosk'))
        drawTextScreen(state.message, centre, unit * 1.3, COLORS.white, unit * 0.1, COLORS.night, 'center', FONT, 'bold');
}
