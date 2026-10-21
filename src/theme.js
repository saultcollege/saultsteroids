/**
 * Sault College theme: colours sampled from the official logo files in the
 * Brand Centre (https://www.saultcollege.ca/welcome-our-brand-centre) and
 * the college-life flavour text used around the game.
 */
import { Color } from '../lib/littlejs.esm.min.js';
import { TIERS } from './rules.js';

const hex = (code) => new Color().setHex(code);

export const BRAND_HEX = Object.freeze({
    green: '#8EA366',    // trillium green
    blue: '#57B0E3',     // trillium blue
    charcoal: '#58585A', // logotype grey
    slate: '#4A7085',    // reverse-logo background in the style guide
});

export const COLORS = Object.freeze({
    green: hex(BRAND_HEX.green),
    blue: hex(BRAND_HEX.blue),
    charcoal: hex(BRAND_HEX.charcoal),
    slate: hex(BRAND_HEX.slate),
    night: hex('#0f1c24'),
    paper: hex('#f7f9fa'),
    paperShade: hex('#d5dee4'),
    ink: hex('#2c3e4a'),
    red: hex('#d9534f'),
    sticky: hex('#ffe36e'),
    pencil: hex('#f5c242'),
    eraser: hex('#f08aa0'),
    white: hex('#ffffff'),
});

/** Labels printed on each hazard tier. */
export const TIER_LABELS = Object.freeze({
    [TIERS.EXAM]: ['EXAM', 'MIDTERM', 'FINAL'],
    [TIERS.ASSIGNMENT]: ['ESSAY', 'LAB', 'REPORT', 'PROJECT'],
    [TIERS.QUIZ]: ['QUIZ', 'READING', 'DUE!'],
});

/** Textbook cover colours, all from the brand palette. */
export const TEXTBOOK_COVERS = Object.freeze([COLORS.slate, COLORS.green, COLORS.charcoal, COLORS.blue]);

export const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif';
