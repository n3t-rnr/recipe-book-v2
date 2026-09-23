// Generator for the "C · Bildlastig" mockups (light + dark from shared building blocks).
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: node gen-c.mjs <project-dir>');

const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&amp;family=Figtree:wght@400;500;600;700&amp;display=swap">';
const DISPLAY = "'Bricolage Grotesque', 'Segoe UI', system-ui, sans-serif";
const BODY = "'Figtree', 'Segoe UI', system-ui, sans-serif";

const LIGHT = {
  mode: 'light', bg: '#EFE6DD', text: '#231F20', muted: '#4A4445', surface: '#F6EDE4', raised: '#FBF6F1',
  border: 'rgba(35,31,32,0.14)', borderStrong: '#827D7E', primary: '#BB4430', onPrimary: '#FFFFFF',
  primaryText: '#A33A29', secondary: '#7EBDC2', highlight: '#F3DFA2', ink: '#231F20',
  nav: '#231F20', navBorder: 'transparent', navText: '#EFE6DD', navActive: '#D9634F', navActiveIcon: '#231F20',
  overlay: 'rgba(246,237,228,0.92)', overlayBorder: 'rgba(35,31,32,0.2)', heart: '#BB4430',
  starStroke: '#231F20', starEmpty: '#827D7E', scrim: 'rgba(35,31,32,0.45)', inputBg: '#FBF6F1',
  shadow: 'rgba(35,31,32,0.22)', photoBg: '#3B3230', toastBg: '#231F20', toastText: '#EFE6DD',
  subtle: 'rgba(35,31,32,0.08)',
};
const DARK = {
  mode: 'dark', bg: '#231F20', text: '#EFE6DD', muted: '#C9BFB6', surface: '#2F2B2C', raised: '#373334',
  border: 'rgba(239,230,221,0.14)', borderStrong: '#90877F', primary: '#D9634F', onPrimary: '#231F20',
  primaryText: '#F57C67', secondary: '#7EBDC2', highlight: '#F3DFA2', ink: '#231F20',
  nav: '#373334', navBorder: 'rgba(239,230,221,0.14)', navText: '#EFE6DD', navActive: '#D9634F', navActiveIcon: '#231F20',
  overlay: 'rgba(47,43,44,0.92)', overlayBorder: 'rgba(239,230,221,0.2)', heart: '#D9634F',
  starStroke: '#EFE6DD', starEmpty: '#90877F', scrim: 'rgba(0,0,0,0.55)', inputBg: '#2F2B2C',
  shadow: 'rgba(0,0,0,0.45)', photoBg: '#4A403D', toastBg: '#EFE6DD', toastText: '#231F20',
  subtle: 'rgba(239,230,221,0.08)',
};
const THEMES = { hell: LIGHT, dunkel: DARK };

const AVATARS = {
  light: [['#BB4430', '#FFFFFF'], ['#7EBDC2', '#231F20'], ['#F3DFA2', '#231F20'], ['#231F20', '#EFE6DD'], ['#A33A29', '#FFFFFF'], ['#216267', '#FFFFFF']],
  dark: [['#D9634F', '#231F20'], ['#7EBDC2', '#231F20'], ['#F3DFA2', '#231F20'], ['#EFE6DD', '#231F20'], ['#A33A29', '#FFFFFF'], ['#216267', '#FFFFFF']],
};
const PROFILES = [
  { name: 'Sebastian', letter: 'S', av: 0 },
  { name: 'Anna', letter: 'A', av: 1 },
  { name: 'Jonas', letter: 'J', av: 2 },
  { name: 'Oma Hilde', letter: 'O', av: 5 },
];
const ANNA = PROFILES[1];

// Platzhalterbild: Hintergrundfarbe aus der Rezept-ID (ph = id mod 4)
const PH = ['#F3DFA2', '#7EBDC2', '#E8B7A9', '#DCCFC2'];

const R = {
  kaese: { title: 'Käsespätzle', photo: true, time: '45 min', rating: '4,3', count: 3, tags: ['Vegetarisch', 'Hauptgericht'], fav: true, ph: 1 },
  kuerbis: { title: 'Kürbissuppe mit Ingwer', photo: false, time: '35 min', rating: '4,7', count: 2, tags: ['Vegetarisch', 'Suppe'], fav: false, ph: 2 },
  linsen: { title: 'Linsensuppe', photo: true, time: '50 min', rating: '4,0', count: 1, tags: ['Vegetarisch', 'Suppe'], fav: true, ph: 3 },
  spinat: { title: 'Spinatknödel mit brauner Butter', photo: false, time: '60 min', rating: '4,5', count: 2, tags: ['Vegetarisch', 'Hauptgericht'], fav: true, ph: 1 },
  ofen: { title: 'Ofengemüse mit Feta', photo: true, time: '40 min', rating: null, count: 0, tags: ['Vegetarisch', 'Hauptgericht'], fav: false, ph: 0 },
  pilz: { title: 'Pilzrisotto', photo: false, time: '35 min', rating: '4,0', count: 1, tags: ['Vegetarisch', 'Hauptgericht'], fav: false, ph: 0 },
  zwetschge: { title: 'Zwetschgenkuchen', photo: false, time: '90 min', rating: '4,5', count: 4, tags: ['Vegetarisch', 'Backen', 'Dessert'], fav: true, ph: 3 },
  curry: { title: 'Gemüsecurry mit Kichererbsen', photo: true, time: '30 min', rating: '3,8', count: 2, tags: ['Vegetarisch', 'Schnell', 'Hauptgericht'], fav: false, ph: 2 },
};

// ---------------------------------------------------------------- icons
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.6-3.6"></path>',
  filter: '<path d="M4 7h9"></path><path d="M17 7h3"></path><circle cx="15" cy="7" r="2"></circle><path d="M4 17h3"></path><path d="M11 17h9"></path><circle cx="9" cy="17" r="2"></circle>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"></path><path d="M19.5 4.5v4.5H15"></path>',
  heart: '<path d="M12 20.2s-7.5-4.6-7.5-10.4A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7c0 5.8-7.5 10.4-7.5 10.4z"></path>',
  plus: '<path d="M12 5v14"></path><path d="M5 12h14"></path>',
  star: '<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"></path>',
  clock: '<circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path>',
  back: '<path d="M15 5l-7 7 7 7"></path>',
  book: '<path d="M4 5.5c2.5-1 5.5-1 8 .5v13c-2.5-1.5-5.5-1.5-8-.5z"></path><path d="M20 5.5c-2.5-1-5.5-1-8 .5v13c2.5-1.5 5.5-1.5 8-.5z"></path>',
  tag: '<path d="M3.5 11.8V4.8a1.3 1.3 0 0 1 1.3-1.3h7l8.4 8.4a1.3 1.3 0 0 1 0 1.8l-6.8 6.8a1.3 1.3 0 0 1-1.8 0z"></path><circle cx="8.3" cy="8.3" r="1.4"></circle>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"></path>',
  pencil: '<path d="M4.5 19.5h4l10-10-4-4-10 10z"></path><path d="M13 7l4 4"></path>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"></rect><circle cx="9" cy="10" r="1.7"></circle><path d="M20.5 16l-5-5-8.5 8"></path>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.5-2h5.4l1.5 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"></path><circle cx="12" cy="13" r="3.5"></circle>',
  chevDown: '<path d="M6 9l6 6 6-6"></path>',
  chevRight: '<path d="M9 6l6 6-6 6"></path>',
  close: '<path d="M6.5 6.5l11 11"></path><path d="M17.5 6.5l-11 11"></path>',
  trash: '<path d="M4.5 7h15"></path><path d="M9.5 7V4.5h5V7"></path><path d="M6.5 7l1 12.5h9l1-12.5"></path>',
  alert: '<circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.8v5"></path><path d="M12 16.2v.3"></path>',
  info: '<circle cx="12" cy="12" r="8.5"></circle><path d="M12 11v5"></path><path d="M12 7.8v.3"></path>',
  users: '<circle cx="9" cy="8" r="3.2"></circle><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"></path><path d="M15.5 5a3.2 3.2 0 0 1 0 6.2"></path><path d="M17.5 14.2a5.5 5.5 0 0 1 3 5.3"></path>',
  dotsH: '<circle cx="5.5" cy="12" r="1.7"></circle><circle cx="12" cy="12" r="1.7"></circle><circle cx="18.5" cy="12" r="1.7"></circle>',
  dotsV: '<circle cx="12" cy="5.5" r="1.7"></circle><circle cx="12" cy="12" r="1.7"></circle><circle cx="12" cy="18.5" r="1.7"></circle>',
  grip: '<circle cx="9" cy="6" r="1.5"></circle><circle cx="15" cy="6" r="1.5"></circle><circle cx="9" cy="12" r="1.5"></circle><circle cx="15" cy="12" r="1.5"></circle><circle cx="9" cy="18" r="1.5"></circle><circle cx="15" cy="18" r="1.5"></circle>',
};
const FILLED = new Set(['dotsH', 'dotsV', 'grip']);
function ic(name, size = 24, color = 'currentColor', sw = 2) {
  const f = FILLED.has(name);
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${f ? color : 'none'}" stroke="${f ? 'none' : color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}
function starSvg(T, size, filled) {
  return filled
    ? `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${T.highlight}" stroke="${T.starStroke}" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">${ICONS.star}</svg>`
    : `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${T.starEmpty}" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">${ICONS.star}</svg>`;
}
function heartSvg(T, on, size = 24) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${on ? T.heart : 'none'}" stroke="${T.heart}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS.heart}</svg>`;
}

// ---------------------------------------------------------------- document
function doc(title, T, w, h, body, { flex = false } = {}) {
  const layout = flex ? ' display: flex; flex-direction: column;' : '';
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
${FONTS}
<style>
body{margin:0;background:${T.bg};color:${T.text};font-family:'Figtree','Segoe UI',system-ui,sans-serif}
a{color:${T.text}}a:hover{color:${T.primaryText}}
button{font:inherit;color:inherit;cursor:pointer}
input,textarea{font:inherit;color:inherit}
input::placeholder,textarea::placeholder{color:${T.muted};opacity:1}
</style>
</helmet>
<div style="width: ${w}px; height: ${h}px; position: relative; overflow: hidden; box-sizing: border-box; background: ${T.bg}; color: ${T.text}; font-family: ${BODY};${layout}">
${body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${w},"height":${h}}}'>
class Component extends DCLogic {
renderVals() {
return {};
}
}
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- media
function plateSvg(T, ph, letter, { cutlery = true } = {}) {
  const col = PH[ph];
  const dark = T.mode === 'dark';
  const plateFill = dark ? col : 'rgba(255,255,255,0.42)';
  const plateStroke = dark ? col : 'rgba(35,31,32,0.32)';
  const inner = dark ? 'rgba(35,31,32,0.26)' : 'rgba(35,31,32,0.2)';
  const cut = dark ? col : 'rgba(35,31,32,0.5)';
  const text = letter ? `<text x="120" y="82" text-anchor="middle" dominant-baseline="central" font-family="Bricolage Grotesque, Segoe UI, sans-serif" font-weight="800" font-size="40" fill="#231F20">${letter}</text>` : '';
  const cutl = cutlery
    ? `<g fill="none" stroke="${cut}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M42 44v20"></path><path d="M50 44v20"></path><path d="M58 44v20"></path><path d="M42 64q0 8 8 8q8 0 8-8"></path><path d="M50 72v46"></path><path d="M190 118V44q14 10 14 34q0 6-6 6h-8"></path></g>`
    : '';
  return `<svg viewBox="0 0 240 160" preserveAspectRatio="xMidYMid meet" style="display: block; width: 100%; height: 100%;" aria-hidden="true"><circle cx="120" cy="80" r="50" fill="${plateFill}" stroke="${plateStroke}" stroke-width="2"></circle><circle cx="120" cy="80" r="38" fill="none" stroke="${inner}" stroke-width="1.5"></circle>${text}${cutl}</svg>`;
}
function placeholder(T, r, { w = '100%', h, radius = 0, add = false } = {}) {
  const bg = T.mode === 'dark' ? T.surface : PH[r.ph];
  const addBtn = add
    ? `<button type="button" style="position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%); height: 48px; display: flex; align-items: center; gap: 8px; padding: 0 20px 0 16px; border: 1px solid ${T.overlayBorder}; border-radius: 24px; background: ${T.overlay}; color: ${T.text}; font-size: 16px; font-weight: 700; white-space: nowrap;">${ic('camera', 22)}Foto hinzufügen</button>`
    : '';
  return `<div role="img" aria-label="Noch kein Foto: ${r.title}" style="position: relative; width: ${w}; height: ${h}px; flex-shrink: 0; box-sizing: border-box; overflow: hidden; border-radius: ${radius}px; background: ${bg};">${plateSvg(T, r.ph, r.title[0])}${addBtn}</div>`;
}
function photo(T, r, { w = '100%', h, radius = 0 } = {}) {
  const small = h < 110;
  const label = small ? '' : `<span style="font-size: 13px; font-weight: 600;">Foto · ${r.title}</span>`;
  return `<div role="img" aria-label="Foto: ${r.title}" style="width: ${w}; height: ${h}px; flex-shrink: 0; box-sizing: border-box; overflow: hidden; border-radius: ${radius}px; background-color: ${T.photoBg}; background-image: repeating-linear-gradient(135deg, rgba(239,230,221,0.05) 0 2px, transparent 2px 14px); color: #EFE6DD; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;">${ic('image', small ? 20 : 30, 'currentColor', 1.6)}${label}</div>`;
}
function media(T, r, opts) { return r.photo ? photo(T, r, opts) : placeholder(T, r, opts); }

// ---------------------------------------------------------------- small parts
function avatar(T, p, size = 38, fs = 17) {
  const [bg, fg] = AVATARS[T.mode][p.av];
  return `<span style="width: ${size}px; height: ${size}px; flex-shrink: 0; box-sizing: border-box; border-radius: ${size / 2}px; border: 1px solid ${T.border}; background: ${bg}; color: ${fg}; display: flex; align-items: center; justify-content: center; font-family: ${DISPLAY}; font-weight: 800; font-size: ${fs}px;">${p.letter}</span>`;
}
function iconBtn(T, name, label, { size = 44, color = 'currentColor', extra = '' } = {}) {
  return `<button type="button" aria-label="${label}" style="width: ${size}px; height: ${size}px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border: 0; border-radius: ${size / 2}px; background: transparent; padding: 0;${extra}">${ic(name, 22, color)}</button>`;
}
function overlayBtn(T, inner, label, size = 48, pressed = null) {
  const pr = pressed === null ? '' : ` aria-pressed="${pressed}"`;
  return `<button type="button" aria-label="${label}"${pr} style="width: ${size}px; height: ${size}px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border: 1px solid ${T.overlayBorder}; border-radius: ${size / 2}px; background: ${T.overlay}; color: ${T.text}; padding: 0;">${inner}</button>`;
}
function heartBtn(T, on) { return overlayBtn(T, heartSvg(T, on), 'Favorit', 48, on); }
function avatarBtn(T, p) {
  return `<button type="button" aria-label="Profil wechseln, aktiv: ${p.name}" style="width: 44px; height: 44px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border: 0; background: transparent; padding: 0;">${avatar(T, p)}</button>`;
}
function chip(T, label, { active = false, count = null, outline = false } = {}) {
  const cnt = count === null ? '' : `<span style="font-weight: 500;">${count}</span>`;
  if (active) {
    return `<button type="button" aria-pressed="true" style="flex-shrink: 0; height: 44px; display: flex; align-items: center; gap: 6px; padding: 0 18px 0 14px; border: 0; border-radius: 22px; background: ${T.primary}; color: ${T.onPrimary}; font-size: 15px; font-weight: 700; white-space: nowrap;">${ic('check', 18, 'currentColor', 2.6)}${label}${cnt}</button>`;
  }
  if (outline) {
    return `<button type="button" style="flex-shrink: 0; height: 44px; display: flex; align-items: center; gap: 6px; padding: 0 18px; box-sizing: border-box; border: 1.5px solid ${T.borderStrong}; border-radius: 22px; background: transparent; color: ${T.text}; font-size: 15px; font-weight: 600; white-space: nowrap;">${label}${cnt}</button>`;
  }
  return `<button type="button" aria-pressed="false" style="flex-shrink: 0; height: 44px; display: flex; align-items: center; gap: 6px; padding: 0 18px; border: 0; border-radius: 22px; background: ${T.secondary}; color: ${T.ink}; font-size: 15px; font-weight: 600; white-space: nowrap;">${label}${cnt}</button>`;
}
function tagPill(T, label) {
  return `<span style="height: 28px; padding: 0 10px; border-radius: 14px; background: ${T.secondary}; color: ${T.ink}; font-size: 13px; font-weight: 600; display: flex; align-items: center; white-space: nowrap;">${label}</span>`;
}
function ratingInline(T, r, fs = 15) {
  if (!r.rating) return `<span style="font-size: ${fs}px; color: ${T.muted};">Noch nicht bewertet</span>`;
  return `<span style="display: flex; align-items: center; gap: 5px; font-size: ${fs}px; white-space: nowrap;">${starSvg(T, 18, true)}<strong>${r.rating}</strong>(${r.count})</span>`;
}
function timePill(T, r) {
  return `<span style="position: absolute; left: 12px; bottom: 12px; height: 32px; display: flex; align-items: center; gap: 6px; padding: 0 12px; box-sizing: border-box; border: 1px solid rgba(35,31,32,0.2); border-radius: 16px; background: ${T.highlight}; color: ${T.ink}; font-size: 14px; font-weight: 700;">${ic('clock', 16, 'currentColor', 2.2)}${r.time}</span>`;
}
function primaryBtn(T, label, { icon = null, h = 56, grow = false, w = null, full = false } = {}) {
  const width = full ? ' width: 100%; box-sizing: border-box;' : w ? ` width: ${w}px;` : '';
  return `<button type="button" style="${grow ? 'flex-grow: 1; ' : ''}height: ${h}px;${width} display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 24px; border: 0; border-radius: ${h / 2}px; background: ${T.primary}; color: ${T.onPrimary}; font-size: 17px; font-weight: 700; white-space: nowrap;">${icon ? ic(icon, 20, 'currentColor', 2.2) : ''}${label}</button>`;
}
function outlineBtn(T, label, { icon = null, h = 56, grow = false, w = null, full = false } = {}) {
  const width = full ? ' width: 100%;' : w ? ` width: ${w}px;` : '';
  return `<button type="button" style="${grow ? 'flex-grow: 1; ' : ''}height: ${h}px;${width} display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 22px; box-sizing: border-box; border: 1.5px solid ${T.borderStrong}; border-radius: ${h / 2}px; background: transparent; color: ${T.text}; font-size: 17px; font-weight: 700; white-space: nowrap;">${icon ? ic(icon, 20, 'currentColor', 2) : ''}${label}</button>`;
}
function textBtn(T, label, { underline = true, icon = null } = {}) {
  return `<button type="button" style="height: 44px; display: flex; align-items: center; gap: 4px; padding: 0; border: 0; background: transparent; font-size: 15px; font-weight: 600;${underline ? ' text-decoration: underline; text-underline-offset: 3px;' : ''}">${label}${icon ? ic(icon, 18) : ''}</button>`;
}
function h1(text, size = 36) {
  return `<h1 style="margin: 0; font-family: ${DISPLAY}; font-weight: 800; font-size: ${size}px; line-height: 1.05; letter-spacing: -0.8px;">${text}</h1>`;
}
function h2(text, size = 26) {
  return `<h2 style="margin: 0; font-family: ${DISPLAY}; font-weight: 700; font-size: ${size}px; line-height: 1.15; letter-spacing: -0.3px;">${text}</h2>`;
}
function input(T, { value = '', placeholder = '', w = null, grow = false, h = 44, fs = 16, focus = false, error = false, label = '', mode = '' } = {}) {
  const border = error ? `2px solid ${T.primaryText}` : focus ? `2px solid ${T.text}` : `1.5px solid ${T.borderStrong}`;
  const ring = focus ? ` outline: 2px solid ${T.text}; outline-offset: 2px;` : '';
  const width = w ? ` width: ${w}px;` : '';
  const im = mode ? ` inputmode="${mode}"` : '';
  return `<input type="text" aria-label="${label}"${im} value="${value}" placeholder="${placeholder}" style="${grow ? 'flex-grow: 1; min-width: 0; ' : ''}${width} height: ${h}px; box-sizing: border-box; padding: 0 12px; border: ${border}; border-radius: 12px; background: ${T.inputBg}; color: ${T.text}; font-size: ${fs}px;${ring}">`;
}
function fieldLabel(T, text, hint = '') {
  const hn = hint ? `<span style="font-size: 14px; font-weight: 500; color: ${T.muted};">${hint}</span>` : '';
  return `<div style="display: flex; align-items: baseline; justify-content: space-between;"><span style="font-size: 15px; font-weight: 700;">${text}</span>${hn}</div>`;
}
function segmented(T, options, active, label) {
  const opts = options.map((o, i) => i === active
    ? `<button type="button" role="tab" aria-selected="true" style="height: 44px; padding: 0 16px; border: 0; border-radius: 22px; background: ${T.text}; color: ${T.bg}; font-size: 15px; font-weight: 700;">${o}</button>`
    : `<button type="button" role="tab" aria-selected="false" style="height: 44px; padding: 0 16px; border: 0; border-radius: 22px; background: transparent; font-size: 15px; font-weight: 600;">${o}</button>`).join('');
  return `<div role="tablist" aria-label="${label}" style="display: flex; padding: 3px; box-sizing: border-box; border: 1.5px solid ${T.borderStrong}; border-radius: 26px;">${opts}</div>`;
}

// ---------------------------------------------------------------- composite parts
function phoneHeader(T, title, { refresh = true } = {}) {
  return `<header style="display: flex; align-items: center; justify-content: space-between; padding: 14px 12px 0 20px;">
${h1(title)}
<div style="display: flex; align-items: center; gap: 4px;">${refresh ? iconBtn(T, 'refresh', 'Aktualisieren') : ''}${avatarBtn(T, ANNA)}</div>
</header>`;
}
function searchRow(T, placeholder, count, { pad = '12px 20px 0' } = {}) {
  const badge = count ? `<span style="position: absolute; top: -3px; right: -3px; min-width: 22px; height: 22px; box-sizing: border-box; border: 2px solid ${T.bg}; border-radius: 11px; background: ${T.primary}; color: ${T.onPrimary}; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center;">${count}</span>` : '';
  return `<div style="display: flex; align-items: center; gap: 8px; padding: ${pad};">
<label style="flex-grow: 1; min-width: 0; display: flex; align-items: center; gap: 10px; height: 52px; box-sizing: border-box; padding: 0 18px; border: 1.5px solid ${T.borderStrong}; border-radius: 26px; background: ${T.inputBg};">${ic('search', 22)}<input type="search" aria-label="Suchen" placeholder="${placeholder}" style="flex-grow: 1; min-width: 0; border: 0; background: transparent; font-size: 16px; color: ${T.text}; outline: none; padding: 0;"></label>
<button type="button" aria-label="Filter${count ? `, ${count} aktiv` : ''}" style="position: relative; flex-shrink: 0; width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 26px; background: ${T.text}; color: ${T.bg}; padding: 0;">${ic('filter', 24)}${badge}</button>
</div>`;
}
function chipRow(T, chips, pad = '14px 0 0 20px') {
  return `<div style="display: flex; gap: 8px; padding: ${pad}; overflow: hidden;">${chips.map(c => chip(T, c.label, c)).join('')}</div>`;
}
function countRow(T, text, sort = 'Neueste', pad = '10px 12px 10px 20px') {
  return `<div style="display: flex; align-items: center; justify-content: space-between; padding: ${pad};"><span style="font-size: 15px; font-weight: 600;">${text}</span><button type="button" style="height: 44px; display: flex; align-items: center; gap: 4px; padding: 0 8px; border: 0; background: transparent; font-size: 15px; font-weight: 600;">${sort}${ic('chevDown', 18)}</button></div>`;
}
function card(T, r, { mh = 233 } = {}) {
  return `<article style="flex-shrink: 0; box-sizing: border-box; border: 1px solid ${T.border}; border-radius: 24px; overflow: hidden; background: ${T.surface};">
<div style="position: relative;">${media(T, r, { h: mh })}<div style="position: absolute; top: 12px; right: 12px;">${heartBtn(T, r.fav)}</div>${timePill(T, r)}</div>
<div style="display: flex; flex-direction: column; gap: 8px; padding: 14px 16px 16px;">
${h2(r.title, 24)}
<div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">${ratingInline(T, r)}${r.tags.slice(0, 2).map(t => tagPill(T, t)).join('')}${r.tags.length > 2 ? tagPill(T, `+${r.tags.length - 2}`) : ''}</div>
</div>
</article>`;
}
const NAV = [['book', 'Rezepte'], ['heart', 'Favoriten'], ['tag', 'Tags'], ['dotsH', 'Mehr']];
function navBar(T, active) {
  const items = NAV.map(([icn, label], i) => {
    const on = i === active;
    const pill = on
      ? `<span style="width: 52px; height: 30px; border-radius: 15px; background: ${T.navActive}; color: ${T.navActiveIcon}; display: flex; align-items: center; justify-content: center;">${ic(icn, 22)}</span>`
      : `<span style="width: 52px; height: 30px; display: flex; align-items: center; justify-content: center;">${ic(icn, 22)}</span>`;
    return `<button type="button"${on ? ' aria-current="page"' : ''} style="height: 60px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border: 0; background: transparent; color: ${T.navText}; font-size: 12px; font-weight: ${on ? 700 : 500};">${pill}${label}</button>`;
  }).join('');
  return `<nav aria-label="Hauptnavigation" style="position: absolute; left: 12px; right: 12px; bottom: 12px; height: 72px; box-sizing: border-box; padding: 0 6px; border: 1px solid ${T.navBorder}; border-radius: 36px; background: ${T.nav}; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); align-items: center; box-shadow: 0 8px 24px ${T.shadow};">${items}</nav>`;
}
function fab(T, bottom = 100) {
  return `<button type="button" aria-label="Neues Rezept" style="position: absolute; right: 20px; bottom: ${bottom}px; width: 60px; height: 60px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 30px; background: ${T.primary}; color: ${T.onPrimary}; padding: 0; box-shadow: 0 8px 20px ${T.shadow};">${ic('plus', 28, 'currentColor', 2.4)}</button>`;
}
function rail(T, active) {
  const items = NAV.map(([icn, label], i) => {
    const on = i === active;
    const pill = on
      ? `<span style="width: 56px; height: 32px; border-radius: 16px; background: ${T.navActive}; color: ${T.navActiveIcon}; display: flex; align-items: center; justify-content: center;">${ic(icn, 22)}</span>`
      : `<span style="width: 56px; height: 32px; display: flex; align-items: center; justify-content: center;">${ic(icn, 22)}</span>`;
    return `<button type="button"${on ? ' aria-current="page"' : ''} style="width: 76px; height: 64px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; border: 0; background: transparent; color: ${T.navText}; font-size: 12px; font-weight: ${on ? 700 : 500};">${pill}${label}</button>`;
  }).join('');
  return `<nav aria-label="Hauptnavigation" style="position: absolute; left: 0; top: 0; bottom: 0; width: 88px; box-sizing: border-box; padding: 16px 0 16px; border-right: 1px solid ${T.navBorder}; background: ${T.nav}; display: flex; flex-direction: column; align-items: center; gap: 6px;">
<button type="button" style="width: 76px; display: flex; flex-direction: column; align-items: center; gap: 4px; border: 0; background: transparent; color: ${T.navText}; font-size: 12px; font-weight: 600; padding: 0 0 12px;"><span style="width: 56px; height: 56px; border-radius: 28px; background: ${T.primary}; color: ${T.onPrimary}; display: flex; align-items: center; justify-content: center;">${ic('plus', 26, 'currentColor', 2.4)}</span>Neu</button>
${items}
<span style="flex-grow: 1;"></span>
${avatarBtn(T, ANNA)}
</nav>`;
}
function starsRow(T, value, size = 34) {
  const btns = [1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" aria-checked="${n === value}" aria-label="${n} ${n === 1 ? 'Stern' : 'Sterne'}" style="width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; border: 0; background: transparent; padding: 0;">${starSvg(T, size, n <= value)}</button>`).join('');
  return `<div role="radiogroup" aria-label="Deine Bewertung" style="display: flex; gap: 8px;">${btns}</div>`;
}
function ratingBox(T) {
  return `<section aria-label="Bewertung" style="display: flex; flex-direction: column; gap: 6px; padding: 14px 14px 4px; box-sizing: border-box; border: 1px solid ${T.border}; border-radius: 22px; background: ${T.surface};">
<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px;"><span style="font-size: 16px; font-weight: 700;">Deine Bewertung (Anna): 4</span><span style="font-size: 15px;"><strong>Ø 4,3</strong> (3)</span></div>
${starsRow(T, 4)}
<div style="display: flex; justify-content: space-between;">${textBtn(T, 'Bewertung entfernen')}${textBtn(T, 'Alle Bewertungen', { underline: false, icon: 'chevDown' })}</div>
</section>`;
}
function infoTiles(T) {
  const tile = (label, value, bg, fg, border) => `<div style="display: flex; flex-direction: column; gap: 2px; padding: 12px; box-sizing: border-box; border: ${border}; border-radius: 18px; background: ${bg}; color: ${fg};"><span style="font-size: 13px; font-weight: 600;">${label}</span><span style="font-family: ${DISPLAY}; font-size: 22px; font-weight: 700;">${value}</span></div>`;
  return `<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;">${tile('Vorbereitung', '20 min', T.highlight, T.ink, '0')}${tile('Kochen', '25 min', T.secondary, T.ink, '0')}${tile('Portionen', '4', T.surface, T.text, `1.5px solid ${T.borderStrong}`)}</div>`;
}
function detailTags(T) {
  return `<div style="display: flex; flex-wrap: wrap; gap: 8px;">${chip(T, 'Vegetarisch')}${chip(T, 'Hauptgericht')}${chip(T, 'Für Gäste')}</div>`;
}
const ING = [
  ['Für den Teig', [['400 g', 'Mehl', true], ['4', 'Eier'], ['150 ml', 'Mineralwasser'], ['1 TL', 'Salz']]],
  ['Außerdem', [['250 g', 'Bergkäse, gerieben'], ['3', 'Zwiebeln'], ['2 EL', 'Butter'], ['', 'Pfeffer']]],
];
const STEPS = [
  'Mehl, Eier, Mineralwasser und Salz mit einem Kochlöffel zu einem zähen Teig schlagen, bis er Blasen wirft. 10 Minuten ruhen lassen.',
  'Reichlich Salzwasser aufkochen. Den Teig portionsweise vom Brett ins Wasser schaben und die Spätzle herausheben, sobald sie oben schwimmen.',
  'Zwiebeln in Ringe schneiden und in der Butter bei mittlerer Hitze goldbraun rösten.',
  'Spätzle und Käse abwechselnd in eine vorgewärmte Form schichten, pfeffern und mit den Röstzwiebeln servieren.',
];
function ingredientRow(T, amount, name, checked = false) {
  if (checked) {
    return `<button type="button" aria-pressed="true" style="min-height: 52px; display: flex; align-items: center; gap: 12px; padding: 0 14px; border: 0; border-radius: 16px; background: ${T.secondary}; color: ${T.ink}; text-align: left; font-size: 17px;"><span style="flex-shrink: 0; width: 24px; height: 24px; border-radius: 12px; background: ${T.ink}; color: ${T.secondary}; display: flex; align-items: center; justify-content: center;">${ic('check', 15, 'currentColor', 3)}</span><span style="width: 70px; flex-shrink: 0; font-weight: 700; text-decoration: line-through;">${amount}</span><span style="text-decoration: line-through;">${name}</span></button>`;
  }
  return `<button type="button" aria-pressed="false" style="min-height: 52px; display: flex; align-items: center; gap: 12px; padding: 0 14px; box-sizing: border-box; border: 1px solid ${T.border}; border-radius: 16px; background: ${T.surface}; color: ${T.text}; text-align: left; font-size: 17px;"><span style="flex-shrink: 0; width: 24px; height: 24px; box-sizing: border-box; border-radius: 12px; border: 2px solid ${T.text};"></span><span style="width: 70px; flex-shrink: 0; font-weight: 700;">${amount}</span><span>${name}</span></button>`;
}
function ingredients(T) {
  const groups = ING.map(([g, rows]) => `<h3 style="margin: 8px 0 0; font-size: 15px; font-weight: 700;">${g}</h3>${rows.map(([a, n, c]) => ingredientRow(T, a, n, c)).join('')}`).join('');
  return `<section aria-label="Zutaten" style="display: flex; flex-direction: column; gap: 8px;">
<div style="display: flex; align-items: baseline; justify-content: space-between;">${h2('Zutaten')}<span style="font-size: 15px; color: ${T.muted};">für 4 Portionen</span></div>
${groups}
${textBtn(T, 'Alle zurücksetzen')}
</section>`;
}
function steps(T) {
  const cards = STEPS.map((s, i) => `<div style="display: flex; flex-direction: column; gap: 6px; padding: 16px; box-sizing: border-box; border: 1px solid ${T.border}; border-radius: 20px; background: ${T.surface};"><span style="font-family: ${DISPLAY}; font-size: 20px; font-weight: 800; color: ${T.primaryText};">Schritt ${i + 1}</span><p style="margin: 0; font-size: 18px; line-height: 1.5;">${s}</p></div>`).join('');
  return `<section aria-label="Zubereitung" style="display: flex; flex-direction: column; gap: 12px;">${h2('Zubereitung')}${cards}</section>`;
}
function footerMeta(T) {
  return `<p style="margin: 0; font-size: 14px; line-height: 1.5; color: ${T.muted};">Angelegt von Sebastian am 12.03.2026 · geändert von Anna vor 3 Tagen</p>`;
}
function detailIntro(T, titleSize = 36) {
  return `<div style="display: flex; flex-direction: column; gap: 8px;">${h1('Käsespätzle', titleSize)}<p style="margin: 0; font-size: 17px; line-height: 1.5;">Wie bei Oma im Allgäu: mit viel Bergkäse und Röstzwiebeln.</p></div>`;
}

// ---------------------------------------------------------------- screens (phone)
function phoneList(T) {
  const body = `${phoneHeader(T, 'Rezepte')}
${searchRow(T, 'Rezepte, Zutaten, Tags suchen', 1)}
${chipRow(T, [{ label: 'Vegetarisch', active: true }, { label: 'Schnell' }, { label: 'Suppe' }, { label: 'Dessert' }, { label: 'Alle Tags …', outline: true }])}
${countRow(T, '14 von 38 Rezepten')}
<div style="display: flex; flex-direction: column; gap: 16px; padding: 0 20px;">${card(T, R.kaese)}${card(T, R.kuerbis)}</div>
${fab(T)}
${navBar(T, 0)}`;
  return body;
}
function phoneFavorites(T) {
  return `${phoneHeader(T, 'Favoriten')}
${searchRow(T, 'In Favoriten suchen', 0)}
${chipRow(T, [{ label: 'Vegetarisch' }, { label: 'Hauptgericht' }, { label: 'Suppe' }, { label: 'Dessert' }])}
${countRow(T, '4 Favoriten von Anna')}
<div style="display: flex; flex-direction: column; gap: 16px; padding: 0 20px;">${card(T, R.spinat)}${card(T, R.kaese)}</div>
${fab(T)}
${navBar(T, 1)}`;
}
function phoneProfiles(T) {
  const tiles = PROFILES.map(p => `<button type="button" style="height: 132px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; box-sizing: border-box; border: 1px solid ${T.border}; border-radius: 24px; background: ${T.surface}; font-size: 18px; font-weight: 700;">${avatar(T, p, 64, 28)}${p.name}</button>`).join('');
  const add = `<button type="button" style="height: 132px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; box-sizing: border-box; border: 2px dashed ${T.borderStrong}; border-radius: 24px; background: transparent; font-size: 18px; font-weight: 700;"><span style="width: 64px; height: 64px; box-sizing: border-box; border-radius: 32px; border: 2px solid ${T.borderStrong}; display: flex; align-items: center; justify-content: center;">${ic('plus', 28, 'currentColor', 2.2)}</span>Neues Profil</button>`;
  return `<div style="display: flex; flex-direction: column; gap: 28px; padding: 56px 24px 0;">
<div style="display: flex; flex-direction: column; align-items: flex-start; gap: 12px;">
<span style="width: 64px; height: 64px; border-radius: 18px; background: ${T.primary}; overflow: hidden; display: flex;">${iconMark(T.mode === 'dark' ? '#231F20' : '#EFE6DD', T.primary)}</span>
${h1('Wer kocht?', 40)}
<p style="margin: 0; font-size: 17px; color: ${T.muted};">Tippe auf deinen Namen.</p>
</div>
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;">${tiles}${add}</div>
<p style="margin: 0; font-size: 15px; line-height: 1.5; color: ${T.muted};">Profile trennen nur Bewertungen und Favoriten – kein Passwort.</p>
</div>`;
}
function phoneDetail(T) {
  return `<div style="position: relative; flex-shrink: 0;">${media(T, R.kaese, { h: 360 })}
<div style="position: absolute; top: 12px; left: 12px;">${overlayBtn(T, ic('back', 24), 'Zurück zu Rezepte')}</div>
<div style="position: absolute; top: 12px; right: 12px; display: flex; gap: 8px;">${heartBtn(T, true)}${overlayBtn(T, ic('dotsH', 22), 'Weitere Aktionen')}</div>
</div>
<div style="position: relative; flex-shrink: 0; margin-top: -32px; display: flex; flex-direction: column; gap: 16px; padding: 24px 20px 0; border-radius: 28px 28px 0 0; background: ${T.bg};">
${detailIntro(T)}
${infoTiles(T)}
${detailTags(T)}
${ratingBox(T)}
${ingredients(T)}
${steps(T)}
${footerMeta(T)}
</div>
<div style="margin-top: auto; flex-shrink: 0; padding: 16px 20px 20px; background: ${T.bg};">${primaryBtn(T, 'Bearbeiten', { icon: 'pencil', full: true })}</div>`;
}
function editorIngredientRowNarrow(T, amount, unit, name, note) {
  return `<div style="display: flex; flex-direction: column; gap: 6px; padding: 8px; box-sizing: border-box; border: 1px solid ${T.border}; border-radius: 18px; background: ${T.surface};">
<div style="display: flex; align-items: center; gap: 6px;">${iconBtn(T, 'grip', 'Zutat verschieben', { color: T.muted })}${input(T, { value: amount, placeholder: 'Menge', w: 72, label: 'Menge', mode: 'decimal' })}${input(T, { value: unit, placeholder: 'Einheit', w: 88, label: 'Einheit' })}<span style="flex-grow: 1;"></span>${iconBtn(T, 'dotsV', 'Zeilenmenü: verschieben, entfernen')}</div>
<div style="display: flex; gap: 6px;">${input(T, { value: name, placeholder: 'Zutat', grow: true, label: 'Zutat' })}${input(T, { value: note, placeholder: 'Notiz', w: 120, label: 'Notiz' })}</div>
</div>`;
}
function editorIngredientRowWide(T, amount, unit, name, note) {
  return `<div style="display: flex; align-items: center; gap: 6px; padding: 6px; box-sizing: border-box; border: 1px solid ${T.border}; border-radius: 16px; background: ${T.surface};">${iconBtn(T, 'grip', 'Zutat verschieben', { color: T.muted })}${input(T, { value: amount, placeholder: 'Menge', w: 64, label: 'Menge', mode: 'decimal' })}${input(T, { value: unit, placeholder: 'Einheit', w: 76, label: 'Einheit' })}${input(T, { value: name, placeholder: 'Zutat', grow: true, label: 'Zutat' })}${input(T, { value: note, placeholder: 'Notiz', w: 100, label: 'Notiz' })}${iconBtn(T, 'dotsV', 'Zeilenmenü: verschieben, entfernen')}</div>`;
}
function groupInput(T, value) {
  return `<input type="text" aria-label="Gruppenname" value="${value}" style="height: 44px; box-sizing: border-box; padding: 0 2px; border: 0; border-bottom: 1.5px solid ${T.borderStrong}; background: transparent; color: ${T.text}; font-size: 16px; font-weight: 700;">`;
}
function sectionHead(T, title, seg) {
  return `<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">${h2(title)}${seg}</div>`;
}
function editorIngredients(T, wide) {
  const row = wide ? editorIngredientRowWide : editorIngredientRowNarrow;
  return `<section aria-label="Zutaten" style="display: flex; flex-direction: column; gap: 8px;">
${sectionHead(T, 'Zutaten', segmented(T, ['Zeilen', 'Text'], 0, 'Eingabeart Zutaten'))}
${groupInput(T, 'Für den Teig')}
${row(T, '400', 'g', 'Mehl', '')}
${row(T, '4', '', 'Eier', '')}
${row(T, '150', 'ml', 'Mineralwasser', '')}
${groupInput(T, 'Außerdem')}
${row(T, '250', 'g', 'Bergkäse', 'gerieben')}
<div style="display: flex; gap: 8px;">${outlineBtn(T, 'Zutat', { icon: 'plus', h: 44 })}${outlineBtn(T, 'Gruppe', { icon: 'plus', h: 44 })}</div>
</section>`;
}
function editorSteps(T, n = 2) {
  const rows = STEPS.slice(0, n).map((s, i) => `<div style="display: flex; align-items: flex-start; gap: 8px; padding: 8px; box-sizing: border-box; border: 1px solid ${T.border}; border-radius: 18px; background: ${T.surface};"><span style="flex-shrink: 0; width: 36px; height: 36px; margin-top: 4px; border-radius: 18px; background: ${T.text}; color: ${T.bg}; display: flex; align-items: center; justify-content: center; font-weight: 700;">${i + 1}</span><textarea aria-label="Schritt ${i + 1}" style="flex-grow: 1; min-width: 0; height: 128px; box-sizing: border-box; padding: 10px 12px; border: 1.5px solid ${T.borderStrong}; border-radius: 12px; background: ${T.inputBg}; color: ${T.text}; font-size: 17px; line-height: 1.5; resize: none;">${s}</textarea>${iconBtn(T, 'dotsV', 'Schrittmenü: verschieben, entfernen')}</div>`).join('');
  return `<section aria-label="Zubereitung" style="display: flex; flex-direction: column; gap: 8px;">
${sectionHead(T, 'Zubereitung', segmented(T, ['Schritte', 'Text'], 0, 'Eingabeart Zubereitung'))}
${rows}
<div style="display: flex;">${outlineBtn(T, 'Schritt', { icon: 'plus', h: 44 })}</div>
</section>`;
}
function tagEditor(T) {
  const rem = (label) => `<span style="height: 44px; display: flex; align-items: center; padding-left: 16px; border-radius: 22px; background: ${T.secondary}; color: ${T.ink}; font-size: 15px; font-weight: 600;">${label}<button type="button" aria-label="${label} entfernen" style="width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border: 0; background: transparent; color: ${T.ink}; padding: 0;">${ic('close', 18, 'currentColor', 2.4)}</button></span>`;
  const add = (label) => `<button type="button" style="height: 44px; display: flex; align-items: center; gap: 4px; padding: 0 16px 0 12px; box-sizing: border-box; border: 1.5px solid ${T.borderStrong}; border-radius: 22px; background: transparent; font-size: 15px; font-weight: 600;">${ic('plus', 16, 'currentColor', 2.4)}${label}</button>`;
  return `<div style="display: flex; flex-direction: column; gap: 8px;">${fieldLabel(T, 'Tags')}
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px; box-sizing: border-box; border: 1.5px solid ${T.borderStrong}; border-radius: 16px; background: ${T.inputBg};">${rem('Vegetarisch')}${rem('Hauptgericht')}<input type="text" aria-label="Tag hinzufügen" placeholder="Tag hinzufügen …" style="flex-grow: 1; min-width: 120px; height: 44px; border: 0; background: transparent; font-size: 16px; color: ${T.text}; outline: none; padding: 0 8px;"></div>
<span style="font-size: 14px; color: ${T.muted};">Häufig verwendet</span>
<div style="display: flex; flex-wrap: wrap; gap: 8px;">${add('Schnell')}${add('Für Gäste')}${add('Suppe')}</div>
</div>`;
}
function phoneEditor(T) {
  return `<div style="display: flex; align-items: center; gap: 4px; height: 64px; flex-shrink: 0; padding: 0 12px 0 8px;">${iconBtn(T, 'back', 'Zurück')}${h2('Neues Rezept', 24)}</div>
<div style="display: flex; flex-direction: column; gap: 28px; padding: 8px 20px 0;">
<div style="display: flex; flex-direction: column; gap: 10px;">${fieldLabel(T, 'Foto', 'optional')}
<div style="height: 180px; box-sizing: border-box; border: 2px dashed ${T.borderStrong}; border-radius: 24px; background: ${T.surface}; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; text-align: center; padding: 0 24px;">${ic('camera', 32, 'currentColor', 1.8)}<span style="font-size: 16px; font-weight: 700;">Noch kein Foto</span><span style="font-size: 14px; color: ${T.muted};">Ohne Foto zeigt die App ein Platzhalterbild.</span></div>
<div style="display: flex; flex-direction: column; gap: 8px;">${primaryBtn(T, 'Foto aufnehmen', { icon: 'camera', h: 52, full: true })}${outlineBtn(T, 'Bild auswählen', { icon: 'image', h: 52, full: true })}</div>
</div>
<div style="display: flex; flex-direction: column; gap: 8px;">${fieldLabel(T, 'Titel', 'Pflichtfeld')}
${input(T, { value: 'Kässpätzle', h: 52, fs: 17, focus: true, label: 'Titel' })}
<div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border-radius: 16px; background: ${T.highlight}; color: ${T.ink}; font-size: 15px; line-height: 1.4;">${ic('info', 20, 'currentColor', 2)}<span>Ähnliches Rezept vorhanden: <a href="#" style="color: ${T.ink}; font-weight: 700;">Käsespätzle (Sebastian)</a></span></div>
</div>
${tagEditor(T)}
${editorIngredients(T, false)}
${editorSteps(T, 2)}
<button type="button" style="min-height: 60px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 16px; box-sizing: border-box; border: 1px solid ${T.border}; border-radius: 18px; background: ${T.surface}; text-align: left;"><span style="display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 17px; font-weight: 700;">Weitere Angaben</span><span style="font-size: 14px; color: ${T.muted};">Portionen, Zeiten, Quelle, Beschreibung</span></span>${ic('chevDown', 22)}</button>
</div>
<div style="margin-top: auto; flex-shrink: 0; display: flex; gap: 8px; padding: 16px 20px 20px; border-top: 1px solid ${T.border}; background: ${T.bg};">${outlineBtn(T, 'Abbrechen', { grow: true })}${primaryBtn(T, 'Speichern', { grow: true })}</div>`;
}
function filterContent(T) {
  const tagChips = [
    chip(T, 'Vegetarisch', { active: true, count: 14 }), chip(T, 'Hauptgericht', { count: 11 }), chip(T, 'Schnell', { count: 9 }),
    chip(T, 'Suppe', { count: 6 }), chip(T, 'Backen', { count: 5 }), chip(T, 'Dessert', { count: 4 }), chip(T, 'Für Gäste', { count: 3 }),
  ].join('');
  const starChip = (label, active) => active
    ? `<button type="button" aria-pressed="true" style="height: 44px; display: flex; align-items: center; gap: 6px; padding: 0 16px 0 12px; border: 0; border-radius: 22px; background: ${T.primary}; color: ${T.onPrimary}; font-size: 15px; font-weight: 700;">${ic('check', 18, 'currentColor', 2.6)}${label}</button>`
    : `<button type="button" aria-pressed="false" style="height: 44px; display: flex; align-items: center; gap: 6px; padding: 0 16px 0 12px; box-sizing: border-box; border: 1.5px solid ${T.borderStrong}; border-radius: 22px; background: transparent; font-size: 15px; font-weight: 600;">${starSvg(T, 18, true)}${label}</button>`;
  const sortChip = (label, active) => active ? chip(T, label, { active: true }) : chip(T, label, { outline: true });
  const lbl = (t) => `<span style="font-size: 15px; font-weight: 700;">${t}</span>`;
  return `<div style="display: flex; flex-direction: column; gap: 10px;">${lbl('Tags')}
<label style="display: flex; align-items: center; gap: 8px; height: 44px; box-sizing: border-box; padding: 0 14px; border: 1.5px solid ${T.borderStrong}; border-radius: 22px; background: ${T.inputBg};">${ic('search', 18)}<input type="search" aria-label="Tags durchsuchen" placeholder="Tags durchsuchen" style="flex-grow: 1; min-width: 0; border: 0; background: transparent; font-size: 16px; outline: none; padding: 0;"></label>
<div style="display: flex; flex-wrap: wrap; gap: 8px;">${tagChips}</div>
${segmented(T, ['Alle müssen passen', 'Einer reicht'], 0, 'Tag-Verknüpfung')}
</div>
<button type="button" role="switch" aria-checked="false" style="min-height: 56px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0; border: 0; border-top: 1px solid ${T.border}; border-bottom: 1px solid ${T.border}; background: transparent; text-align: left;"><span style="display: flex; flex-direction: column;"><span style="font-size: 16px; font-weight: 700;">Nur Favoriten</span><span style="font-size: 14px; color: ${T.muted};">von Anna</span></span><span style="width: 52px; height: 32px; box-sizing: border-box; border: 2px solid ${T.borderStrong}; border-radius: 16px; background: ${T.surface}; display: flex; align-items: center; padding: 0 4px;"><span style="width: 20px; height: 20px; border-radius: 10px; background: ${T.borderStrong};"></span></span></button>
<div style="display: flex; flex-direction: column; gap: 10px;">${lbl('Mindestbewertung')}
<div style="display: flex; flex-wrap: wrap; gap: 8px;">${sortChip('Egal', true)}${starChip('ab 3', false)}${starChip('ab 4', false)}${starChip('5', false)}</div></div>
<div style="display: flex; flex-direction: column; gap: 10px;">${lbl('Sortierung')}
<div style="display: flex; flex-wrap: wrap; gap: 8px;">${sortChip('Neueste', true)}${sortChip('Titel A–Z')}${sortChip('Beste Bewertung')}${sortChip('Meine Bewertung')}${sortChip('Zuletzt geändert')}</div></div>
<div style="display: flex;">${textBtn(T, 'Filter zurücksetzen')}</div>`;
}
function filterHeader(T) {
  return `<div style="display: flex; align-items: center; justify-content: space-between;"><div style="display: flex; align-items: baseline; gap: 10px;">${h2('Filter')}<span style="font-size: 15px; color: ${T.muted};">14 Treffer</span></div>${iconBtn(T, 'close', 'Filter schließen')}</div>`;
}
function phoneFilter(T) {
  return `${phoneList(T)}
<div style="position: absolute; left: 0; top: 0; right: 0; bottom: 0; background: ${T.scrim};"></div>
<section role="dialog" aria-label="Filter" style="position: absolute; left: 0; right: 0; bottom: 0; top: 32px; display: flex; flex-direction: column; gap: 14px; box-sizing: border-box; padding: 10px 20px 20px; border-radius: 28px 28px 0 0; background: ${T.raised}; box-shadow: 0 -8px 24px ${T.shadow};">
<span style="align-self: center; width: 40px; height: 5px; border-radius: 3px; background: ${T.borderStrong};"></span>
${filterHeader(T)}
${filterContent(T)}
</section>`;
}

// ---------------------------------------------------------------- screens (tablet)
function compactRow(T, r, selected) {
  const sel = selected ? `border: 2px solid ${T.primary}; background: ${T.raised};` : `border: 2px solid transparent; background: transparent;`;
  return `<article${selected ? ' aria-current="true"' : ''} style="display: flex; align-items: center; gap: 12px; padding: 8px; box-sizing: border-box; border-radius: 20px; ${sel}">
${media(T, r, { w: '112px', h: 75, radius: 14 })}
<div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;"><span style="font-family: ${DISPLAY}; font-size: 18px; font-weight: 700; line-height: 1.2;">${r.title}</span><div style="display: flex; align-items: center; gap: 10px; font-size: 14px;"><span style="display: flex; align-items: center; gap: 4px;">${ic('clock', 16)}${r.time}</span>${ratingInline(T, r, 14)}</div></div>
<button type="button" aria-label="Favorit" aria-pressed="${r.fav}" style="width: 44px; height: 44px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border: 0; background: transparent; padding: 0;">${heartSvg(T, r.fav, 22)}</button>
</article>`;
}
function tabletListColumn(T) {
  return `<div style="position: absolute; left: 88px; top: 0; bottom: 0; width: 380px; box-sizing: border-box; border-right: 1px solid ${T.border}; overflow: hidden;">
<header style="display: flex; align-items: center; justify-content: space-between; padding: 16px 12px 0 20px;">${h1('Rezepte', 30)}${iconBtn(T, 'refresh', 'Aktualisieren')}</header>
${searchRow(T, 'Rezepte, Zutaten, Tags suchen', 1, { pad: '12px 16px 0 20px' })}
${chipRow(T, [{ label: 'Vegetarisch', active: true }, { label: 'Schnell' }, { label: 'Suppe' }, { label: 'Dessert' }])}
${countRow(T, '14 von 38 Rezepten', 'Neueste', '6px 8px 4px 20px')}
<div style="display: flex; flex-direction: column; gap: 4px; padding: 0 12px;">${compactRow(T, R.kaese, true)}${compactRow(T, R.kuerbis)}${compactRow(T, R.linsen)}${compactRow(T, R.spinat)}${compactRow(T, R.ofen)}${compactRow(T, R.pilz)}</div>
</div>`;
}
function tabletDetailColumn(T) {
  return `<div style="position: absolute; left: 468px; right: 0; top: 0; bottom: 0; overflow: hidden;">
<div style="display: flex; align-items: center; justify-content: flex-end; gap: 4px; padding: 12px 16px 0;"><button type="button" aria-label="Favorit" aria-pressed="true" style="width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; border: 0; background: transparent; padding: 0;">${heartSvg(T, true)}</button>${iconBtn(T, 'dotsH', 'Weitere Aktionen')}${outlineBtn(T, 'Bearbeiten', { icon: 'pencil', h: 44 })}</div>
<div style="display: flex; flex-direction: column; gap: 16px; padding: 12px 24px 24px;">
${media(T, R.kaese, { h: 260, radius: 24 })}
${detailIntro(T, 34)}
${infoTiles(T)}
${detailTags(T)}
${ratingBox(T)}
${ingredients(T)}
</div>
</div>`;
}
function tabletLandscape(T) {
  return `${rail(T, 0)}${tabletListColumn(T)}${tabletDetailColumn(T)}`;
}
function tabletFilter(T) {
  return `${tabletLandscape(T)}
<section role="dialog" aria-label="Filter" style="position: absolute; left: 404px; top: 56px; width: 400px; display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; padding: 16px 20px 12px; border: 1px solid ${T.border}; border-radius: 24px; background: ${T.raised}; box-shadow: 0 16px 40px ${T.shadow};">
${filterHeader(T)}
${filterContent(T)}
</section>`;
}
function tabletEditor(T) {
  const uploading = `<div style="position: relative;">${photo(T, R.kaese, { h: 240, radius: 24 })}
<div style="position: absolute; top: 12px; right: 12px;">${overlayBtn(T, ic('trash', 22), 'Foto entfernen')}</div>
<div style="position: absolute; left: 12px; right: 12px; bottom: 12px; display: flex; flex-direction: column; gap: 8px; padding: 10px 14px 12px; border: 1px solid ${T.overlayBorder}; border-radius: 16px; background: ${T.overlay}; color: ${T.text};"><span style="font-size: 14px; font-weight: 700;">Wird hochgeladen … 72 %</span><span style="height: 6px; border-radius: 3px; background: ${T.subtle}; display: flex;"><span style="width: 72%; border-radius: 3px; background: ${T.primary};"></span></span></div>
</div>`;
  const more = `<div style="display: flex; flex-direction: column; gap: 10px;">${fieldLabel(T, 'Weitere Angaben')}
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;">
<div style="display: flex; flex-direction: column; gap: 4px;"><span style="font-size: 14px; font-weight: 600;">Portionen</span>${input(T, { value: '4', label: 'Portionen', mode: 'decimal' })}</div>
<div style="display: flex; flex-direction: column; gap: 4px;"><span style="font-size: 14px; font-weight: 600;">Einheit</span>${input(T, { value: 'Portionen', label: 'Portionseinheit' })}</div>
<div style="display: flex; flex-direction: column; gap: 4px;"><span style="font-size: 14px; font-weight: 600;">Vorbereitung (min)</span>${input(T, { value: '20', label: 'Vorbereitungszeit in Minuten', mode: 'numeric' })}</div>
<div style="display: flex; flex-direction: column; gap: 4px;"><span style="font-size: 14px; font-weight: 600;">Koch-/Backzeit (min)</span>${input(T, { value: '25', label: 'Koch- oder Backzeit in Minuten', mode: 'numeric' })}</div>
</div></div>`;
  return `${rail(T, 0)}
<div style="position: absolute; left: 88px; right: 0; top: 0; bottom: 0; display: flex; flex-direction: column;">
<div style="display: flex; align-items: center; gap: 8px; height: 64px; flex-shrink: 0; padding: 0 24px 0 12px; border-bottom: 1px solid ${T.border};">${iconBtn(T, 'back', 'Zurück')}${h2('Rezept bearbeiten', 24)}<span style="font-size: 16px; color: ${T.muted};">Käsespätzle</span></div>
<div style="flex-grow: 1; min-height: 0; overflow: hidden; display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 24px; padding: 20px 24px 0;">
<div style="display: flex; flex-direction: column; gap: 20px;">
<div style="display: flex; flex-direction: column; gap: 10px;">${fieldLabel(T, 'Foto')}${uploading}<div style="display: flex; flex-direction: column; gap: 8px;">${primaryBtn(T, 'Foto aufnehmen', { icon: 'camera', h: 48, full: true })}${outlineBtn(T, 'Bild auswählen', { icon: 'image', h: 48, full: true })}</div></div>
<div style="display: flex; flex-direction: column; gap: 8px;">${fieldLabel(T, 'Titel', 'Pflichtfeld')}${input(T, { value: 'Käsespätzle', h: 52, fs: 17, label: 'Titel' })}</div>
${tagEditor(T)}
${more}
</div>
<div style="display: flex; flex-direction: column; gap: 24px;">${editorIngredients(T, true)}${editorSteps(T, 1)}</div>
</div>
<div style="flex-shrink: 0; display: flex; justify-content: flex-end; gap: 8px; padding: 12px 24px 16px; border-top: 1px solid ${T.border}; background: ${T.bg};">${outlineBtn(T, 'Abbrechen', { w: 180 })}${primaryBtn(T, 'Speichern', { w: 220 })}</div>
</div>`;
}
function tabletPortraitList(T) {
  const grid = [R.kaese, R.kuerbis, R.linsen, R.zwetschge].map(r => card(T, r)).join('');
  return `${phoneHeader(T, 'Rezepte')}
${searchRow(T, 'Rezepte, Zutaten, Tags suchen', 1, { pad: '12px 24px 0 20px' })}
${chipRow(T, [{ label: 'Vegetarisch', active: true }, { label: 'Schnell' }, { label: 'Suppe' }, { label: 'Hauptgericht' }, { label: 'Backen' }, { label: 'Dessert' }, { label: 'Alle Tags …', outline: true }])}
${countRow(T, '14 von 38 Rezepten', 'Neueste', '10px 16px 10px 20px')}
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding: 0 20px;">${grid}</div>
${fab(T, 104)}
<div style="position: absolute; left: 144px; right: 144px; bottom: 0; height: 96px;">${navBar(T, 0)}</div>`;
}
function tabletPortraitDetail(T) {
  return `<div style="position: relative; flex-shrink: 0;">${media(T, R.kaese, { h: 400 })}
<div style="position: absolute; top: 16px; left: 16px;">${overlayBtn(T, ic('back', 24), 'Zurück zu Rezepte')}</div>
<div style="position: absolute; top: 16px; right: 16px; display: flex; gap: 8px;">${heartBtn(T, true)}${overlayBtn(T, ic('dotsH', 22), 'Weitere Aktionen')}${overlayBtn(T, ic('pencil', 22), 'Bearbeiten')}</div>
</div>
<div style="position: relative; flex-shrink: 0; margin-top: -32px; display: flex; flex-direction: column; gap: 18px; padding: 28px 32px 32px; border-radius: 28px 28px 0 0; background: ${T.bg};">
${detailIntro(T, 40)}
<div style="display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start;"><div style="display: flex; flex-direction: column; gap: 16px;">${infoTiles(T)}${detailTags(T)}</div>${ratingBox(T)}</div>
<div style="display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 24px; align-items: start;">${ingredients(T)}${steps(T)}</div>
${footerMeta(T)}
</div>`;
}

// ---------------------------------------------------------------- icon mark
function iconMark(fg, bg, { cutlery = true } = {}) {
  const cut = cutlery ? `<g fill="none" stroke="${fg}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 34v18"></path><path d="M30 34v18"></path><path d="M38 34v18"></path><path d="M22 52q0 8 8 8q8 0 8-8"></path><path d="M30 60v36"></path><path d="M106 96V34q14 10 14 32q0 6-6 6h-8"></path></g>` : '';
  return `<svg viewBox="0 0 128 128" style="display: block; width: 100%; height: 100%;" aria-hidden="true"><rect width="128" height="128" fill="${bg}"></rect><circle cx="68" cy="64" r="${cutlery ? 30 : 40}" fill="${fg}"></circle><circle cx="68" cy="64" r="${cutlery ? 21 : 28}" fill="none" stroke="${bg}" stroke-opacity="0.45" stroke-width="3"></circle>${cut}</svg>`;
}

// ---------------------------------------------------------------- component sheet
function block(T, title, inner, span = 1) {
  return `<section style="grid-column: span ${span}; display: flex; flex-direction: column; gap: 14px; padding: 20px; box-sizing: border-box; border: 1px solid ${T.border}; border-radius: 24px; background: ${T.surface};"><h2 style="margin: 0; font-family: ${DISPLAY}; font-size: 20px; font-weight: 700;">${title}</h2>${inner}</section>`;
}
function caption(T, t) { return `<span style="font-size: 13px; color: ${T.muted};">${t}</span>`; }
function components(T, modeLabel) {
  const phs = [R.kaese, R.linsen, R.kuerbis, R.zwetschge].map((r, i) => `<div style="display: flex; flex-direction: column; gap: 6px;">${placeholder(T, { ...r, ph: i }, { h: 110, radius: 16 })}${caption(T, `--placeholder-${i + 1}`)}</div>`).join('');
  const placeholderBlock = block(T, 'Platzhalterbild – Rezept ohne Foto', `
<p style="margin: 0; font-size: 15px; line-height: 1.5;">Teller mit Besteck und Anfangsbuchstabe des Titels. Die Farbe folgt fest aus der Rezept-ID (ID mod 4), damit ein Rezept überall gleich aussieht. Inline-SVG, kein zusätzlicher Request.</p>
<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;">${phs}</div>
<div style="display: flex; gap: 16px; align-items: flex-end;">
<div style="display: flex; flex-direction: column; gap: 6px; width: 300px;">${placeholder(T, R.kuerbis, { h: 200, radius: 24, add: true })}${caption(T, 'Detail ohne Foto: mit „Foto hinzufügen“')}</div>
<div style="display: flex; flex-direction: column; gap: 6px;">${placeholder(T, R.kuerbis, { w: '112px', h: 75, radius: 14 })}${caption(T, 'Tablet-Liste 112×75')}</div>
<div style="display: flex; flex-direction: column; gap: 6px;">${placeholder(T, R.kuerbis, { w: '56px', h: 56, radius: 12 })}${caption(T, '56×56')}</div>
</div>
<div style="display: flex; gap: 16px; align-items: flex-end;"><div style="display: flex; flex-direction: column; gap: 6px; width: 300px;">${photo(T, R.kaese, { h: 120, radius: 16 })}${caption(T, 'Nur im Mockup: dunkle Fläche steht für ein echtes Foto')}</div></div>`, 2);
  const chipsBlock = block(T, 'Tag-Chips', `<div style="display: flex; flex-wrap: wrap; gap: 8px;">${chip(T, 'Suppe')}${chip(T, 'Vegetarisch', { active: true })}${chip(T, 'Dessert', { count: 4 })}${chip(T, 'Alle Tags …', { outline: true })}</div>${caption(T, 'Inaktiv: Moonstone mit dunkler Schrift · Aktiv: Primärfläche mit Häkchen · Zähler · Weitere')}<div style="display: flex; gap: 6px;">${tagPill(T, 'Vegetarisch')}${tagPill(T, 'Suppe')}${tagPill(T, '+1')}</div>${caption(T, 'Anzeige in Karten, nicht antippbar')}`);
  const starsBlock = block(T, 'Bewertung', `${starsRow(T, 4)}<div style="display: flex; gap: 16px; align-items: center;">${ratingInline(T, R.kaese)}${ratingInline(T, R.ofen)}</div>${caption(T, 'Gefüllt: Vanilla mit Kontur in Textfarbe · leer: dünne Kontur · Zustand immer auch als Text')}`);
  const heartBlock = block(T, 'Favorit auf Bildern', `<div style="display: flex; gap: 12px;"><div style="position: relative; width: 150px;">${photo(T, R.kaese, { h: 100, radius: 16 })}<div style="position: absolute; top: 8px; right: 8px;">${heartBtn(T, true)}</div></div><div style="position: relative; width: 150px;">${placeholder(T, R.kuerbis, { h: 100, radius: 16 })}<div style="position: absolute; top: 8px; right: 8px;">${heartBtn(T, false)}</div></div></div>${caption(T, 'Runde Fläche 48 px, 92 % deckend, damit das Herz auf jedem Foto erkennbar bleibt')}`);
  const avatarsBlock = block(T, 'Avatare', `<div style="display: flex; gap: 10px; flex-wrap: wrap;">${[0, 1, 2, 3, 4, 5].map(i => avatar(T, { letter: ['S', 'A', 'J', 'M', 'K', 'O'][i], av: i }, 48, 20)).join('')}${avatar(T, { letter: 'An', av: 1 }, 48, 17)}${avatar(T, { letter: 'Ad', av: 4 }, 48, 17)}</div>${caption(T, '--avatar-1 bis --avatar-6 · zwei Buchstaben bei gleicher Initiale')}`);
  const buttonsBlock = block(T, 'Schaltflächen', `<div style="display: flex; flex-wrap: wrap; gap: 8px;">${primaryBtn(T, 'Speichern')}${outlineBtn(T, 'Abbrechen')}</div><div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;"><button type="button" disabled style="height: 56px; padding: 0 24px; border: 0; border-radius: 28px; background: ${T.subtle}; color: ${T.muted}; font-size: 17px; font-weight: 700;">Speichern</button>${textBtn(T, 'Bewertung entfernen')}${overlayBtn(T, ic('back', 24), 'Zurück')}${iconBtn(T, 'refresh', 'Aktualisieren', { extra: ` border: 1.5px solid ${T.borderStrong};` })}</div>${caption(T, 'Primär · Sekundär · deaktiviert · Text · Zurück · Aktualisieren')}`);
  const inputsBlock = block(T, 'Eingabefelder', `<div style="display: flex; flex-direction: column; gap: 6px;">${fieldLabel(T, 'Titel', 'Pflichtfeld')}${input(T, { placeholder: 'z. B. Käsespätzle', h: 52, fs: 17, label: 'Titel' })}</div><div style="display: flex; flex-direction: column; gap: 6px;">${input(T, { value: 'Käsespätzle', h: 52, fs: 17, focus: true, label: 'Titel fokussiert' })}${caption(T, 'Fokus: 2 px Rahmen plus Fokusring')}</div><div style="display: flex; flex-direction: column; gap: 6px;">${input(T, { h: 52, fs: 17, error: true, label: 'Titel mit Fehler' })}<span style="display: flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 600; color: ${T.primaryText};">${ic('alert', 18)}Bitte gib einen Titel ein.</span></div>`);
  const feedbackBlock = block(T, 'Rückmeldungen', `<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 56px; padding: 0 8px 0 18px; border-radius: 28px; background: ${T.toastBg}; color: ${T.toastText}; font-size: 15px; font-weight: 600; box-shadow: 0 8px 24px ${T.shadow};"><span>Rezept gelöscht</span><button type="button" style="height: 44px; padding: 0 14px; border: 0; background: transparent; color: ${T.toastText}; font-size: 15px; font-weight: 800; text-decoration: underline; text-underline-offset: 3px;">Rückgängig</button></div>${caption(T, 'Toast, 8 s, unten über der Navigation')}
<div role="alert" style="display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; border-radius: 18px; background: ${T.highlight}; color: ${T.ink};"><span style="display: flex; align-items: flex-start; gap: 8px; font-size: 15px; font-weight: 700; line-height: 1.4;">${ic('alert', 20)}Server nicht erreichbar – läuft der Rezepte-PC?</span><button type="button" style="align-self: flex-start; height: 44px; padding: 0 16px; box-sizing: border-box; border: 1.5px solid ${T.ink}; border-radius: 22px; background: transparent; color: ${T.ink}; font-size: 15px; font-weight: 700;">Erneut versuchen</button></div>${caption(T, 'Banner oben, die zuletzt geladene Liste bleibt sichtbar')}`);
  const dialogBlock = block(T, 'Dialog: Versionskonflikt', `<div role="dialog" aria-label="Inzwischen geändert" style="display: flex; flex-direction: column; gap: 14px; padding: 22px; border: 1px solid ${T.border}; border-radius: 28px; background: ${T.raised}; box-shadow: 0 16px 40px ${T.shadow};">${h2('Inzwischen von Anna geändert', 22)}<p style="margin: 0; font-size: 16px; line-height: 1.5;">Anna hat das Rezept gespeichert, während du bearbeitet hast. Deine Eingaben bleiben erhalten.</p><div style="display: flex; flex-direction: column; gap: 8px;">${primaryBtn(T, 'Neu laden', { h: 52 })}${outlineBtn(T, 'Meine Version speichern', { h: 52 })}</div></div>`);
  const emptyBlock = block(T, 'Leerzustand', `<div style="display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 8px 0; text-align: center;"><div style="width: 180px; height: 120px;">${plateSvg(T, 0, '', { cutlery: true })}</div>${h2('Noch keine Rezepte', 22)}<p style="margin: 0; font-size: 15px; line-height: 1.5; color: ${T.muted};">Leg dein erstes Rezept an. Mit Foto geht es am schnellsten.</p>${primaryBtn(T, 'Erstes Rezept anlegen', { icon: 'plus', h: 52 })}</div>`);
  const skeletonBlock = block(T, 'Laden (Skeleton)', `<div style="border: 1px solid ${T.border}; border-radius: 24px; overflow: hidden; background: ${T.surface};"><div style="height: 150px; background: ${T.subtle};"></div><div style="display: flex; flex-direction: column; gap: 10px; padding: 14px 16px 16px;"><span style="width: 70%; height: 22px; border-radius: 11px; background: ${T.subtle};"></span><span style="width: 45%; height: 16px; border-radius: 8px; background: ${T.subtle};"></span></div></div>${caption(T, 'Feste Höhe wie die echte Karte, kein Layoutsprung')}`);
  const navBlock = block(T, 'Navigation', `<div style="position: relative; height: 96px;">${navBar(T, 0)}</div>${caption(T, 'Handy und Tablet hochkant: schwebende Leiste · Tablet quer: Leiste links')}`, 2);
  return `<div style="display: flex; flex-direction: column; gap: 24px; padding: 40px;">
<div style="display: flex; align-items: baseline; gap: 16px;">${h1('Komponenten und Zustände', 40)}<span style="font-size: 18px; color: ${T.muted};">${modeLabel}</span></div>
<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; align-items: start;">
${placeholderBlock}${chipsBlock}
${starsBlock}${heartBlock}${avatarsBlock}
${buttonsBlock}${inputsBlock}${feedbackBlock}
${dialogBlock}${emptyBlock}${skeletonBlock}
${navBlock}
</div>
</div>`;
}

// ---------------------------------------------------------------- token sheet (light)
function tokenSheet() {
  const T = LIGHT;
  const sw = (hex, border = false) => `<span style="width: 28px; height: 28px; flex-shrink: 0; box-sizing: border-box; border-radius: 8px; background: ${hex};${border ? ` border: 1px solid ${T.borderStrong};` : ''}"></span>`;
  const palette = [
    ['Linen', '#EFE6DD', 'Hintergrund hell · Text dunkel', 'Raisin Black darauf 13,22:1', '#231F20'],
    ['Raisin Black', '#231F20', 'Text hell · Hintergrund dunkel', 'Linen darauf 13,22:1', '#EFE6DD'],
    ['Terracotta', '#BB4430', 'Primär, FAB, Herz, aktive Chips', 'Weiß darauf 5,27:1 · auf Linen nur groß', '#FFFFFF'],
    ['Moonstone', '#7EBDC2', 'Tag-Chips, Kochen-Kachel', 'nur Fläche, Text 7,72:1', '#231F20'],
    ['Vanilla', '#F3DFA2', 'Sterne, Zeit, Hinweise', 'nur Fläche, Text 12,33:1', '#231F20'],
  ].map(([n, hex, role, c, fg]) => `<div style="display: flex; flex-direction: column; border: 1px solid ${T.border}; border-radius: 20px; overflow: hidden; background: ${T.surface};"><div style="height: 96px; background: ${hex}; color: ${fg}; display: flex; align-items: flex-end; padding: 12px 14px; box-sizing: border-box; font-family: ${DISPLAY}; font-size: 20px; font-weight: 800;">${n}</div><div style="display: flex; flex-direction: column; gap: 4px; padding: 12px 14px 14px; font-size: 14px; line-height: 1.4;"><strong>${hex}</strong><span>${role}</span><span style="color: ${T.muted};">${c}</span></div></div>`).join('');
  const rows = [
    ['--color-bg', LIGHT.bg, DARK.bg, 'Seitenhintergrund'],
    ['--color-surface', LIGHT.surface, DARK.surface, 'Karten, Zeilen, Kacheln'],
    ['--color-surface-raised', LIGHT.raised, DARK.raised, 'Sheets, Dialoge, Eingabefelder'],
    ['--color-text', LIGHT.text, DARK.text, '13,22:1 in beiden Modi'],
    ['--color-text-muted', LIGHT.muted, DARK.muted, 'hell 7,73:1 · dunkel 9,01:1'],
    ['--color-border-strong', LIGHT.borderStrong, DARK.borderStrong, 'Rahmen, leere Sterne, ≥ 3:1'],
    ['--color-primary', LIGHT.primary, DARK.primary, 'Flächen, Icons, großer Text'],
    ['--color-on-primary', LIGHT.onPrimary, DARK.onPrimary, 'hell 5,27:1 · dunkel 4,54:1'],
    ['--color-primary-text', LIGHT.primaryText, DARK.primaryText, 'Text und Fehler in normaler Größe'],
    ['--color-secondary', LIGHT.secondary, DARK.secondary, 'immer mit #231F20'],
    ['--color-highlight', LIGHT.highlight, DARK.highlight, 'immer mit #231F20'],
    ['--color-nav', LIGHT.nav, DARK.nav, 'Navigationsleiste, Text Linen'],
  ].map(([t, l, d, note]) => `<div style="display: grid; grid-template-columns: 220px 150px 150px minmax(0, 1fr); align-items: center; gap: 12px; min-height: 44px; border-bottom: 1px solid ${T.border}; font-size: 14px;"><code style="font-size: 14px; font-weight: 600;">${t}</code><span style="display: flex; align-items: center; gap: 8px;">${sw(l, true)}${l}</span><span style="display: flex; align-items: center; gap: 8px;">${sw(d, true)}${d}</span><span style="color: ${T.muted};">${note}</span></div>`).join('');
  const phRow = PH.map((c, i) => `<span style="display: flex; align-items: center; gap: 8px; font-size: 14px;">${sw(c, true)}--placeholder-${i + 1} ${c}</span>`).join('');
  const type = [
    ['Screen-Titel', DISPLAY, 36, 800, 'Rezepte'],
    ['Karten-Titel', DISPLAY, 24, 700, 'Käsespätzle'],
    ['Abschnitt', DISPLAY, 26, 700, 'Zutaten'],
    ['Schritt-Kopf', DISPLAY, 20, 800, 'Schritt 1'],
    ['Zubereitung', BODY, 18, 400, 'Den Teig portionsweise ins Wasser schaben.'],
    ['Fließtext', BODY, 17, 400, 'Wie bei Oma im Allgäu, mit viel Bergkäse.'],
    ['Label', BODY, 15, 700, 'Mindestbewertung'],
    ['Meta', BODY, 14, 600, '45 min · Ø 4,3 (3)'],
    ['Navigation', BODY, 12, 700, 'Favoriten'],
  ].map(([n, f, s, w, ex]) => `<div style="display: grid; grid-template-columns: 170px 150px minmax(0, 1fr); align-items: baseline; gap: 12px; padding: 6px 0; border-bottom: 1px solid ${T.border};"><span style="font-size: 14px; font-weight: 700;">${n}</span><span style="font-size: 13px; color: ${T.muted};">${f.includes('Bricolage') ? 'Bricolage' : 'Figtree'} ${s}/${w}</span><span style="font-family: ${f}; font-size: ${s}px; font-weight: ${w}; line-height: 1.3;">${ex}</span></div>`).join('');
  const kv = (k, v) => `<div style="display: flex; justify-content: space-between; gap: 12px; min-height: 36px; align-items: center; border-bottom: 1px solid ${T.border}; font-size: 15px;"><span>${k}</span><strong>${v}</strong></div>`;
  const b = (title, inner) => `<section style="display: flex; flex-direction: column; gap: 10px; padding: 20px; border: 1px solid ${T.border}; border-radius: 24px; background: ${T.surface};"><h2 style="margin: 0; font-family: ${DISPLAY}; font-size: 22px; font-weight: 700;">${title}</h2>${inner}</section>`;
  const body = `<div style="display: flex; flex-direction: column; gap: 24px; padding: 40px;">
${h1('Token-Blatt · Richtung C', 40)}
<div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 16px;">${palette}</div>
${b('Tokens hell und dunkel', `<div style="display: grid; grid-template-columns: 220px 150px 150px minmax(0, 1fr); gap: 12px; font-size: 13px; font-weight: 700; color: ${T.muted};"><span>Token</span><span>Hell</span><span>Dunkel</span><span>Einsatz</span></div>${rows}<div style="display: flex; flex-wrap: wrap; gap: 16px; padding-top: 8px;">${phRow}</div><span style="font-size: 14px; color: ${T.muted};">Platzhalterbild dunkel: Fläche --color-surface, Teller in der Platzhalterfarbe.</span>`)}
<div style="display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 20px; align-items: start;">
${b('Typografie', `<span style="font-size: 14px; color: ${T.muted};">Bricolage Grotesque (Überschriften, 700/800) und Figtree (Text, 400/600/700), selbst gehostet als WOFF2, zusammen ≤ 100 KB (NF-01).</span>${type}`)}
<div style="display: flex; flex-direction: column; gap: 20px;">
${b('Radien', kv('Chip, Pill, Suchfeld', '22–26 px') + kv('Karte', '24 px') + kv('Kachel, Zeile', '16–18 px') + kv('Eingabefeld', '12 px') + kv('Sheet, Dialog', '28 px'))}
${b('Abstände und Tippflächen', kv('Raster', '4 · 8 · 12 · 16 · 20 · 24 · 32') + kv('Seitenrand Handy', '20 px') + kv('Tippfläche mindestens', '44 px') + kv('Herz, Sterne, Speichern', '48 px') + kv('Neues Rezept (FAB)', '60 px'))}
${b('Bildformate', kv('Kartenbild', '3:2, 350×233 am Handy') + kv('Variante s', '720×480 WebP') + kv('Variante m', '1200 px lange Kante') + kv('Variante l', '2048 px lange Kante') + kv('Tablet-Liste', '112×75 aus s'))}
</div>
</div>
</div>`;
  return body;
}

// ---------------------------------------------------------------- app icon sheet
function iconSheet() {
  const T = LIGHT;
  const tile = (size, label, radius, inner) => `<div style="display: flex; flex-direction: column; align-items: center; gap: 10px;"><div style="width: ${size}px; height: ${size}px; border-radius: ${radius}px; overflow: hidden; box-shadow: 0 6px 18px ${T.shadow};">${inner}</div><span style="font-size: 14px; font-weight: 600; text-align: center;">${label}</span></div>`;
  const mask = `<div style="position: relative; width: 256px; height: 256px;">${iconMark('#EFE6DD', '#BB4430')}<span style="position: absolute; left: 25.6px; top: 25.6px; width: 204.8px; height: 204.8px; box-sizing: border-box; border: 2px dashed rgba(239,230,221,0.7); border-radius: 50%;"></span></div>`;
  return `<div style="display: flex; flex-direction: column; gap: 28px; padding: 40px;">
${h1('App-Icon und Favicon', 40)}
<div style="display: flex; align-items: flex-end; gap: 40px; flex-wrap: wrap;">
${tile(256, '512 maskable (halbe Größe)<br>gestrichelt: Safe-Zone 80 %', 0, mask)}
${tile(96, '192', 22, iconMark('#EFE6DD', '#BB4430'))}
${tile(90, 'apple-touch-icon 180', 20, iconMark('#EFE6DD', '#BB4430'))}
${tile(64, 'Favicon 32 (2×)', 12, iconMark('#EFE6DD', '#BB4430', { cutlery: false }))}
${tile(32, 'Favicon 16 (2×)', 6, iconMark('#EFE6DD', '#BB4430', { cutlery: false }))}
</div>
<div style="display: flex; gap: 16px;">
<div style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; border: 1px solid ${T.border}; border-radius: 16px; background: ${T.surface}; font-size: 15px;"><span style="width: 32px; height: 32px; box-sizing: border-box; border: 1px solid ${T.borderStrong}; border-radius: 8px; background: #EFE6DD;"></span>theme-color hell <strong>#EFE6DD</strong></div>
<div style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; border: 1px solid ${T.border}; border-radius: 16px; background: ${T.surface}; font-size: 15px;"><span style="width: 32px; height: 32px; border-radius: 8px; background: #231F20;"></span>theme-color dunkel <strong>#231F20</strong></div>
</div>
<p style="margin: 0; max-width: 820px; font-size: 16px; line-height: 1.5;">Das Icon nimmt das Teller-Motiv des Platzhalterbilds auf. Unter 48 px entfällt das Besteck, damit der Teller lesbar bleibt.</p>
</div>`;
}

// ---------------------------------------------------------------- write
const files = {};
function add(name, title, T, w, h, body, opts) { files[name] = doc(title, T, w, h, body, opts); }

for (const [suffix, T] of Object.entries(THEMES)) {
  const S = suffix === 'hell' ? 'Hell' : 'Dunkel';
  const main = suffix === 'hell' ? 'Main.dc.html' : 'HandyListeDunkel.dc.html';
  add(`HandyProfil${S}.dc.html`, `Profilwahl – Handy ${suffix}`, T, 390, 844, phoneProfiles(T));
  add(main, `Rezeptliste – Handy ${suffix}`, T, 390, 844, phoneList(T));
  add(`HandyFilter${S}.dc.html`, `Filter – Handy ${suffix}`, T, 390, 844, phoneFilter(T));
  add(`HandyDetail${S}.dc.html`, `Rezeptdetail – Handy ${suffix}`, T, 390, 2300, phoneDetail(T), { flex: true });
  add(`HandyEditor${S}.dc.html`, `Neues Rezept – Handy ${suffix}`, T, 390, 2000, phoneEditor(T), { flex: true });
  add(`HandyFavoriten${S}.dc.html`, `Favoriten – Handy ${suffix}`, T, 390, 844, phoneFavorites(T));
  add(`TabletQuer${S}.dc.html`, `Liste und Detail – Tablet quer ${suffix}`, T, 1024, 768, tabletLandscape(T));
  add(`TabletQuerEditor${S}.dc.html`, `Rezept bearbeiten – Tablet quer ${suffix}`, T, 1024, 768, tabletEditor(T));
  add(`TabletQuerFilter${S}.dc.html`, `Filter – Tablet quer ${suffix}`, T, 1024, 768, tabletFilter(T));
  add(`TabletHochListe${S}.dc.html`, `Rezeptliste – Tablet hochkant ${suffix}`, T, 768, 1024, tabletPortraitList(T));
  add(`TabletHochDetail${S}.dc.html`, `Rezeptdetail – Tablet hochkant ${suffix}`, T, 768, 1800, tabletPortraitDetail(T), { flex: true });
  add(`Komponenten${S}.dc.html`, `Komponenten und Zustände ${suffix}`, T, 1240, 2000, components(T, suffix === 'hell' ? 'Hell' : 'Dunkel'));
}
add('TokenBlatt.dc.html', 'Token-Blatt Richtung C', LIGHT, 1240, 1800, tokenSheet());
add('AppIcon.dc.html', 'App-Icon und Favicon', LIGHT, 1000, 660, iconSheet());

fs.mkdirSync(OUT, { recursive: true });
for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), content);
console.log(Object.keys(files).length, 'files:', Object.keys(files).join(', '));
