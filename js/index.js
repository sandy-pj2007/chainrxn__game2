'use strict';

/* ── Player colours ── */
const COLORS  = ['#00d4ff', '#ff4d6d', '#43e97b', '#ffa726'];
const NAMES   = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];

/* ── Grid size ── */
const ROWS = 12;
const COLS = 6;

/* ── Game state (filled by startGame) ── */
let state = {};

/* ── Sound toggle ── */
let soundOn = true;
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function beep(freq, type, dur, vol) {
  if (!soundOn) return;
  try {
    const ctx = getAudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.2, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  } catch(e) {}
}
function sndPlace()   { beep(440, 'sine',     0.08); }
function sndExplode() { beep(120, 'sawtooth', 0.25, 0.3); }
function sndCapture() { beep(660, 'triangle', 0.15); }
function sndWin()     { [523,659,784,1047].forEach((f,i) => setTimeout(() => beep(f,'sine',0.3), i*150)); }
function sndTick()    { beep(880, 'sine', 0.05, 0.1); }

/* ════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════ */
const $  = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function fmtTime(s) {
  s = Math.max(0, s | 0);
  return String(Math.floor(s / 60)).padStart(2,'0') + ':' + String(s % 60).padStart(2,'0');
}

/* ── Your exact capacity logic ── */
function capacity(r, c) {
  const isCorner = (c === 0 || c === COLS - 1) && (r === 0 || r === ROWS - 1);
  const isEdge   = (c === 0 || c === COLS - 1 || r === 0 || r === ROWS - 1);
  if (isCorner)        return 2;
  if (isEdge)          return 3;
  /* inner cell */     return 4;
}

/* Orthogonal neighbours (used for explosion distribution) */
function neighbours(r, c) {
  return [[-1,0],[1,0],[0,-1],[0,1]]
    .map(([dr,dc]) => [r+dr, c+dc])
    .filter(([nr,nc]) => nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS);
}

/* ════════════════════════════════════════════════
   STATE BUILDER
════════════════════════════════════════════════ */
function buildState(numPlayers, gameTimerSec, turnTimerSec) {
  /* cells[r][c] = { owner: -1|0..3, count: 0 } */
  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    cells[r] = [];
    for (let c = 0; c < COLS; c++) {
      cells[r][c] = { owner: -1, count: 0 };
    }
  }

  return {
    cells,
    numPlayers,
    turn: 0,                              // whose turn (index)
    hasPlaced: new Array(numPlayers).fill(false),  // first-move tracker
    scores:    new Array(numPlayers).fill(0),
    pieces:    new Array(numPlayers).fill(0),
    moveNum:   0,
    history:   [],
    paused:    false,
    over:      false,
    gameTimer: gameTimerSec,
    turnTimer: turnTimerSec,
    turnTimeLeft: turnTimerSec,
    busy:      false,   // true while explosion chain runs (blocks clicks)
  };
}

/* ════════════════════════════════════════════════
   SCREEN SWITCHER
════════════════════════════════════════════════ */
function showScreen(name) {
  ['menu-screen','game-screen','lb-screen'].forEach(id => {
    const el = $(id);
    if (el) el.classList.toggle('hidden', id !== name);
  });
}

/* ════════════════════════════════════════════════
   START GAME
════════════════════════════════════════════════ */
function startGame() {
  const numPlayers   = parseInt($('player-count').value);
  const gameTimerSec = parseInt($('game-timer-input').value) || 0;
  const turnTimerSec = parseInt($('turn-timer-input').value) || 0;

  state = buildState(numPlayers, gameTimerSec, turnTimerSec);

  showScreen('game-screen');
  buildGrid();
  buildPlayerStrips();
  renderAll();
  startTimers();
}

/* ════════════════════════════════════════════════
   BUILD GRID DOM
════════════════════════════════════════════════ */
function buildGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  /* 6 columns, 12 rows — matches COLS=6, ROWS=12 */
  grid.style.gridTemplateColumns = `repeat(${COLS}, auto)`;
  grid.style.gridTemplateRows    = `repeat(${ROWS}, auto)`;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r;
      cell.dataset.c = c;

      // Capacity badge (your snippet used cell.textContent — we use a label
      // so orb dots can sit alongside it without overwriting the number)
      const cap = document.createElement('span');
      cap.className = 'cap-label';
      cap.textContent = capacity(r, c);   // 2 / 3 / 4 from your function
      cell.appendChild(cap);

      // Orbs wrapper
      const orbs = document.createElement('div');
      orbs.className = 'orbs-wrap';
      cell.appendChild(orbs);

      // Your exact click handler pattern
      cell.addEventListener('click', () => {
        console.log(`clicked row ${r}, col ${c}`);   // keep your log
        onCellClick(r, c);
      });

      grid.appendChild(cell);
    }
  }
}

/* ════════════════════════════════════════════════
   BUILD PLAYER STRIPS
════════════════════════════════════════════════ */
function buildPlayerStrips() {
  const wrap = $('player-strips');
  wrap.innerHTML = '';
  for (let p = 0; p < state.numPlayers; p++) {
    const div = document.createElement('div');
    div.className = 'player-strip';
    div.id = `strip-${p}`;
    div.style.setProperty('--pc', COLORS[p]);
    div.innerHTML = `
      <div class="strip-name">${NAMES[p]}</div>
      <div class="strip-score" id="score-${p}">0</div>
      <div class="strip-pieces" id="pieces-${p}">0 pieces</div>
      <div class="strip-hint"  id="hint-${p}"></div>
      <div class="turn-bar-wrap">
        <div class="turn-bar" id="tbar-${p}" style="width:100%"></div>
      </div>
    `;
    wrap.appendChild(div);
  }
}

/* ════════════════════════════════════════════════
   RENDER EVERYTHING
════════════════════════════════════════════════ */
function renderAll() {
  renderGrid();
  renderStrips();
  renderStatus();
}

/* Re-draw every cell */
function renderGrid() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      renderCell(r, c);
    }
  }
  markValidCells();
}

function renderCell(r, c) {
  const cellData = state.cells[r][c];
  const el = getCellEl(r, c);
  if (!el) return;

  // Owner border class
  el.classList.remove('owned-0','owned-1','owned-2','owned-3');
  if (cellData.owner >= 0) {
    el.classList.add(`owned-${cellData.owner}`);
  }

  // Draw orb dots
  const orbs = el.querySelector('.orbs-wrap');
  orbs.innerHTML = '';
  if (cellData.count > 0) {
    const color = COLORS[cellData.owner];
    const show = Math.min(cellData.count, 4);
    for (let i = 0; i < show; i++) {
      const dot = document.createElement('div');
      dot.className = 'orb';
      dot.style.background = color;
      dot.style.boxShadow  = `0 0 5px ${color}`;
      orbs.appendChild(dot);
    }
    // If more than 4, show number on last dot
    if (cellData.count > 4) {
      orbs.lastChild.textContent = cellData.count;
      orbs.lastChild.style.fontSize = '8px';
      orbs.lastChild.style.color = '#fff';
      orbs.lastChild.style.display = 'flex';
      orbs.lastChild.style.alignItems = 'center';
      orbs.lastChild.style.justifyContent = 'center';
    }
  }
}

/* Highlight which cells the current player can click */
function markValidCells() {
  if (state.over || state.busy) return;
  const p = state.turn;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = getCellEl(r, c);
      el.classList.remove('valid', 'no-click');
      if (isValidMove(r, c, p)) {
        el.classList.add('valid');
      } else {
        el.classList.add('no-click');
      }
    }
  }
}

/* ── Is this a legal move for player p? ──
   First move  → any empty cell
   Later moves → only cells owned by p           */
function isValidMove(r, c, p) {
  const cell = state.cells[r][c];
  if (!state.hasPlaced[p]) {
    // First move: pick any empty cell
    return cell.owner === -1;
  }
  // Subsequent moves: only own cells
  return cell.owner === p;
}

function renderStrips() {
  recalcPieces();
  for (let p = 0; p < state.numPlayers; p++) {
    const strip = $(`strip-${p}`);
    if (!strip) continue;
    strip.classList.toggle('active', p === state.turn && !state.over);
    $(`score-${p}`).textContent  = state.scores[p];
    $(`pieces-${p}`).textContent = state.pieces[p] + ' pieces';

    // Hint text for first-move player
    const hint = $(`hint-${p}`);
    if (hint) {
      hint.textContent = (!state.hasPlaced[p] && p === state.turn)
        ? '← Pick any empty cell'
        : '';
    }
  }
}

function renderStatus() {
  if (state.over) { $('status-msg').textContent = ''; return; }
  const p = state.turn;
  $('status-msg').textContent = `${NAMES[p]}'s turn`;
  $('status-msg').style.color = COLORS[p];
}

function recalcPieces() {
  state.pieces.fill(0);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const cell = state.cells[r][c];
      if (cell.owner >= 0) state.pieces[cell.owner] += cell.count;
    }
}

/* ════════════════════════════════════════════════
   CELL CLICK
════════════════════════════════════════════════ */
async function onCellClick(r, c) {
  if (state.over || state.paused || state.busy) return;
  const p = state.turn;
  if (!isValidMove(r, c, p)) return;

  state.busy = true;
  await doMove(r, c, p);
  state.busy = false;
}

/* ════════════════════════════════════════════════
   DO MOVE  (place + explode + next turn)
════════════════════════════════════════════════ */
async function doMove(r, c, player) {
  const cell = state.cells[r][c];
  const isFirst = !state.hasPlaced[player];

  /* ── How many orbs to place ──────────────────
     First move  : capacity - 1  (minimum 1)
     Later moves : exactly 1                    */
  const add = isFirst ? Math.max(1, capacity(r, c) - 1) : 1;

  // Place orbs
  cell.owner = player;
  cell.count += add;
  state.hasPlaced[player] = true;

  sndPlace();
  animCell(r, c, 'anim-pop');
  renderCell(r, c);
  recordHistory(r, c, player, add, snapshotBoard());  // visual snapshot
  state.moveNum++;

  // Run explosion chain
  await explodeChain(player);

  // Check for win
  if (checkWin()) return;

  nextTurn();
}

/* ════════════════════════════════════════════════
   EXPLOSION CHAIN
════════════════════════════════════════════════ */
async function explodeChain(trigPlayer) {
  let chainDepth = 0;
  let anyExploded = true;

  while (anyExploded) {
    anyExploded = false;

    // Collect all over-capacity cells
    const toExplode = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const cell = state.cells[r][c];
        if (cell.count >= capacity(r, c) && cell.count > 0) {
          toExplode.push([r, c]);
        }
      }

    if (toExplode.length === 0) break;

    anyExploded = true;
    chainDepth++;
    sndExplode();

    // Show chain depth in status
    if (chainDepth >= 2) {
      $('status-msg').textContent = `⚡ Chain x${chainDepth}!`;
      $('status-msg').style.color = '#ffd700';
    }

    // Explode each over-capacity cell simultaneously
    for (const [r, c] of toExplode) {
      const cell = state.cells[r][c];
      cell.count = 0;
      cell.owner = -1;
      animCell(r, c, 'anim-boom');
    }

    // Distribute one orb to each neighbour
    for (const [r, c] of toExplode) {
      for (const [nr, nc] of neighbours(r, c)) {
        const nb = state.cells[nr][nc];
        const wasDiff = nb.owner !== -1 && nb.owner !== trigPlayer;
        if (wasDiff) {
          state.scores[trigPlayer] += 10 * chainDepth; // capture bonus
          sndCapture();
        }
        nb.count++;
        nb.owner = trigPlayer;
        animCell(nr, nc, 'anim-captured');
      }
    }

    state.scores[trigPlayer] += chainDepth * 3; // chain bonus
    recalcPieces();
    renderGrid();
    await sleep(350);   // pause so the player can see each wave
  }
}

/* ════════════════════════════════════════════════
   CELL ANIMATION HELPER
════════════════════════════════════════════════ */
function animCell(r, c, cls) {
  const el = getCellEl(r, c);
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // force reflow to restart animation
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 400);
}

function getCellEl(r, c) {
  return document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
}

/* ════════════════════════════════════════════════
   NEXT TURN
════════════════════════════════════════════════ */
function nextTurn() {
  if (state.over) return;
  state.turn = (state.turn + 1) % state.numPlayers;

  // Skip eliminated players (placed at least once but now 0 pieces)
  let tries = 0;
  while (
    state.hasPlaced[state.turn] &&
    state.pieces[state.turn] === 0 &&
    tries < state.numPlayers
  ) {
    state.turn = (state.turn + 1) % state.numPlayers;
    tries++;
  }

  state.turnTimeLeft = state.turnTimer;
  renderAll();
}

/* ════════════════════════════════════════════════
   WIN CHECK
════════════════════════════════════════════════ */
function checkWin() {
  if (state.over) return false;
  // Only check after every player has placed at least once
  if (!state.hasPlaced.every(Boolean)) return false;

  recalcPieces();
  const alive = state.pieces
    .map((p, i) => ({ p, i }))
    .filter(x => x.p > 0);

  if (alive.length === 1) {
    endGame(alive[0].i, 'domination');
    return true;
  }
  return false;
}

/* ════════════════════════════════════════════════
   END GAME
════════════════════════════════════════════════ */
function endGame(winner, reason) {
  state.over = true;
  clearTimers();
  sndWin();

  $('gameover-title').textContent =
    reason === 'time' ? 'Time Up!' : `${NAMES[winner]} Wins! 🏆`;
  $('gameover-title').style.color = COLORS[winner];

  // Final scores sorted best→worst
  const sorted = [...Array(state.numPlayers).keys()]
    .sort((a, b) => state.scores[b] - state.scores[a]);

  const fs = $('final-scores');
  fs.innerHTML = '';
  sorted.forEach((p, rank) => {
    const row = document.createElement('div');
    row.className = 'score-row';
    row.style.setProperty('--rc', COLORS[p]);
    row.innerHTML = `<span>${rank + 1}. ${NAMES[p]}</span><span>${state.scores[p]} pts</span>`;
    fs.appendChild(row);
  });

  $('gameover-overlay').classList.remove('hidden');
  saveLeaderboard(winner);
}

/* ════════════════════════════════════════════════
   HISTORY  —  visual mini-board per move
════════════════════════════════════════════════ */

/* Deep-copy the current board into a plain 2-D array */
function snapshotBoard() {
  return state.cells.map(row =>
    row.map(cell => ({ owner: cell.owner, count: cell.count }))
  );
}

/* Called after every move — draws a mini board thumbnail */
function recordHistory(r, c, player, add, snap) {
  const moveNum = state.moveNum + 1;   // +1 because moveNum hasn't incremented yet
  const colLetter = String.fromCharCode(65 + c);
  const label = `#${moveNum} · P${player + 1} → ${colLetter}${r + 1}` +
                (add > 1 ? ` (+${add})` : '');

  // Save to state for reference
  state.history.push({ label, player, r, c, snap });

  // ── Build the history list item ──
  const li = document.createElement('li');
  li.className = 'history-entry';
  li.style.setProperty('--hc', COLORS[player]);

  // Text label row
  const labelEl = document.createElement('div');
  labelEl.className = 'h-label';
  labelEl.textContent = label;
  li.appendChild(labelEl);

  // Mini board
  const mini = buildMiniBoard(snap, r, c, player);
  li.appendChild(mini);

  $('history-list').appendChild(li);
  $('history-list').scrollTop = $('history-list').scrollHeight;
}

/* Build a tiny DOM grid representing the board snapshot.
   The cell that was just played is highlighted with a white ring. */
function buildMiniBoard(snap, playedR, playedC, player) {
  const wrap = document.createElement('div');
  wrap.className = 'mini-board';
  wrap.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = snap[row][col];
      const div = document.createElement('div');
      div.className = 'mini-cell';

      if (cell.owner >= 0) {
        div.style.background = COLORS[cell.owner];
        div.style.opacity = Math.min(0.4 + cell.count * 0.15, 1);
        // Show orb count if > 0
        if (cell.count > 0) {
          div.textContent = cell.count;
        }
      }

      // Highlight the cell that was just played
      if (row === playedR && col === playedC) {
        div.classList.add('mini-played');
        div.style.outline = `2px solid #fff`;
        div.style.outlineOffset = '-1px';
      }

      wrap.appendChild(div);
    }
  }
  return wrap;
}

/* ════════════════════════════════════════════════
   TIMERS
════════════════════════════════════════════════ */
let gameInterval  = null;
let turnInterval  = null;

function startTimers() {
  clearTimers();
  const gd = $('game-timer-display');

  if (state.gameTimer > 0) {
    gd.textContent = fmtTime(state.gameTimer);
    gameInterval = setInterval(() => {
      if (state.paused || state.over || state.busy) return;
      state.gameTimer--;
      gd.textContent = fmtTime(state.gameTimer);
      gd.classList.toggle('warn', state.gameTimer <= 30);
      if (state.gameTimer <= 0) {
        // winner = highest score
        const winner = [...Array(state.numPlayers).keys()]
          .sort((a, b) => state.scores[b] - state.scores[a])[0];
        endGame(winner, 'time');
      }
    }, 1000);
  } else {
    gd.textContent = '';
  }

  if (state.turnTimer > 0) {
    updateTurnBar(100);
    turnInterval = setInterval(() => {
      if (state.paused || state.over || state.busy) return;
      state.turnTimeLeft--;
      const pct = (state.turnTimeLeft / state.turnTimer) * 100;
      updateTurnBar(pct);
      if (state.turnTimeLeft <= 5 && state.turnTimeLeft > 0) sndTick();
      if (state.turnTimeLeft <= 0) nextTurn(); // auto-skip on timeout
    }, 1000);
  }
}

function clearTimers() {
  clearInterval(gameInterval);
  clearInterval(turnInterval);
  gameInterval = null;
  turnInterval = null;
}

function updateTurnBar(pct) {
  for (let p = 0; p < state.numPlayers; p++) {
    const bar = $(`tbar-${p}`);
    if (bar) bar.style.width = (p === state.turn ? pct : 0) + '%';
  }
}

/* ════════════════════════════════════════════════
   LEADERBOARD  (localStorage)
════════════════════════════════════════════════ */
function saveLeaderboard(winner) {
  let lb = JSON.parse(localStorage.getItem('cr_lb') || '[]');
  lb.push({
    name:  NAMES[winner],
    score: state.scores[winner],
    date:  new Date().toLocaleDateString(),
  });
  lb.sort((a, b) => b.score - a.score);
  lb = lb.slice(0, 30);
  localStorage.setItem('cr_lb', JSON.stringify(lb));
}

function renderLeaderboard() {
  const lb = JSON.parse(localStorage.getItem('cr_lb') || '[]');
  const body = $('lb-body');
  body.innerHTML = '';
  if (!lb.length) {
    body.innerHTML = '<tr><td colspan="4" style="color:#aaa;padding:16px">No entries yet</td></tr>';
    return;
  }
  lb.forEach((e, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i + 1}</td><td>${e.name}</td><td>${e.score}</td><td>${e.date}</td>`;
    body.appendChild(tr);
  });
}

/* ════════════════════════════════════════════════
   BUTTON WIRING
════════════════════════════════════════════════ */

// Menu
$('start-btn').addEventListener('click', startGame);
$('lb-btn').addEventListener('click', () => { renderLeaderboard(); showScreen('lb-screen'); });

// Game top bar
$('menu-btn').addEventListener('click', () => { clearTimers(); showScreen('menu-screen'); });
$('pause-btn').addEventListener('click', () => {
  state.paused = !state.paused;
  $('pause-btn').textContent = state.paused ? 'Resume' : 'Pause';
  $('pause-overlay').classList.toggle('hidden', !state.paused);
});
$('sound-btn').addEventListener('click', () => {
  soundOn = !soundOn;
  $('sound-btn').textContent = soundOn ? 'Sound: ON' : 'Sound: OFF';
});

// Pause overlay
$('resume-btn').addEventListener('click', () => {
  state.paused = false;
  $('pause-btn').textContent = 'Pause';
  $('pause-overlay').classList.add('hidden');
});
$('restart-btn').addEventListener('click', () => {
  $('pause-overlay').classList.add('hidden');
  startGame();
});
$('pause-menu-btn').addEventListener('click', () => {
  clearTimers();
  $('pause-overlay').classList.add('hidden');
  showScreen('menu-screen');
});

// Game over overlay
$('play-again-btn').addEventListener('click', () => {
  $('gameover-overlay').classList.add('hidden');
  startGame();
});
$('over-menu-btn').addEventListener('click', () => {
  clearTimers();
  $('gameover-overlay').classList.add('hidden');
  showScreen('menu-screen');
});

// Leaderboard
$('lb-back-btn').addEventListener('click', () => showScreen('menu-screen'));
$('lb-clear-btn').addEventListener('click', () => {
  localStorage.removeItem('cr_lb');
  renderLeaderboard();
});

// Keyboard: P = pause, M = mute
document.addEventListener('keydown', e => {
  if (!$('game-screen').classList.contains('hidden')) {
    if (e.key === 'p' || e.key === 'P') $('pause-btn').click();
    if (e.key === 'm' || e.key === 'M') $('sound-btn').click();
  }
});

/* ════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════ */
showScreen('menu-screen');
