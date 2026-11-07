// vtt/frame.js — The frame of Grimbold's own windows in Owlbear (the skill
// challenge and the rolls): a title bar to drag the window somewhere else, a
// button to shrink it to the title bar, a close button, and a corner to drag
// for a new size. Owlbear can resize a window live but not move it, so a move
// lands when the mouse is let go (the background page reopens it there).

import { WINDOWS, COLLAPSED_HEIGHT, MIN_SIZE, GHOST_POPOVER, GHOST_CHANNEL, windowPlace, setWindowPlace, requestReopen } from './shared.js';

// The outline shown while dragging lives in its own overlay window (vtt/ghost.html).
const ghostChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(GHOST_CHANNEL) : null;
let ghostRect = null;
if (ghostChannel) ghostChannel.addEventListener('message', event => { if (event.data === 'ready' && ghostRect) ghostChannel.postMessage(ghostRect); });

async function openGhost(OBR) {
  try {
    const [width, height] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
    await OBR.popover.open({
      id: GHOST_POPOVER, url: '/vtt/ghost.html', width, height,
      anchorReference: 'POSITION', anchorPosition: { left: 0, top: 0 },
      anchorOrigin: { horizontal: 'LEFT', vertical: 'TOP' }, transformOrigin: { horizontal: 'LEFT', vertical: 'TOP' },
      hidePaper: true, disableClickAway: true, marginThreshold: 0
    });
  } catch { /* no outline: the move still lands on release */ }
}
const closeGhost = OBR => OBR.popover.close(GHOST_POPOVER).catch(() => {});

// With a scene open, the outline is drawn on the map itself (a local shape
// only this player sees): no window to load, no open animation. The overlay
// above is the fallback when no scene is open.
const OUTLINE_ID = 'grimbold.dice/window-outline';
async function sceneOutliner(OBR, buildShape) {
  try {
    if (!(await OBR.scene.isReady())) return null;
    const [scale, origin] = await Promise.all([OBR.viewport.getScale(), OBR.viewport.inverseTransformPoint({ x: 0, y: 0 })]);
    const toScene = point => ({ x: origin.x + point.x / scale, y: origin.y + point.y / scale });
    let added = null;
    let pending = null;
    let frame = 0;
    const flush = () => {
      frame = 0;
      const rect = pending;
      if (!rect || !added) return;
      OBR.scene.local.updateItems([OUTLINE_ID], drafts => { drafts.forEach(draft => { draft.position = toScene(rect); }); }, true).catch(() => {});
    };
    return {
      async show(rect) {
        pending = rect;
        if (!added) {
          added = OBR.scene.local.addItems([buildShape()
            .id(OUTLINE_ID).shapeType('RECTANGLE').width(rect.width / scale).height(rect.height / scale)
            .position(toScene(rect)).strokeColor('#8ea1ff').strokeWidth(2 / scale).strokeDash([8 / scale, 6 / scale])
            .fillColor('#5865f2').fillOpacity(0.18).layer('POPOVER').locked(true).disableHit(true).build()]).catch(() => {});
          return;
        }
        if (!frame) frame = requestAnimationFrame(flush);
      },
      remove() {
        pending = null;
        if (added) added.then(() => OBR.scene.local.deleteItems([OUTLINE_ID])).catch(() => {});
      }
    };
  } catch {
    return null;
  }
}

export function createFrame({ OBR, buildShape, name, title, onClose }) {
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

  // Moving: drag the title bar. An overlay shows the outline of where it
  // will land; on release the window jumps there. If the overlay takes the
  // mouse over, it follows the mouse itself and reports the release.
  let finishMove = null;
  if (ghostChannel) ghostChannel.addEventListener('message', event => {
    const data = event.data;
    if (data && data.done && finishMove) finishMove(data.done);
  });
  bar.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const start = { x: event.screenX, y: event.screenY };
    const from = place();
    const size = { width: window.innerWidth, height: window.innerHeight };
    // Where in the window it was grabbed (the overlay needs it if it takes over).
    const grab = { x: Math.round(event.clientX), y: Math.round(event.clientY) };
    let ghostOpen = false;
    let landing = null;
    // Ready by the time the mouse has moved a little.
    const outliner = buildShape ? sceneOutliner(OBR, buildShape) : Promise.resolve(null);
    let outline = null;
    bar.setPointerCapture(event.pointerId);
    document.body.classList.add('is-moving');
    const finish = rect => {
      if (!finishMove) return;
      finishMove = null;
      bar.removeEventListener('pointermove', onMove);
      bar.removeEventListener('pointerup', onUp);
      bar.removeEventListener('pointercancel', onCancel);
      document.body.classList.remove('is-moving');
      hint.textContent = '';
      ghostRect = null;
      if (ghostOpen) closeGhost(OBR);
      outliner.then(drawn => drawn && drawn.remove());
      if (!rect) return;
      setWindowPlace(name, { left: Math.max(0, Math.round(rect.left)), top: Math.max(0, Math.round(rect.top)) });
      requestReopen(name);
    };
    finishMove = finish;
    const onMove = moveEvent => {
      const dx = Math.round(moveEvent.screenX - start.x);
      const dy = Math.round(moveEvent.screenY - start.y);
      if (Math.abs(dx) + Math.abs(dy) <= 4) return;
      hint.textContent = 'Let go to move it ' + arrows(dx, dy);
      landing = { left: Math.max(0, (from.left || 0) + dx), top: Math.max(0, (from.top || 0) + dy) };
      ghostRect = { ...landing, ...size, grab, title: heading.textContent };
      if (outline) { outline.show(ghostRect); return; }
      if (outline === false || ghostOpen) {
        if (ghostChannel) ghostChannel.postMessage(ghostRect);
        return;
      }
      if (outline === undefined) return; // still finding out
      outline = undefined;
      outliner.then(drawn => {
        if (!finishMove) return;
        if (drawn) { outline = drawn; drawn.show(ghostRect || { ...landing, ...size }); return; }
        // No scene open: the overlay window instead.
        outline = false;
        ghostOpen = true;
        openGhost(OBR);
      });
    };
    const onUp = () => finish(landing);
    // Lost the mouse: if the overlay is up it carries on and reports the release.
    const onCancel = () => { if (!ghostOpen) finish(null); };
    bar.addEventListener('pointermove', onMove);
    bar.addEventListener('pointerup', onUp);
    bar.addEventListener('pointercancel', onCancel);
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
