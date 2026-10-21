/**
 * Browser entry point for the big screen: engine settings, touch controls,
 * the HTML menus, and kiosk mode (`?kiosk`).
 */
import {
    engineInit, isTouchDevice, keyWasPressed, gamepadWasPressed,
    setGLEnable, setCanvasPixelRatio, setCanvasClearColor, setFontDefault,
    setTouchGamepadEnable, setTouchGamepadAnalog, setTouchGamepadButtonCount,
    setTouchGamepadSize, setTouchGamepadAlpha, setTouchGamepadDisplayTime,
    setTouchGamepadVibration,
} from '../lib/littlejs.esm.min.js';
import * as game from './game.js';
import { COLORS, FONT } from './theme.js';
import { startKiosk } from './kiosk-ui.js';
import { createTransportFromUrl } from './net/transports.js';

const kioskMode = new URLSearchParams(location.search).has('kiosk');

// Plain Canvas2D keeps labels drawn in order with the shapes; there are
// only a few dozen objects, which phones handle easily.
setGLEnable(false);
setCanvasPixelRatio(undefined); // track devicePixelRatio for sharp text on phones
setCanvasClearColor(COLORS.night);
setFontDefault(FONT);

if (isTouchDevice && !kioskMode)
{
    setTouchGamepadEnable(true);
    setTouchGamepadAnalog(true);   // left thumb: steer and thrust
    setTouchGamepadButtonCount(1); // right thumb: throw pencils
    setTouchGamepadSize(130);
    setTouchGamepadAlpha(0.35);
    setTouchGamepadDisplayTime(0); // always visible
    setTouchGamepadVibration(15);
}

const menus = {
    title: document.getElementById('title-menu'),
    gameover: document.getElementById('gameover-menu'),
};

function showMenu(mode)
{
    for (const [name, menu] of Object.entries(menus))
        menu.hidden = name !== mode;

    if (mode === 'gameover')
    {
        document.getElementById('final-credits').textContent = game.localPlayer()?.credits ?? 0;
        document.getElementById('final-semester').textContent = game.state.semester;
        document.getElementById('best-credits').textContent = game.state.best;
    }
    menus[mode]?.querySelector('button')?.focus({ preventScroll: true });
}

for (const button of document.querySelectorAll('[data-action="start"]'))
    button.addEventListener('click', () => game.startGame());

game.onModeChange(showMenu);
document.body.classList.toggle('touch', isTouchDevice);

let kiosk = null;

function gameInit()
{
    game.gameInit();
    if (kioskMode)
        kiosk = startKiosk(createTransportFromUrl);
}

function gameUpdate()
{
    if (kiosk)
        kiosk.update();
    else
    {
        // keyboard and gamepad can start a run from either menu
        const menuOpen = game.state.mode !== 'playing';
        if (menuOpen && (keyWasPressed('Enter') || gamepadWasPressed(9) || gamepadWasPressed(0) && !isTouchDevice))
            game.startGame();
    }
    game.gameUpdate();
}

engineInit(gameInit, gameUpdate, game.gameUpdatePost, game.gameRender, game.gameRenderPost);
