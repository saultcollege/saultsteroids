/**
 * The phone controller page (play/): a thumb stick and a throw button that
 * fly your paper airplane on the kiosk's big screen.
 */
import { Controller } from './controller.js';
import { normalizeRoomCode, MAX_PLAYERS } from './net/protocol.js';
import { createTransportFromUrl } from './net/transports.js';

const STICK_RADIUS = 60; // px of thumb travel for full thrust

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const room = normalizeRoomCode(params.get('room'));

const input = { x: 0, y: 0, fire: false };
let controller = null;
let lastCoffees = null;

///////////////////////////////////////////////////////////////////////////////
// Screens

function showOverlay(title, text, button = null)
{
    $('overlay').hidden = false;
    $('overlay-title').textContent = title;
    $('overlay-text').textContent = text;
    $('room-form').hidden = true;
    const b = $('overlay-button');
    b.hidden = !button;
    if (button)
    {
        b.textContent = button.label;
        b.onclick = button.action;
    }
}

function askForRoom(message = 'Scan the QR code on the big screen, or type the room code shown there.')
{
    showOverlay('Saultsteroids', message);
    $('room-form').hidden = false;
    $('room-form').onsubmit = (event) => {
        event.preventDefault();
        const code = normalizeRoomCode($('room-input').value);
        if (!code)
            return askForRoom('That code doesn\'t look right. It\'s four letters, like ABCD.');
        params.set('room', code);
        location.search = params;
    };
}

function render(state)
{
    document.documentElement.style.setProperty('--player', state.color ?? '#8ea366');
    $('name').textContent = state.color ? state.name : 'Saultsteroids';
    $('coffees').textContent = state.coffees === null ? '' : '☕'.repeat(Math.max(0, state.coffees));
    $('credits').textContent = state.coffees === null ? '' : `${state.credits} credits`;

    if (lastCoffees !== null && state.coffees < lastCoffees)
        navigator.vibrate?.(200); // spilled a coffee
    lastCoffees = state.coffees;

    switch (state.phase)
    {
        case 'playing':
            $('overlay').hidden = true;
            break;
        case 'connecting':
            showOverlay('Saultsteroids', `Joining room ${room}…`);
            break;
        case 'reconnecting':
            showOverlay('Reconnecting…', 'Lost touch with the big screen. Hang on a moment.');
            break;
        case 'out':
            showOverlay('Out of coffee!', `You earned ${state.credits} credits. Nice flying!`,
                { label: 'Play again', action: () => controller.playAgain() });
            break;
        case 'full':
            showOverlay('The sky is full', `Up to ${MAX_PLAYERS} people can play at once. Try again in a moment!`,
                { label: 'Try again', action: () => controller.retry() });
            break;
        case 'left':
            showOverlay('Thanks for playing!', 'Come back any time.',
                { label: 'Play again', action: () => location.reload() });
            break;
    }
}

///////////////////////////////////////////////////////////////////////////////
// Thumb stick: press anywhere in the left half, then drag

function setupStick()
{
    const zone = $('stick-zone'), base = $('stick-base'), knob = $('stick-knob');
    let pointerId = null, origin = null;

    const moveKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
    const release = (event) => {
        if (event.pointerId !== pointerId)
            return;
        pointerId = null;
        input.x = input.y = 0;
        moveKnob(0, 0);
        base.style.transform = '';
    };

    zone.addEventListener('pointerdown', (event) => {
        if (pointerId !== null)
            return;
        pointerId = event.pointerId;
        zone.setPointerCapture(pointerId);
        // the stick jumps to the thumb, so it works wherever it lands
        const rect = zone.getBoundingClientRect();
        origin = { x: event.clientX, y: event.clientY };
        base.style.transform = `translate(${event.clientX - rect.left - rect.width / 2}px, ${event.clientY - rect.top - rect.height / 2}px)`;
    });
    zone.addEventListener('pointermove', (event) => {
        if (event.pointerId !== pointerId)
            return;
        let dx = event.clientX - origin.x, dy = event.clientY - origin.y;
        const length = Math.hypot(dx, dy);
        if (length > STICK_RADIUS)
            [dx, dy] = [dx / length * STICK_RADIUS, dy / length * STICK_RADIUS];
        moveKnob(dx, dy);
        input.x = dx / STICK_RADIUS;
        input.y = -dy / STICK_RADIUS; // screen y is down, game y is up
    });
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);
}

function setupFire()
{
    const button = $('fire');
    const set = (down) => { input.fire = down; button.classList.toggle('down', down); };
    button.addEventListener('pointerdown', (event) => { button.setPointerCapture(event.pointerId); set(true); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
        button.addEventListener(type, () => set(false));
    button.addEventListener('contextmenu', (event) => event.preventDefault());
}

/** Arrow keys and space work too, for trying it on a laptop. */
function setupKeyboard()
{
    const keys = new Set();
    const apply = () => {
        input.x = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
        input.y = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
        input.fire = keys.has('Space');
    };
    addEventListener('keydown', (event) => {
        if (event.target instanceof HTMLInputElement)
            return;
        keys.add(event.code);
        apply();
        if (event.code.startsWith('Arrow') || event.code === 'Space')
            event.preventDefault();
    });
    addEventListener('keyup', (event) => { keys.delete(event.code); apply(); });
}

///////////////////////////////////////////////////////////////////////////////

async function main()
{
    if (!room)
        return askForRoom();

    setupStick();
    setupFire();
    setupKeyboard();
    // keep the screen awake while playing (needs a tap first on some phones)
    addEventListener('pointerdown', () => navigator.wakeLock?.request('screen').catch(() => {}), { once: true });

    showOverlay('Saultsteroids', `Joining room ${room}…`);
    let transport;
    try
    {
        transport = await createTransportFromUrl();
    }
    catch
    {
        return showOverlay('No connection', 'Can\'t reach the game server. Check your internet connection.',
            { label: 'Try again', action: () => location.reload() });
    }

    controller = new Controller({ transport, room, onChange: render });
    addEventListener('pagehide', () => controller.leave());
    try
    {
        await controller.start();
    }
    catch
    {
        return showOverlay('No connection', 'Can\'t reach the game server. Check your internet connection.',
            { label: 'Try again', action: () => location.reload() });
    }

    const tick = () => {
        controller.setInput(input.x, input.y, input.fire);
        controller.update();
        requestAnimationFrame(tick);
    };
    tick();
}

main();
