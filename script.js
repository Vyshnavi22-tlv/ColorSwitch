/* ============================================================
   Color Switch+  –  script.js
   ============================================================ */

// ── Tunable constants ─────────────────────────────────────────
const COLORS     = ['#00ffff', '#ffff00', '#ff69b4', '#bf5fff']; // original neon palette
const GRAVITY    = 0.20;    // gentle fall
const JUMP_FORCE = -8.0;    // soft jump
const MOVE_SPEED = 3.2;     // horizontal speed (px/frame)
const BASE_SPEED = 1.0;     // obstacle scroll speed at score 35
const SPEED_INC  = 0.06;    // speed added per point above 35
const MAX_SPEED  = 5.5;     // hard cap
const BALL_R     = 16;      // slightly larger ball
const SAFE_SCORE = 35;      // no obstacles below this score
const OBS_EVERY  = 190;     // frames between obstacle spawns
const COL_EVERY  = 80;      // frames between collectible spawns (safe phase)
const COLOR_MS   = 4000;    // ball color change interval
const MAX_LIVES  = 3;
const INV_FRAMES = 90;      // invincibility frames after a hit

// Rotation: negative = counter-clockwise (reversed from previous clockwise)
const ROT_BASE   = -0.007;  // starting rotation speed
const ROT_MAX    = -0.028;  // fastest rotation (still negative = CCW)

// ── Audio ─────────────────────────────────────────────────────
const _AC = window.AudioContext || window.webkitAudioContext;
let _ac;
function _initAC() { if (!_ac) _ac = new _AC(); }
function _tone(freq, type = 'sine', dur = 0.12, vol = 0.15) {
  if (!_ac) return;
  const o = _ac.createOscillator(), g = _ac.createGain();
  o.connect(g); g.connect(_ac.destination);
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, _ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, _ac.currentTime + dur);
  o.start(); o.stop(_ac.currentTime + dur);
}
const SFX = {
  jump:   () => _tone(520, 'sine', 0.10, 0.13),
  col:    () => { _tone(660, 'sine', 0.09, 0.15); setTimeout(() => _tone(880, 'sine', 0.09, 0.15), 80); },
  score:  () => _tone(800, 'sine', 0.12, 0.15),
  hit:    () => _tone(200, 'square', 0.18, 0.2),
  die:    () => { _tone(260, 'sawtooth', 0.22, 0.2); setTimeout(() => _tone(130, 'sawtooth', 0.28, 0.2), 180); },
};

// ── Helpers ───────────────────────────────────────────────────
function _shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Particle ──────────────────────────────────────────────────
class Particle {
  constructor(x, y, color) {
    this.x = x; this.y = y; this.color = color;
    const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3.5;
    this.vx = Math.cos(a) * s; this.vy = Math.sin(a) * s;
    this.life = 1; this.r = 3 + Math.random() * 3;
  }
  update() { this.x += this.vx; this.y += this.vy; this.vy += 0.09; this.life -= 0.026; }
  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = this.life;
    ctx.shadowBlur = 8; ctx.shadowColor = this.color;
    ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.r * this.life, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

// ── Collectible ───────────────────────────────────────────────
// types: 'star' (+1 score), 'heart' (+1 life), 'slow' (slow motion), 'score2' (double score)
const COLLECTIBLE_ICONS = { star: '⭐', heart: '❤️', slow: '🐢', score2: '✨' };
const COLLECTIBLE_COLORS = { star: '#ffff00', heart: '#ff4466', slow: '#00ffff', score2: '#bf5fff' };

class Collectible {
  constructor(x, y, type) {
    this.x = x; this.y = y; this.type = type;
    this.vy = 0.9; this.r = 15; this.angle = 0;
  }
  update() { this.y += this.vy; this.angle += 0.04; }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    const c = COLLECTIBLE_COLORS[this.type];
    ctx.shadowBlur = 16; ctx.shadowColor = c;
    ctx.strokeStyle = c; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, this.r, 0, Math.PI * 2); ctx.stroke();
    ctx.font = `${this.r + 2}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(COLLECTIBLE_ICONS[this.type], 0, 1);
    ctx.restore();
  }
  hits(ball) {
    const dx = ball.x - this.x, dy = ball.y - this.y;
    return Math.sqrt(dx * dx + dy * dy) < this.r + ball.r;
  }
  isOffScreen(h) { return this.y - this.r > h; }
}

// ── Ball ──────────────────────────────────────────────────────
class Ball {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = BALL_R;
    this.colorIdx = 0; this.color = COLORS[0];
    this.invFrames = 0;
    this.trail = [];
  }
  jump() { this.vy = JUMP_FORCE; SFX.jump(); }
  setColor(idx) { this.colorIdx = idx; this.color = COLORS[idx]; }
  update(W) {
    this.vy += GRAVITY;
    this.x += this.vx;
    this.y += this.vy;
    // wrap horizontally
    if (this.x < -this.r)  this.x = W + this.r;
    if (this.x > W + this.r) this.x = -this.r;
    if (this.invFrames > 0) this.invFrames--;
    // trail
    this.trail.push({ x: this.x, y: this.y, life: 1 });
    if (this.trail.length > 10) this.trail.shift();
    this.trail.forEach(t => t.life -= 0.09);
  }
  draw(ctx) {
    if (this.invFrames > 0 && Math.floor(this.invFrames / 6) % 2 === 0) return;
    // trail
    this.trail.forEach((t, i) => {
      ctx.save();
      ctx.globalAlpha = t.life * 0.35;
      ctx.fillStyle = this.color;
      ctx.beginPath(); ctx.arc(t.x, t.y, this.r * (i / this.trail.length) * 0.65, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
    ctx.save();
    ctx.shadowBlur = 22; ctx.shadowColor = this.color;
    ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

// ── Obstacle: Rotating Circle ─────────────────────────────────
class CircleObstacle {
  constructor(x, y, speed, rotSpeed) {
    this.x = x; this.y = y; this.speed = speed;
    this.radius = 62; this.thickness = 14; // thin ring = wide gap
    this.angle = Math.random() * Math.PI * 2;
    this.rotSpeed = rotSpeed;              // negative = CCW
    this.colorOrder = _shuffle([0, 1, 2, 3]);
    this.passed = false;
    this.frozenFrames = 120;              // 2 s stationary before rotating
  }
  update() {
    this.y += this.speed;
    if (this.frozenFrames > 0) { this.frozenFrames--; return; }
    this.angle += this.rotSpeed;
  }
  colorAt(px, py) {
    const dx = px - this.x, dy = py - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // forgiving: shrink hitbox by 4 px on each side
    if (dist < this.radius - this.thickness / 2 + 4 ||
        dist > this.radius + this.thickness / 2 - 4) return -1;
    let a = Math.atan2(dy, dx) - this.angle;
    a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return this.colorOrder[Math.floor(a / (Math.PI / 2))];
  }
  draw(ctx) {
    const seg = Math.PI / 2;
    this.colorOrder.forEach((ci, i) => {
      const start = this.angle + i * seg;
      ctx.save();
      ctx.shadowBlur = 18; ctx.shadowColor = COLORS[ci];
      ctx.strokeStyle = COLORS[ci];
      ctx.lineWidth = this.thickness;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, start, start + seg); ctx.stroke();
      ctx.restore();
    });
    // frozen pulse dot
    if (this.frozenFrames > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(Date.now() / 180);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(this.x, this.y - this.radius, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  isOffScreen(h) { return this.y - this.radius - this.thickness > h; }
}

// ── Game ──────────────────────────────────────────────────────
class Game {
  constructor() {
    this.canvas    = document.getElementById('gameCanvas');
    this.ctx       = this.canvas.getContext('2d');
    this.scoreEl   = document.getElementById('score');
    this.hiEl      = document.getElementById('high-score');
    this.overlay   = document.getElementById('overlay');
    this.oTitle    = document.getElementById('overlay-title');
    this.oSub      = document.getElementById('overlay-sub');
    this.oScore    = document.getElementById('overlay-score');
    this.oBtn      = document.getElementById('action-btn');
    this.pauseBtn  = document.getElementById('pause-btn');
    this.heartEls  = Array.from(document.querySelectorAll('.heart'));
    this.slowEl    = document.getElementById('slow-indicator');
    this.score2El  = document.getElementById('score2-indicator');
    this.btnLeft   = document.getElementById('btn-left');
    this.btnRight  = document.getElementById('btn-right');

    this.highScore = parseInt(localStorage.getItem('cs_hi') || '0');
    this.hiEl.textContent = `Best: ${this.highScore}`;
    this.state = 'idle';

    this._resize();
    this._bindEvents();
    this._showOverlay('Color Switch+', 'Tap to jump  ·  ◀▶ to move', '▶ Start', false);
    this._loop();
  }

  _resize() {
    const W = Math.min(420, window.innerWidth);
    const H = window.innerHeight;
    this.canvas.width = W; this.canvas.height = H;
    this.W = W; this.H = H;
  }

  _initRound() {
    this.ball         = new Ball(this.W / 2, this.H * 0.62);
    this.obstacles    = [];
    this.collectibles = [];
    this.particles    = [];
    this.score        = 0;
    this.frame        = 0;
    this.lives        = MAX_LIVES;
    this.speed        = BASE_SPEED;
    this.slowActive   = false;
    this.slowTimer    = 0;
    this.score2Active = false;
    this.score2Timer  = 0;
    this.keys         = { left: false, right: false };
    this.scoreEl.textContent = '0';
    this.slowEl.classList.remove('active');
    this.score2El.classList.remove('active');
    this._updateHeartsUI();
  }

  // ── Input ─────────────────────────────────────────────────
  _bindEvents() {
    const jump = () => {
      _initAC();
      if (this.state === 'playing') { this.ball.jump(); return; }
      if (this.state === 'idle' || this.state === 'dead') this._startGame();
    };

    this.canvas.addEventListener('click', jump);
    this.canvas.addEventListener('touchstart', e => { e.preventDefault(); jump(); }, { passive: false });

    // Keyboard
    document.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft'  || e.key === 'a') this.keys.left  = true;
      if (e.key === 'ArrowRight' || e.key === 'd') this.keys.right = true;
      if (e.key === ' ' || e.key === 'ArrowUp') jump();
      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') this._togglePause();
    });
    document.addEventListener('keyup', e => {
      if (e.key === 'ArrowLeft'  || e.key === 'a') this.keys.left  = false;
      if (e.key === 'ArrowRight' || e.key === 'd') this.keys.right = false;
    });

    // Touch move buttons
    const hold = (btn, dir) => {
      btn.addEventListener('touchstart', e => { e.preventDefault(); this.keys[dir] = true; }, { passive: false });
      btn.addEventListener('touchend',   e => { e.preventDefault(); this.keys[dir] = false; }, { passive: false });
      btn.addEventListener('mousedown',  () => this.keys[dir] = true);
      btn.addEventListener('mouseup',    () => this.keys[dir] = false);
    };
    hold(this.btnLeft,  'left');
    hold(this.btnRight, 'right');

    this.pauseBtn.addEventListener('click', () => this._togglePause());
    this.oBtn.addEventListener('click', () => {
      _initAC();
      if (this.state === 'idle' || this.state === 'dead') this._startGame();
      else if (this.state === 'paused') this._resume();
    });
    window.addEventListener('resize', () => this._resize());
  }

  _togglePause() {
    if (this.state === 'playing') this._pause();
    else if (this.state === 'paused') this._resume();
  }

  _startGame() {
    this._initRound();
    this.state = 'playing';
    this.overlay.classList.add('hidden');
    this.pauseBtn.classList.remove('hidden');
    this.btnLeft.classList.remove('hidden');
    this.btnRight.classList.remove('hidden');
    clearInterval(this._colorTimer);
    this._colorTimer = setInterval(() => {
      if (this.state !== 'playing') return;
      this.ball.setColor(Math.floor(Math.random() * COLORS.length));
    }, COLOR_MS);
  }

  _pause() {
    this.state = 'paused';
    this._showOverlay('Paused', '', '▶ Resume', false);
    this.pauseBtn.textContent = '▶';
  }

  _resume() {
    this.state = 'playing';
    this.overlay.classList.add('hidden');
    this.pauseBtn.textContent = '⏸';
  }

  // ── Lives ─────────────────────────────────────────────────
  _loseLife() {
    if (this.ball.invFrames > 0) return;
    this.lives--;
    this._updateHeartsUI();
    SFX.hit();
    document.body.classList.remove('shake');
    void document.body.offsetWidth;
    document.body.classList.add('shake');
    setTimeout(() => document.body.classList.remove('shake'), 350);

    if (this.lives <= 0) { this._die(); return; }
    this.ball.invFrames = INV_FRAMES;
    this.ball.vy = JUMP_FORCE * 0.55;
  }

  _die() {
    this.state = 'dead';
    clearInterval(this._colorTimer);
    SFX.die();
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem('cs_hi', this.highScore);
      this.hiEl.textContent = `Best: ${this.highScore}`;
    }
    this.pauseBtn.classList.add('hidden');
    this.btnLeft.classList.add('hidden');
    this.btnRight.classList.add('hidden');
    this._showOverlay('Game Over', `Score: ${this.score}  ·  Best: ${this.highScore}`, '↺ Restart', true);
  }

  _updateHeartsUI() {
    this.heartEls.forEach((el, i) => el.classList.toggle('lost', i >= this.lives));
  }

  _showOverlay(title, sub, btnText, showScore) {
    this.oTitle.textContent = title;
    this.oSub.textContent   = sub;
    this.oBtn.textContent   = btnText;
    this.oScore.classList.toggle('hidden', !showScore);
    this.overlay.classList.remove('hidden');
  }

  // ── Spawning ──────────────────────────────────────────────
  _spawnCollectible() {
    // safe phase: mostly stars, occasional heart/booster
    const roll = Math.random();
    let type;
    if (this.score < SAFE_SCORE) {
      type = roll < 0.55 ? 'star' : roll < 0.75 ? 'heart' : roll < 0.88 ? 'slow' : 'score2';
    } else {
      type = roll < 0.4 ? 'star' : roll < 0.6 ? 'heart' : roll < 0.8 ? 'slow' : 'score2';
    }
    const x = 28 + Math.random() * (this.W - 56);
    this.collectibles.push(new Collectible(x, -24, type));
  }

  _spawnObstacle() {
    const rotSpeed = Math.max(ROT_BASE - (this.score - SAFE_SCORE) * 0.0003, ROT_MAX);
    this.obstacles.push(new CircleObstacle(this.W / 2, -90, this.speed, rotSpeed));
  }

  // ── Collision ─────────────────────────────────────────────
  _checkCollision(obs) {
    for (let i = 0; i < 6; i++) {
      const a  = (i / 6) * Math.PI * 2;
      const px = this.ball.x + Math.cos(a) * (this.ball.r - 3);
      const py = this.ball.y + Math.sin(a) * (this.ball.r - 3);
      const ci = obs.colorAt(px, py);
      if (ci === -1) continue;
      if (ci !== this.ball.colorIdx) return true;
    }
    return false;
  }

  // ── Main Loop ─────────────────────────────────────────────
  _loop() {
    requestAnimationFrame(() => this._loop());
    if (this.state !== 'playing') {
      if (this.state !== 'idle') this._draw();
      return;
    }
    this._update();
    this._draw();
  }

  _update() {
    this.frame++;

    // Horizontal input
    this.ball.vx = this.keys.left ? -MOVE_SPEED : this.keys.right ? MOVE_SPEED : 0;

    // Speed (only after safe phase)
    if (this.score >= SAFE_SCORE)
      this.speed = Math.min(BASE_SPEED + (this.score - SAFE_SCORE) * SPEED_INC, MAX_SPEED);

    const effSpeed = this.slowActive ? this.speed * 0.4 : this.speed;

    this.ball.update(this.W);

    // Floor = lose life; ceiling = soft bounce
    if (this.ball.y + this.ball.r > this.H) { this._loseLife(); return; }
    if (this.ball.y - this.ball.r < 0) this.ball.vy = Math.abs(this.ball.vy) * 0.5;

    // ── Collectibles (always active) ──
    if (this.frame % COL_EVERY === 0) this._spawnCollectible();
    for (let i = this.collectibles.length - 1; i >= 0; i--) {
      const c = this.collectibles[i];
      c.vy = effSpeed * 1.2;
      c.update();
      if (c.hits(this.ball)) {
        this._applyCollectible(c.type);
        this._burst(c.x, c.y, COLLECTIBLE_COLORS[c.type]);
        this.collectibles.splice(i, 1);
      } else if (c.isOffScreen(this.H)) {
        this.collectibles.splice(i, 1);
      }
    }

    // ── Obstacles (only after safe phase) ──
    if (this.score >= SAFE_SCORE) {
      if (this.frame % OBS_EVERY === 0) this._spawnObstacle();
      for (let i = this.obstacles.length - 1; i >= 0; i--) {
        const obs = this.obstacles[i];
        obs.speed = effSpeed;
        obs.update();
        if (this.ball.invFrames === 0 && this._checkCollision(obs)) {
          this._loseLife(); return;
        }
        if (!obs.passed && this.ball.y > obs.y + obs.radius + obs.thickness) {
          obs.passed = true;
          const pts = this.score2Active ? 2 : 1;
          this.score += pts;
          this.scoreEl.textContent = this.score;
          SFX.score();
          this._burst(this.ball.x, this.ball.y, this.ball.color);
        }
        if (obs.isOffScreen(this.H)) this.obstacles.splice(i, 1);
      }
    }

    // ── Particles ──
    for (let i = this.particles.length - 1; i >= 0; i--) {
      this.particles[i].update();
      if (this.particles[i].life <= 0) this.particles.splice(i, 1);
    }

    // ── Power-up timers ──
    if (this.slowActive   && --this.slowTimer   <= 0) { this.slowActive   = false; this.slowEl.classList.remove('active'); }
    if (this.score2Active && --this.score2Timer <= 0) { this.score2Active = false; this.score2El.classList.remove('active'); }
  }

  _applyCollectible(type) {
    SFX.col();
    if (type === 'star') {
      this.score++;
      this.scoreEl.textContent = this.score;
    } else if (type === 'heart') {
      if (this.lives < MAX_LIVES) { this.lives++; this._updateHeartsUI(); }
    } else if (type === 'slow') {
      this.slowActive = true; this.slowTimer = 300;
      this.slowEl.classList.add('active');
    } else if (type === 'score2') {
      this.score2Active = true; this.score2Timer = 300;
      this.score2El.classList.add('active');
    }
  }

  _burst(x, y, color) {
    for (let i = 0; i < 14; i++) this.particles.push(new Particle(x, y, color));
  }

  // ── Draw ──────────────────────────────────────────────────
  _draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // Subtle grid
    ctx.save();
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.restore();

    this.collectibles.forEach(c => c.draw(ctx));
    this.obstacles.forEach(o => o.draw(ctx));
    this.particles.forEach(p => p.draw(ctx));
    this.ball.draw(ctx);

    // Safe-phase progress bar
    if (this.score < SAFE_SCORE) {
      const pct = this.score / SAFE_SCORE;
      ctx.save();
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, H - 5, W, 5);
      ctx.fillStyle = '#0ff';
      ctx.shadowBlur = 8; ctx.shadowColor = '#0ff';
      ctx.fillRect(0, H - 5, W * pct, 5);
      ctx.restore();

      // Guide arrow above ball
      this._drawArrow();
    }
  }

  _drawArrow() {
    const { ctx, ball } = this;
    const bob = Math.sin(Date.now() / 280) * 5;
    ctx.save();
    ctx.translate(ball.x, ball.y - ball.r - 26 + bob);
    ctx.fillStyle = '#0ff';
    ctx.shadowBlur = 10; ctx.shadowColor = '#0ff';
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(9, 0); ctx.lineTo(4, 0);
    ctx.lineTo(4, 11);  ctx.lineTo(-4, 11); ctx.lineTo(-4, 0);
    ctx.lineTo(-9, 0);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

// ── Boot ──────────────────────────────────────────────────────
window.addEventListener('load', () => new Game());
