/**
 * VirtualClubDancers - Overlay Renderer
 * Canvas2D rendering engine for South-Park style animated avatars
 * Runs in Electron transparent BrowserWindow for OBS overlay
 * 
 * CRITICAL: This is a TRANSPARENT overlay. NO background elements.
 * ONLY avatars are rendered on a fully transparent canvas.
 */

const canvas = document.getElementById('overlay-canvas');
const ctx = canvas.getContext('2d');

// ── Configuration ──────────────────────────────────────────────────────────
const CONFIG = {
  moveZoneYMin: 0.55,
  moveZoneYMax: 0.90,
  moveZoneXMin: 0.05,
  moveZoneXMax: 0.95,
  maxAvatars: 50,
  inactivityTimeout: 120000, // 2 minutes
  idleSwitchInterval: [5000, 15000], // 5-15 seconds
  fps: 60,
  avatarBaseHeight: 80,
  avatarBaseWidth: 50,
  perspectiveScaleMin: 0.7,
  perspectiveScaleMax: 1.0,
  spawnY: 0.57,
  bpm: 120
};

// ── Animation Data ─────────────────────────────────────────────────────────
let ANIMATIONS = {};
let currentBPM = 120;
let beatPhase = 0;

// ── Avatar Storage ─────────────────────────────────────────────────────────
const avatars = new Map(); // username -> Avatar

// ── Particles (for confetti etc.) ─────────────────────────────────────────
const particles = [];

// ── Canvas Setup ───────────────────────────────────────────────────────────
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ── Utility Functions ──────────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function randRange(min, max) { return min + Math.random() * (max - min); }
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

// ── Color Palette for Avatars ──────────────────────────────────────────────
const SKIN_TONES = ['#FFDBAC', '#F1C27D', '#E0AC69', '#C68642', '#8D5524'];
const SHIRT_COLORS = [
  '#E53935', '#1E88E5', '#43A047', '#FDD835', '#8E24AA',
  '#FB8C00', '#00ACC1', '#F4511E', '#5E35B1', '#00897B'
];
const PANTS_COLORS = ['#1A237E', '#1565C0', '#0D47A1', '#212121', '#3E2723', '#4E342E', '#37474F'];
const HAIR_COLORS = ['#3E2723', '#5D4037', '#212121', '#F9A825', '#D84315', '#4E342E'];

function getAvatarColors(username) {
  const h = hashString(username);
  return {
    skin: SKIN_TONES[h % SKIN_TONES.length],
    shirt: SHIRT_COLORS[(h >> 4) % SHIRT_COLORS.length],
    pants: PANTS_COLORS[(h >> 8) % PANTS_COLORS.length],
    hair: HAIR_COLORS[(h >> 12) % HAIR_COLORS.length]
  };
}

// ── Avatar Class ───────────────────────────────────────────────────────────
class Avatar {
  constructor(username, canvasWidth, canvasHeight, customColors) {
    this.username = username;
    this.colors = customColors || getAvatarColors(username);

    // Position (normalized 0-1)
    const side = Math.random() > 0.5 ? 0.9 : 0.1;
    this.x = side;
    this.y = CONFIG.spawnY + randRange(-0.02, 0.05);
    this.targetX = this.x;
    this.targetY = this.y;

    // Direction: 1 = right, -1 = left
    this.facing = side > 0.5 ? -1 : 1;

    // Animation state
    this.currentEmote = null;
    this.emoteFrame = 0;
    this.emoteFrameTime = 0;
    this.emoteSpeed = 24;
    this.emoteStartTime = 0;
    this.emoteLoopsCompleted = 0;
    this.maxLoops = 0; // 0 = infinite

    // Idle state
    this.idleState = 'walking';
    this.idleTimer = 0;
    this.idleSwitchAt = randRange(CONFIG.idleSwitchInterval[0], CONFIG.idleSwitchInterval[1]);
    this.walkCycle = 0;
    this.bopPhase = 0;
    this.lookPhase = 0;

    // Skeleton joint angles (radians)
    this.joints = {
      head: 0,
      torso: 0,
      leftUpperArm: 0.3,
      leftLowerArm: 0,
      rightUpperArm: -0.3,
      rightLowerArm: 0,
      leftUpperLeg: 0,
      leftLowerLeg: 0,
      rightUpperLeg: 0,
      rightLowerLeg: 0
    };

    // Target joints for smooth interpolation
    this.targetJoints = { ...this.joints };

    // Visual
    this.opacity = 0;
    this.fadeIn = true;
    this.fadeOut = false;
    this.scale = 1.0;
    this.verticalOffset = 0; // For jumps

    // Interaction
    this.interacting = false;
    this.interactionPartner = null;
    this.propType = null; // 'drink', 'eat', 'confetti'

    // Inactivity
    this.lastActivity = Date.now();

    // Accessory (hash-based)
    const h = hashString(username);
    this.accessory = this.getAccessoryType(h);

    // Canvas dimensions
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
  }

  getAccessoryType(hash) {
    const types = ['none', 'headphones', 'cap', 'beanie', 'sunglasses', 'mohawk', 'tophat'];
    return types[(hash >> 16) % types.length];
  }

  getPerspectiveScale() {
    const yNorm = (this.y - CONFIG.moveZoneYMin) / (CONFIG.moveZoneYMax - CONFIG.moveZoneYMin);
    return lerp(CONFIG.perspectiveScaleMin, CONFIG.perspectiveScaleMax, clamp(yNorm, 0, 1));
  }

  getPixelPosition() {
    return {
      x: this.x * this.canvasWidth,
      y: this.y * this.canvasHeight + this.verticalOffset
    };
  }

  setEmote(emoteName) {
    // Handle command aliases
    const aliases = {
      'winken': 'winken', 'wave': 'winken',
      'lachen': 'lachen', 'laugh': 'lachen',
      'dance': 'disco',
      'wave_emote': 'winken'
    };
    const resolvedName = aliases[emoteName] || emoteName;
    
    if (ANIMATIONS[resolvedName]) {
      this.currentEmote = resolvedName;
      this.emoteFrame = 0;
      this.emoteFrameTime = 0;
      this.emoteStartTime = performance.now();
      this.emoteLoopsCompleted = 0;
      this.lastActivity = Date.now();

      const anim = ANIMATIONS[resolvedName];
      this.emoteSpeed = anim.fps || 24;

      // Set max loops for social emotes (most are one-shot or loop 3x)
      if (anim.category === 'social') {
        if (anim.loop) {
          this.maxLoops = 0; // Loop until stopped
        } else {
          this.maxLoops = 1; // One-shot
        }
      } else {
        this.maxLoops = 0; // Dance emotes loop infinitely
      }

      // Set props for certain emotes
      this.propType = null;
      if (['drink', 'eat', 'cheer'].includes(resolvedName)) {
        this.propType = resolvedName;
      }

      return true;
    }
    return false;
  }

  clearEmote() {
    this.currentEmote = null;
    this.emoteFrame = 0;
    this.propType = null;
    this.idleState = 'walking';
  }

  update(dt, beatInfo) {
    // Fade in/out
    if (this.fadeIn) {
      this.opacity = Math.min(1, this.opacity + dt * 2);
      if (this.opacity >= 1) this.fadeIn = false;
    }
    if (this.fadeOut) {
      this.opacity = Math.max(0, this.opacity - dt * 0.5);
      return this.opacity <= 0;
    }

    // Scale
    this.scale = this.getPerspectiveScale();

    // Active emote animation
    if (this.currentEmote) {
      this.updateEmoteAnimation(dt);
    } else {
      this.updateIdle(dt, beatInfo);
    }

    // Movement (only in idle walking state)
    if (!this.currentEmote && this.idleState === 'walking') {
      this.updateMovement(dt);
    }

    // Smooth joint interpolation
    for (const joint in this.joints) {
      this.joints[joint] = lerp(this.joints[joint], this.targetJoints[joint], 0.25);
    }

    return false;
  }

  updateEmoteAnimation(dt) {
    const anim = ANIMATIONS[this.currentEmote];
    if (!anim) return;

    this.emoteFrameTime += dt;
    const frameDuration = 1 / this.emoteSpeed;

    if (this.emoteFrameTime >= frameDuration) {
      this.emoteFrameTime -= frameDuration;
      this.emoteFrame++;

      if (this.emoteFrame >= anim.frames.length) {
        this.emoteLoopsCompleted++;
        
        if (!anim.loop || (this.maxLoops > 0 && this.emoteLoopsCompleted >= this.maxLoops)) {
          // One-shot emote done, return to idle
          this.clearEmote();
          return;
        }
        this.emoteFrame = 0;
      }
    }

    // Apply frame joints directly as target
    const frame = anim.frames[this.emoteFrame];
    if (frame) {
      for (const joint in frame) {
        if (this.targetJoints.hasOwnProperty(joint)) {
          this.targetJoints[joint] = frame[joint];
        }
      }
    }

    // Special vertical offset for jumps
    if (['jump', 'bounce', 'beatbounce', 'drop', 'bassdrop'].includes(this.currentEmote)) {
      const jumpAnim = Math.abs(this.targetJoints.leftUpperLeg) + Math.abs(this.targetJoints.rightUpperLeg);
      this.verticalOffset = -jumpAnim * 15 * this.scale;
    } else {
      this.verticalOffset = lerp(this.verticalOffset, 0, 0.1);
    }
  }

  updateIdle(dt, beatInfo) {
    this.idleTimer += dt * 1000;

    if (this.idleTimer >= this.idleSwitchAt) {
      this.idleTimer = 0;
      this.idleSwitchAt = randRange(CONFIG.idleSwitchInterval[0], CONFIG.idleSwitchInterval[1]);
      const states = ['walking', 'bopping', 'looking'];
      if (beatInfo && beatInfo.active) {
        this.idleState = states[Math.random() < 0.6 ? 1 : Math.floor(Math.random() * 3)];
      } else {
        this.idleState = states[Math.floor(Math.random() * 3)];
      }
    }

    switch (this.idleState) {
      case 'walking': this.updateWalkAnimation(dt, beatInfo); break;
      case 'bopping': this.updateBopAnimation(dt, beatInfo); break;
      case 'looking': this.updateLookAnimation(dt); break;
    }
  }

  updateWalkAnimation(dt, beatInfo) {
    const speed = (beatInfo && beatInfo.bpm) ? beatInfo.bpm / 120 : 1;
    this.walkCycle += dt * 4 * speed;

    const t = this.walkCycle;
    this.targetJoints.leftUpperLeg = Math.sin(t) * 0.4;
    this.targetJoints.leftLowerLeg = Math.max(0, Math.sin(t) * 0.3);
    this.targetJoints.rightUpperLeg = Math.sin(t + Math.PI) * 0.4;
    this.targetJoints.rightLowerLeg = Math.max(0, Math.sin(t + Math.PI) * 0.3);
    this.targetJoints.leftUpperArm = Math.sin(t + Math.PI) * 0.3;
    this.targetJoints.rightUpperArm = Math.sin(t) * 0.3;
    this.targetJoints.torso = Math.sin(t * 0.5) * 0.02;
    this.targetJoints.head = Math.sin(t * 0.5) * 0.03;
  }

  updateBopAnimation(dt, beatInfo) {
    const speed = (beatInfo && beatInfo.bpm) ? beatInfo.bpm / 120 : 1;
    this.bopPhase += dt * 4 * speed;

    const t = this.bopPhase;
    this.targetJoints.torso = Math.sin(t) * 0.08;
    this.targetJoints.head = Math.sin(t * 2) * 0.12;
    this.targetJoints.leftUpperArm = -0.2 + Math.sin(t) * 0.15;
    this.targetJoints.rightUpperArm = 0.2 + Math.sin(t + Math.PI) * 0.15;
    this.targetJoints.leftLowerArm = Math.sin(t + 1) * 0.1;
    this.targetJoints.rightLowerArm = Math.sin(t + 1 + Math.PI) * 0.1;
    this.targetJoints.leftUpperLeg = 0;
    this.targetJoints.leftLowerLeg = 0;
    this.targetJoints.rightUpperLeg = 0;
    this.targetJoints.rightLowerLeg = 0;
  }

  updateLookAnimation(dt) {
    this.lookPhase += dt * 1.5;
    const t = this.lookPhase;
    this.targetJoints.head = Math.sin(t) * 0.35;
    this.targetJoints.torso = Math.sin(t * 0.5) * 0.05;
    this.targetJoints.leftUpperArm = -0.15;
    this.targetJoints.rightUpperArm = 0.15;
    this.targetJoints.leftLowerArm = 0;
    this.targetJoints.rightLowerArm = 0;
    this.targetJoints.leftUpperLeg = 0;
    this.targetJoints.leftLowerLeg = 0;
    this.targetJoints.rightUpperLeg = 0;
    this.targetJoints.rightLowerLeg = 0;
  }

  updateMovement(dt) {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.02) {
      this.targetX = randRange(CONFIG.moveZoneXMin, CONFIG.moveZoneXMax);
      this.targetY = randRange(CONFIG.moveZoneYMin, CONFIG.moveZoneYMax);
      this.facing = this.targetX > this.x ? 1 : -1;
    } else {
      const speed = 0.03 * dt;
      this.x += (dx / dist) * speed;
      this.y += (dy / dist) * speed;
      this.x = clamp(this.x, CONFIG.moveZoneXMin, CONFIG.moveZoneXMax);
      this.y = clamp(this.y, CONFIG.moveZoneYMin, CONFIG.moveZoneYMax);
      this.facing = dx > 0 ? 1 : -1;
    }
  }

  // ── Drawing ─────────────────────────────────────────────────────────────
  draw(ctx) {
    const pos = this.getPixelPosition();
    const s = this.scale;
    const w = CONFIG.avatarBaseWidth * s;
    const h = CONFIG.avatarBaseHeight * s;

    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.translate(pos.x, pos.y);
    ctx.scale(this.facing, 1);

    // Draw shadow (subtle, transparent)
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(0, h * 0.48 - this.verticalOffset * 0.3, w * 0.35, h * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();

    // Draw avatar parts from back to front
    this.drawLegs(ctx, s);
    this.drawBody(ctx, s);
    this.drawArms(ctx, s);
    this.drawHead(ctx, s);
    
    // Draw prop if active
    if (this.propType) {
      this.drawProp(ctx, s);
    }

    ctx.restore();

    // Draw username above avatar
    this.drawUsername(ctx, pos.x, pos.y - h * 0.6 + this.verticalOffset, s);
  }

  drawBody(ctx, s) {
    const w = CONFIG.avatarBaseWidth * s;
    const h = CONFIG.avatarBaseHeight * s;

    ctx.save();
    ctx.translate(0, -h * 0.25);
    ctx.rotate(this.joints.torso);

    // Torso (shirt)
    ctx.fillStyle = this.colors.shirt;
    const torsoW = w * 0.55;
    const torsoH = h * 0.32;
    ctx.beginPath();
    ctx.roundRect(-torsoW / 2, -torsoH / 2, torsoW, torsoH, 4 * s);
    ctx.fill();
    ctx.strokeStyle = this.darkenColor(this.colors.shirt, 0.25);
    ctx.lineWidth = 1.5 * s;
    ctx.stroke();

    // Collar detail
    ctx.fillStyle = this.darkenColor(this.colors.shirt, 0.15);
    ctx.beginPath();
    ctx.roundRect(-torsoW * 0.25, -torsoH / 2, torsoW * 0.5, torsoH * 0.1, 2 * s);
    ctx.fill();

    ctx.restore();
  }

  drawHead(ctx, s) {
    const w = CONFIG.avatarBaseWidth * s;
    const h = CONFIG.avatarBaseHeight * s;
    const headR = w * 0.35;

    ctx.save();
    ctx.translate(0, -h * 0.55);
    ctx.rotate(this.joints.head);

    // Head circle
    ctx.fillStyle = this.colors.skin;
    ctx.beginPath();
    ctx.arc(0, 0, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = this.darkenColor(this.colors.skin, 0.3);
    ctx.lineWidth = 1.5 * s;
    ctx.stroke();

    // Hair
    this.drawHair(ctx, headR, s);

    // Eyes
    const eyeY = -headR * 0.05;
    const eyeX = headR * 0.25;
    const eyeR = headR * 0.12;

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(-eyeX, eyeY, eyeR * 1.4, eyeR * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(eyeX, eyeY, eyeR * 1.4, eyeR * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();

    // Pupils
    ctx.fillStyle = '#1A1A1A';
    ctx.beginPath();
    ctx.arc(-eyeX + eyeR * 0.3, eyeY, eyeR * 0.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(eyeX + eyeR * 0.3, eyeY, eyeR * 0.65, 0, Math.PI * 2);
    ctx.fill();

    // Pupil highlights
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(-eyeX + eyeR * 0.1, eyeY - eyeR * 0.3, eyeR * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(eyeX + eyeR * 0.1, eyeY - eyeR * 0.3, eyeR * 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Mouth
    ctx.strokeStyle = this.darkenColor(this.colors.skin, 0.45);
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.arc(0, headR * 0.25, headR * 0.2, 0.15, Math.PI - 0.15);
    ctx.stroke();

    // Accessory
    this.drawAccessory(ctx, headR, s);

    ctx.restore();
  }

  drawHair(ctx, headR, s) {
    ctx.fillStyle = this.colors.hair;
    ctx.beginPath();
    ctx.ellipse(0, -headR * 0.7, headR * 1.05, headR * 0.5, 0, Math.PI, 0);
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(-headR * 0.85, -headR * 0.1, headR * 0.25, headR * 0.5, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(headR * 0.85, -headR * 0.1, headR * 0.25, headR * 0.5, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  drawAccessory(ctx, headR, s) {
    switch (this.accessory) {
      case 'headphones':
        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 3 * s;
        ctx.beginPath();
        ctx.arc(0, -headR * 0.1, headR * 1.1, Math.PI + 0.3, -0.3);
        ctx.stroke();
        ctx.fillStyle = '#444444';
        ctx.fillRect(-headR * 1.2, -headR * 0.2, headR * 0.3, headR * 0.5);
        ctx.fillRect(headR * 0.9, -headR * 0.2, headR * 0.3, headR * 0.5);
        break;
      case 'cap':
        ctx.fillStyle = '#1565C0';
        ctx.beginPath();
        ctx.ellipse(0, -headR * 0.75, headR * 1.15, headR * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(headR * 0.3, -headR * 0.6, headR * 0.7, headR * 0.12, -0.1, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'beanie':
        ctx.fillStyle = '#BF360C';
        ctx.beginPath();
        ctx.ellipse(0, -headR * 0.6, headR * 1.0, headR * 0.55, 0, Math.PI, 0);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, -headR * 1.1, headR * 0.15, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'sunglasses':
        ctx.fillStyle = '#1A1A1A';
        ctx.beginPath();
        ctx.roundRect(-headR * 0.6, -headR * 0.15, headR * 0.45, headR * 0.3, headR * 0.08);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(headR * 0.15, -headR * 0.15, headR * 0.45, headR * 0.3, headR * 0.08);
        ctx.fill();
        ctx.strokeStyle = '#1A1A1A';
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.moveTo(-headR * 0.15, -headR * 0.02);
        ctx.lineTo(headR * 0.15, -headR * 0.02);
        ctx.stroke();
        break;
      case 'mohawk':
        ctx.fillStyle = this.colors.hair;
        for (let i = 0; i < 7; i++) {
          const spikeX = -headR * 0.35 + i * headR * 0.1;
          const spikeH = headR * (0.5 + Math.sin(i * 0.8) * 0.3);
          ctx.beginPath();
          ctx.moveTo(spikeX, -headR * 0.8);
          ctx.lineTo(spikeX + headR * 0.08, -headR * 0.8 - spikeH);
          ctx.lineTo(spikeX + headR * 0.16, -headR * 0.8);
          ctx.fill();
        }
        break;
      case 'tophat':
        ctx.fillStyle = '#212121';
        ctx.beginPath();
        ctx.ellipse(0, -headR * 0.75, headR * 1.2, headR * 0.15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(-headR * 0.55, -headR * 1.6, headR * 1.1, headR * 0.85);
        ctx.beginPath();
        ctx.ellipse(0, -headR * 1.6, headR * 0.55, headR * 0.12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#F44336';
        ctx.fillRect(-headR * 0.55, -headR * 0.9, headR * 1.1, headR * 0.12);
        break;
    }
  }

  drawArms(ctx, s) {
    const w = CONFIG.avatarBaseWidth * s;
    const h = CONFIG.avatarBaseHeight * s;

    // Left arm
    this.drawLimb(ctx, s,
      -w * 0.28, -h * 0.38,
      this.joints.leftUpperArm, this.joints.leftLowerArm,
      w * 0.14, h * 0.18,
      w * 0.12, h * 0.16,
      this.colors.shirt, this.colors.skin
    );

    // Right arm
    this.drawLimb(ctx, s,
      w * 0.28, -h * 0.38,
      this.joints.rightUpperArm, this.joints.rightLowerArm,
      w * 0.14, h * 0.18,
      w * 0.12, h * 0.16,
      this.colors.shirt, this.colors.skin
    );
  }

  drawLegs(ctx, s) {
    const w = CONFIG.avatarBaseWidth * s;
    const h = CONFIG.avatarBaseHeight * s;

    // Left leg
    this.drawLimb(ctx, s,
      -w * 0.12, -h * 0.1,
      this.joints.leftUpperLeg, this.joints.leftLowerLeg,
      w * 0.16, h * 0.2,
      w * 0.14, h * 0.18,
      this.colors.pants, this.colors.pants
    );

    // Right leg
    this.drawLimb(ctx, s,
      w * 0.12, -h * 0.1,
      this.joints.rightUpperLeg, this.joints.rightLowerLeg,
      w * 0.16, h * 0.2,
      w * 0.14, h * 0.18,
      this.colors.pants, this.colors.pants
    );

    // Shoes
    this.drawShoe(ctx, s, -w * 0.12, h * 0.08 + this.joints.leftLowerLeg * h * 0.15);
    this.drawShoe(ctx, s, w * 0.12, h * 0.08 + this.joints.rightLowerLeg * h * 0.15);
  }

  drawLimb(ctx, s, ox, oy, upperAngle, lowerAngle, upperW, upperH, lowerW, lowerH, upperColor, lowerColor) {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(upperAngle);

    ctx.fillStyle = upperColor;
    ctx.beginPath();
    ctx.roundRect(-upperW / 2, 0, upperW, upperH, 3 * s);
    ctx.fill();
    ctx.strokeStyle = this.darkenColor(upperColor, 0.2);
    ctx.lineWidth = 1 * s;
    ctx.stroke();

    ctx.translate(0, upperH);
    ctx.rotate(lowerAngle);

    ctx.fillStyle = lowerColor;
    ctx.beginPath();
    ctx.roundRect(-lowerW / 2, 0, lowerW, lowerH, 3 * s);
    ctx.fill();
    ctx.strokeStyle = this.darkenColor(lowerColor, 0.2);
    ctx.lineWidth = 1 * s;
    ctx.stroke();

    ctx.restore();
  }

  drawShoe(ctx, s, x, y) {
    ctx.fillStyle = '#212121';
    ctx.beginPath();
    ctx.ellipse(x, y + 5 * s, 7 * s, 4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawProp(ctx, s) {
    const w = CONFIG.avatarBaseWidth * s;
    const h = CONFIG.avatarBaseHeight * s;
    
    // Position prop near the active hand
    const handX = -w * 0.28;
    const handY = -h * 0.38 + h * 0.34;

    ctx.save();
    ctx.translate(handX, handY);

    switch (this.propType) {
      case 'drink':
        // Glass
        ctx.fillStyle = 'rgba(200,230,255,0.6)';
        ctx.beginPath();
        ctx.moveTo(-6 * s, -15 * s);
        ctx.lineTo(-5 * s, 0);
        ctx.lineTo(5 * s, 0);
        ctx.lineTo(6 * s, -15 * s);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#88CCFF';
        ctx.lineWidth = 1 * s;
        ctx.stroke();
        // Liquid
        ctx.fillStyle = 'rgba(255,100,50,0.5)';
        ctx.beginPath();
        ctx.moveTo(-5 * s, -8 * s);
        ctx.lineTo(-4 * s, 0);
        ctx.lineTo(4 * s, 0);
        ctx.lineTo(5 * s, -8 * s);
        ctx.closePath();
        ctx.fill();
        break;

      case 'eat':
        // Burger
        ctx.fillStyle = '#D4A03C';
        ctx.beginPath();
        ctx.ellipse(0, -5 * s, 10 * s, 5 * s, 0, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = '#5D3A1A';
        ctx.fillRect(-9 * s, -5 * s, 18 * s, 5 * s);
        ctx.fillStyle = '#4CAF50';
        ctx.fillRect(-10 * s, -2 * s, 20 * s, 2 * s);
        ctx.fillStyle = '#D4A03C';
        ctx.fillRect(-9 * s, 0, 18 * s, 3 * s);
        break;

      case 'cheer':
        // Champagne glass
        ctx.fillStyle = 'rgba(255,230,200,0.6)';
        ctx.beginPath();
        ctx.ellipse(0, -12 * s, 8 * s, 4 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#DDCCBB';
        ctx.lineWidth = 1.5 * s;
        ctx.stroke();
        // Stem
        ctx.strokeStyle = '#BBBBBB';
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.moveTo(0, -8 * s);
        ctx.lineTo(0, 2 * s);
        ctx.stroke();
        // Base
        ctx.beginPath();
        ctx.ellipse(0, 3 * s, 6 * s, 2 * s, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
    }

    ctx.restore();
  }

  drawUsername(ctx, x, y, s) {
    ctx.save();
    ctx.globalAlpha = this.opacity * 0.85;
    const fontSize = Math.round(11 * s);
    ctx.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3 * s;
    ctx.strokeText(this.username, x, y);
    ctx.fillText(this.username, x, y);
    ctx.restore();
  }

  darkenColor(hex, amount) {
    if (!hex || !hex.startsWith('#')) return hex;
    try {
      const r = Math.max(0, parseInt(hex.slice(1, 3), 16) * (1 - amount));
      const g = Math.max(0, parseInt(hex.slice(3, 5), 16) * (1 - amount));
      const b = Math.max(0, parseInt(hex.slice(5, 7), 16) * (1 - amount));
      return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
    } catch (e) {
      return hex;
    }
  }
}

// ── Particle System (for confetti) ────────────────────────────────────────
class Particle {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 200;
    this.vy = -Math.random() * 200 - 50;
    this.gravity = 300;
    this.life = 1.0;
    this.decay = 0.3 + Math.random() * 0.4;
    this.size = 3 + Math.random() * 4;
    this.rotation = Math.random() * Math.PI * 2;
    this.rotSpeed = (Math.random() - 0.5) * 10;
    const colors = ['#F44336', '#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#FFEB3B'];
    this.color = colors[Math.floor(Math.random() * colors.length)];
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += this.gravity * dt;
    this.rotation += this.rotSpeed * dt;
    this.life -= this.decay * dt;
    return this.life > 0;
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = this.life;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.fillStyle = this.color;
    ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size * 0.6);
    ctx.restore();
  }
}

function spawnConfetti(px, py, count) {
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(px, py));
  }
}

// ── Main Render Loop ───────────────────────────────────────────────────────
let lastTime = performance.now();

function gameLoop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  // CLEAR CANVAS - TRANSPARENT! No background, no lights, no equalizer, nothing!
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Beat phase tracking
  const beatInterval = 60 / currentBPM;
  const timeSinceBeat = (now / 1000) % beatInterval;
  beatPhase = timeSinceBeat / beatInterval;
  const beatInfo = {
    active: timeSinceBeat < 0.1,
    bpm: currentBPM,
    phase: beatPhase
  };

  // Sort avatars by Y position (painter's algorithm)
  const sortedAvatars = [...avatars.values()].sort((a, b) => a.y - b.y);

  // Update and draw avatars
  const toRemove = [];
  for (const avatar of sortedAvatars) {
    const shouldRemove = avatar.update(dt, beatInfo);
    if (shouldRemove) {
      toRemove.push(avatar.username);
    } else {
      avatar.draw(ctx);
    }
  }

  // Update and draw particles
  for (let i = particles.length - 1; i >= 0; i--) {
    if (!particles[i].update(dt)) {
      particles.splice(i, 1);
    } else {
      particles[i].draw(ctx);
    }
  }

  // Remove faded-out avatars
  for (const name of toRemove) {
    avatars.delete(name);
  }

  // Check inactivity timeouts
  const now2 = Date.now();
  for (const [name, avatar] of avatars) {
    if (now2 - avatar.lastActivity > CONFIG.inactivityTimeout && !avatar.fadeOut) {
      avatar.fadeOut = true;
    }
  }

  requestAnimationFrame(gameLoop);
}

// ── Command Handler (from main process) ────────────────────────────────────
window.vcdOverlay.onCommand((data) => {
  switch (data.type) {
    case 'spawnAvatar':
      addAvatar(data.username, data.colors);
      break;
    case 'removeAvatar':
      removeAvatar(data.username);
      break;
    case 'setEmote':
      setAvatarEmote(data.username, data.emote);
      break;
    case 'resetInactivity':
      resetAvatarInactivity(data.username);
      break;
    case 'configUpdate':
      if (data.config) {
        if (data.config.moveZoneYMin !== undefined) CONFIG.moveZoneYMin = data.config.moveZoneYMin;
        if (data.config.moveZoneYMax !== undefined) CONFIG.moveZoneYMax = data.config.moveZoneYMax;
        if (data.config.maxAvatars !== undefined) CONFIG.maxAvatars = data.config.maxAvatars;
        if (data.config.inactivityTimeout !== undefined) CONFIG.inactivityTimeout = data.config.inactivityTimeout;
      }
      break;
    case 'twitchConnected':
      console.log('[Overlay] Twitch connected to:', data.channel);
      break;
    case 'beat':
      currentBPM = data.bpm || currentBPM;
      break;
    case 'bpmUpdate':
      currentBPM = data.bpm;
      break;
    case 'partyMode':
      handlePartyMode(data.mode, data.emote);
      break;
    case 'spawnConfetti':
      spawnConfetti(data.x || canvas.width / 2, data.y || canvas.height / 2, data.count || 30);
      break;
  }
});

function handlePartyMode(mode, emote) {
  switch (mode) {
    case 'party':
      // All avatars dance random
      for (const avatar of avatars.values()) {
        const dances = Object.keys(ANIMATIONS).filter(k => ANIMATIONS[k].category !== 'social');
        avatar.setEmote(dances[Math.floor(Math.random() * dances.length)]);
      }
      break;
    case 'freeze':
      // All avatars stop
      for (const avatar of avatars.values()) {
        avatar.clearEmote();
      }
      break;
    case 'confetti':
      // Confetti rain
      for (let i = 0; i < 5; i++) {
        spawnConfetti(
          randRange(canvas.width * 0.1, canvas.width * 0.9),
          randRange(canvas.height * 0.1, canvas.height * 0.3),
          20
        );
      }
      break;
    case 'forceEmote':
      if (emote) {
        for (const avatar of avatars.values()) {
          avatar.setEmote(emote);
        }
      }
      break;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────
function addAvatar(username, customColors) {
  if (avatars.has(username)) {
    // Already exists, just reset inactivity
    resetAvatarInactivity(username);
    return false;
  }
  if (avatars.size >= CONFIG.maxAvatars) {
    // Remove oldest inactive
    let oldest = null;
    for (const [name, av] of avatars) {
      if (!oldest || av.lastActivity < oldest.lastActivity) {
        oldest = { name, avatar: av };
      }
    }
    if (oldest) {
      oldest.avatar.fadeOut = true;
    }
  }
  const avatar = new Avatar(username, canvas.width, canvas.height, customColors);
  avatars.set(username, avatar);
  return true;
}

function removeAvatar(username) {
  const avatar = avatars.get(username);
  if (avatar) {
    avatar.fadeOut = true;
    return true;
  }
  return false;
}

function setAvatarEmote(username, emoteName) {
  const avatar = avatars.get(username);
  if (avatar) {
    // Spawn confetti particles for confetti emote
    if (emoteName === 'confetti') {
      const pos = avatar.getPixelPosition();
      spawnConfetti(pos.x, pos.y - 30, 25);
    }
    return avatar.setEmote(emoteName);
  }
  return false;
}

function resetAvatarInactivity(username) {
  const avatar = avatars.get(username);
  if (avatar) {
    avatar.lastActivity = Date.now();
    // If faded out, bring back
    if (avatar.fadeOut) {
      avatar.fadeOut = false;
      avatar.fadeIn = true;
      avatar.opacity = 0;
    }
  }
}

// ── Report avatar list back to main process periodically ──────────────────
setInterval(() => {
  if (window.vcdOverlay && window.vcdOverlay.sendUpdate) {
    const avatarList = [...avatars.values()].map(a => ({
      username: a.username,
      currentEmote: a.currentEmote,
      lastActivity: a.lastActivity,
      x: a.x,
      y: a.y
    }));
    window.vcdOverlay.sendUpdate({ avatars: avatarList, count: avatars.size });
  }
}, 2000);

// ── Embedded Fallback Animations ──────────────────────────────────────────
// Used when IPC load fails (e.g. file missing, development mode)
const FALLBACK_ANIMATIONS = {
  idle: {
    name: 'Idle', category: 'idle', loop: true, fps: 12,
    frames: [
      { head: 0.03, torso: 0.02, leftUpperArm: 0.3, leftLowerArm: 0, rightUpperArm: -0.3, rightLowerArm: 0, leftUpperLeg: 0, leftLowerLeg: 0, rightUpperLeg: 0, rightLowerLeg: 0 },
      { head: -0.03, torso: -0.02, leftUpperArm: 0.25, leftLowerArm: 0, rightUpperArm: -0.25, rightLowerArm: 0, leftUpperLeg: 0.05, leftLowerLeg: 0, rightUpperLeg: -0.05, rightLowerLeg: 0 }
    ]
  },
  disco: {
    name: 'Disco', category: 'classic', loop: true, fps: 12,
    frames: [
      { head: 0.15, torso: 0.2, leftUpperArm: 0.4, leftLowerArm: -0.6, rightUpperArm: -2.8, rightLowerArm: -0.3, leftUpperLeg: 0.15, leftLowerLeg: 0.1, rightUpperLeg: -0.2, rightLowerLeg: 0.15 },
      { head: -0.15, torso: -0.2, leftUpperArm: 2.8, leftLowerArm: 0.3, rightUpperArm: -0.2, rightLowerArm: 0.6, leftUpperLeg: -0.2, leftLowerLeg: 0.15, rightUpperLeg: 0.15, rightLowerLeg: 0.1 }
    ]
  },
  funky: {
    name: 'Funky', category: 'classic', loop: true, fps: 12,
    frames: [
      { head: 0.24, torso: 0.29, leftUpperArm: 1.14, leftLowerArm: 0.59, rightUpperArm: -1.14, rightLowerArm: -0.59, leftUpperLeg: 0.48, leftLowerLeg: 0.38, rightUpperLeg: -0.48, rightLowerLeg: 0 },
      { head: -0.24, torso: -0.29, leftUpperArm: -1.14, leftLowerArm: -0.41, rightUpperArm: 1.14, rightLowerArm: 0.41, leftUpperLeg: -0.48, leftLowerLeg: 0, rightUpperLeg: 0.48, rightLowerLeg: 0.38 }
    ]
  },
  robot: {
    name: 'Robot', category: 'classic', loop: true, fps: 8,
    frames: [
      { head: 0.0, torso: 0.0, leftUpperArm: 0.0, leftLowerArm: 0.0, rightUpperArm: 1.33, rightLowerArm: 0.67, leftUpperLeg: 0.0, leftLowerLeg: 0, rightUpperLeg: 0.67, rightLowerLeg: 0.67 },
      { head: 0.33, torso: 0.33, leftUpperArm: 1.33, leftLowerArm: 0.67, rightUpperArm: 0.67, rightLowerArm: -0.33, leftUpperLeg: 0.67, leftLowerLeg: 0.33, rightUpperLeg: 0.33, rightLowerLeg: 0.33 },
      { head: -0.33, torso: -0.33, leftUpperArm: -1.33, leftLowerArm: 0.67, rightUpperArm: -0.67, rightLowerArm: -0.33, leftUpperLeg: -0.67, leftLowerLeg: 0, rightUpperLeg: -0.33, rightLowerLeg: 0 },
      { head: -0.33, torso: -0.33, leftUpperArm: -1.33, leftLowerArm: -0.67, rightUpperArm: 0.67, rightLowerArm: -0.33, leftUpperLeg: -0.67, leftLowerLeg: 0, rightUpperLeg: 0.33, rightLowerLeg: 0.33 }
    ]
  },
  winken: {
    name: 'Winken', category: 'social', loop: true, fps: 10,
    frames: [
      { head: 0.1, torso: 0.05, leftUpperArm: -2.8, leftLowerArm: -0.5, rightUpperArm: 0.2, rightLowerArm: 0, leftUpperLeg: 0, leftLowerLeg: 0, rightUpperLeg: 0, rightLowerLeg: 0 },
      { head: 0.1, torso: 0.05, leftUpperArm: -2.5, leftLowerArm: -0.9, rightUpperArm: 0.2, rightLowerArm: 0, leftUpperLeg: 0, leftLowerLeg: 0, rightUpperLeg: 0, rightLowerLeg: 0 },
      { head: 0.1, torso: 0.05, leftUpperArm: -2.8, leftLowerArm: -0.5, rightUpperArm: 0.2, rightLowerArm: 0, leftUpperLeg: 0, leftLowerLeg: 0, rightUpperLeg: 0, rightLowerLeg: 0 },
      { head: 0.1, torso: 0.05, leftUpperArm: -2.5, leftLowerArm: -0.9, rightUpperArm: 0.2, rightLowerArm: 0, leftUpperLeg: 0, leftLowerLeg: 0, rightUpperLeg: 0, rightLowerLeg: 0 }
    ]
  },
  lachen: {
    name: 'Lachen', category: 'social', loop: false, fps: 10,
    frames: [
      { head: 0.15, torso: 0.1, leftUpperArm: 0.4, leftLowerArm: -0.8, rightUpperArm: -0.4, rightLowerArm: 0.8, leftUpperLeg: 0, leftLowerLeg: 0, rightUpperLeg: 0, rightLowerLeg: 0 },
      { head: -0.1, torso: -0.05, leftUpperArm: 0.5, leftLowerArm: -0.6, rightUpperArm: -0.5, rightLowerArm: 0.6, leftUpperLeg: 0, leftLowerLeg: 0, rightUpperLeg: 0, rightLowerLeg: 0 }
    ]
  }
};

// ── Load Animations & Start ────────────────────────────────────────────────
async function init() {
  // Use the preload bridge (IPC) to load animations from main process via Node.js fs.
  // This avoids fetch() which is unreliable with file:// protocol in Electron.
  try {
    if (window.vcdOverlay && window.vcdOverlay.loadAnimations) {
      const result = await window.vcdOverlay.loadAnimations();
      if (result.success && result.data) {
        ANIMATIONS = result.data;
        console.log(`[Overlay] Loaded ${Object.keys(ANIMATIONS).length} animations via IPC`);
      } else {
        console.warn('[Overlay] IPC load failed:', result.error, '- using embedded fallback');
        ANIMATIONS = FALLBACK_ANIMATIONS;
      }
    } else {
      console.warn('[Overlay] Preload bridge not available, using embedded fallback');
      ANIMATIONS = FALLBACK_ANIMATIONS;
    }
  } catch (e) {
    console.error('[Overlay] Failed to load animations via IPC:', e, '- using embedded fallback');
    ANIMATIONS = FALLBACK_ANIMATIONS;
  }

  // Start render loop
  requestAnimationFrame(gameLoop);
  console.log('[Overlay] Renderer initialized - TRANSPARENT canvas, avatars only');
}

init();
