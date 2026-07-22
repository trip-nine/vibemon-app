// VibeMon engine instance (2D pixel-art or 3D pet).
let vibeMonEngine = null;
let cleanupStateListener = null;
let interactionActive = false;
let lastReportedState = null;

function setInteractionActive(active) {
  if (interactionActive === active || !vibeMonEngine) return;
  interactionActive = active;
  vibeMonEngine.setState({ state: active ? 'start' : (lastReportedState || 'start') });
  vibeMonEngine.render();
}

async function init() {
  const container = document.getElementById('vibemon-display');
  const [{ characters, default: defaultCharacter }, { states }, renderMode] = await Promise.all([
    window.electronAPI.getCharacterRegistry(),
    window.electronAPI.getStateRegistry(),
    window.electronAPI.getRenderMode()
  ]);

  if (renderMode === '3d') {
    const { createVibeMonEngine } = await import('./engine/vibemon-engine-3d.js');
    vibeMonEngine = createVibeMonEngine(container, { characters, defaultCharacter, states });
  } else {
    const { createVibeMonEngine } = await import('./engine/vibemon-engine.js');
    vibeMonEngine = createVibeMonEngine(container, {
      characters,
      defaultCharacter,
      // Bundled sprites only. No static.vibemon.io fallback.
      characterImageUrls: Object.fromEntries(
        Object.entries(characters).map(([name, config]) => [name, [`assets/characters/${config.image}`]])
      ),
      states
    });
  }

  await vibeMonEngine.init();
  vibeMonEngine.render();
  vibeMonEngine.startAnimation();

  cleanupStateListener = window.electronAPI.onStateUpdate((data) => {
    if (!data || typeof data !== 'object') return;
    if (typeof data.state === 'string') lastReportedState = data.state;
    vibeMonEngine.setState(data);
    if (interactionActive) vibeMonEngine.setState({ state: 'start' });
    vibeMonEngine.render();
  });

  const DRAG_CLICK_SUPPRESS_PX = 4;
  let pointerDragging = false;
  let dragMoved = false;
  let dragStartX = 0;
  let dragStartY = 0;

  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointerDragging = true;
    dragMoved = false;
    dragStartX = event.screenX;
    dragStartY = event.screenY;
    setInteractionActive(true);
    window.electronAPI.beginWindowDrag?.();
  });

  document.addEventListener('pointermove', (event) => {
    if (!pointerDragging || (event.buttons & 1) === 0) return;
    if (Math.abs(event.screenX - dragStartX) > DRAG_CLICK_SUPPRESS_PX ||
        Math.abs(event.screenY - dragStartY) > DRAG_CLICK_SUPPRESS_PX) dragMoved = true;
    window.electronAPI.moveWindowDrag?.();
  });

  const endPointerDrag = () => {
    pointerDragging = false;
    setInteractionActive(false);
  };
  document.addEventListener('pointerup', (event) => {
    if (event.button === 0) endPointerDrag();
  });
  document.addEventListener('pointercancel', endPointerDrag);

  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    window.electronAPI.showContextMenu?.();
  });

  document.addEventListener('click', (event) => {
    if (event.button !== 0 || dragMoved) return;
    window.electronAPI.focusTerminal?.().catch(err => console.warn('Focus terminal failed:', err));
  });
}

function cleanup() {
  if (vibeMonEngine) vibeMonEngine.cleanup();
  vibeMonEngine = null;
  if (cleanupStateListener) cleanupStateListener();
  cleanupStateListener = null;
}

window.onload = init;
window.onbeforeunload = cleanup;
window.onunload = cleanup;
