// vtt/frame.js — The frame of Grimbold's own windows in Owlbear (the skill
// challenge and the rolls): a title bar to drag the window somewhere else, a
// button to shrink it to the title bar, a close button, and a corner to drag
// for a new size. Owlbear can resize a window live but not move it, so a move
// lands when the mouse is let go (the background page reopens it there).

import { WINDOWS, COLLAPSED_HEIGHT, MIN_SIZE, windowPlace, setWindowPlace, requestReopen } from './shared.js';

export function createFrame({ OBR, name, title, onClose }) {
  const spec = WINDOWS[name];
  const place = () => windowPlace(name) || {};
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  const bar = make('div', 'frame-bar');
  bar.title = 'Drag to move the window';
  const heading = make('span', 'frame-title', title);
  const summary = make('span', 'frame-summary');
  const tools = make('span', 'frame-tools');
  const collapse = make('button', 'frame-button');
  collapse.type = 'button';
  const close = make('button', 'frame-button', '✕');
  close.type = 'button';
  close.title = 'Close';
  tools.append(collapse, close);
  bar.append(heading, summary, tools);
  const body = make('div', 'frame-body');
  const grip = make('div', 'frame-grip');
  grip.title = 'Drag to resize';
  const hint = make('div', 'frame-hint');
  document.body.append(bar, body, grip, hint);

  function showCollapsed() {
    const collapsed = Boolean(place().collapsed);
    document.body.classList.toggle('is-collapsed', collapsed);
    collapse.textContent = collapsed ? '▢' : '▁';
    collapse.title = collapsed ? 'Show the window' : 'Shrink to the title bar';
  }
  showCollapsed();

  collapse.addEventListener('click', async () => {
    const collapsed = !place().collapsed;
    setWindowPlace(name, { collapsed });
    showCollapsed();
    await OBR.popover.setHeight(spec.id, collapsed ? COLLAPSED_HEIGHT : (place().height || spec.height));
  });
  close.addEventListener('click', async () => {
    if (onClose) onClose();
    await OBR.popover.close(spec.id);
  });

  // Moving: drag the title bar; the window jumps there on release.
  bar.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const start = { x: event.screenX, y: event.screenY };
    bar.setPointerCapture(event.pointerId);
    document.body.classList.add('is-moving');
    const onMove = moveEvent => {
      const dx = Math.round(moveEvent.screenX - start.x);
      const dy = Math.round(moveEvent.screenY - start.y);
      hint.textContent = Math.abs(dx) + Math.abs(dy) > 4 ? 'Let go to move it ' + arrows(dx, dy) : '';
    };
    const onUp = upEvent => {
      bar.removeEventListener('pointermove', onMove);
      bar.removeEventListener('pointerup', onUp);
      bar.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('is-moving');
      hint.textContent = '';
      const dx = Math.round(upEvent.screenX - start.x);
      const dy = Math.round(upEvent.screenY - start.y);
      if (upEvent.type === 'pointercancel' || Math.abs(dx) + Math.abs(dy) <= 4) return;
      const current = place();
      setWindowPlace(name, { left: Math.max(0, (current.left || 0) + dx), top: Math.max(0, (current.top || 0) + dy) });
      requestReopen(name);
    };
    bar.addEventListener('pointermove', onMove);
    bar.addEventListener('pointerup', onUp);
    bar.addEventListener('pointercancel', onUp);
  });

  // Resizing: drag the corner; Owlbear resizes the window as you go.
  grip.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const start = { x: event.screenX, y: event.screenY, width: window.innerWidth, height: window.innerHeight };
    grip.setPointerCapture(event.pointerId);
    let frame = 0;
    let size = { width: start.width, height: start.height };
    const onMove = moveEvent => {
      size = {
        width: Math.max(MIN_SIZE.width, Math.round(start.width + moveEvent.screenX - start.x)),
        height: Math.max(MIN_SIZE.height, Math.round(start.height + moveEvent.screenY - start.y))
      };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        OBR.popover.setWidth(spec.id, size.width);
        OBR.popover.setHeight(spec.id, size.height);
      });
    };
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      setWindowPlace(name, { width: size.width, height: size.height });
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  });

  return {
    body,
    // A short line in the title bar (shown when the window is shrunk).
    setSummary(text) { summary.textContent = text || ''; }
  };
}

function arrows(dx, dy) {
  return (dy < -4 ? '↑' : dy > 4 ? '↓' : '') + (dx < -4 ? '←' : dx > 4 ? '→' : '');
}

// The frame's look; each window page adds it once.
export const FRAME_CSS = `
  html, body { height: 100%; }
  body { margin: 0; padding: 0; display: flex; flex-direction: column; overflow: hidden; }
  .frame-bar { display: flex; align-items: center; gap: 6px; padding: 8px 10px; cursor: grab; user-select: none; touch-action: none; border-bottom: 1px solid rgba(255, 255, 255, .08); flex: none; }
  body.is-moving .frame-bar { cursor: grabbing; background: rgba(88, 101, 242, .25); }
  .frame-title { font-weight: bold; font-size: 14px; white-space: nowrap; }
  .frame-summary { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #a3a3a3; font-size: 12px; }
  .frame-tools { display: flex; gap: 4px; flex: none; }
  .frame-button { padding: 2px 8px; border: 0; border-radius: 4px; background: #4e5058; color: #fff; cursor: pointer; font: inherit; }
  .frame-body { flex: 1; overflow: auto; padding: 10px 12px 18px; }
  body.is-collapsed .frame-body, body.is-collapsed .frame-grip { display: none; }
  body.is-collapsed .frame-bar { border-bottom: 0; }
  .frame-grip { position: fixed; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; touch-action: none;
    background: linear-gradient(135deg, transparent 50%, rgba(255, 255, 255, .35) 50%, rgba(255, 255, 255, .35) 60%, transparent 60%, transparent 70%, rgba(255, 255, 255, .35) 70%, rgba(255, 255, 255, .35) 80%, transparent 80%); }
  .frame-hint { position: fixed; left: 0; right: 0; bottom: 0; text-align: center; font-size: 12px; color: #fff; background: rgba(88, 101, 242, .8); padding: 4px; }
  .frame-hint:empty { display: none; }
`;
