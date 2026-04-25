/**
 * VirtualClubDancers v2.2.0 - Main Process
 * Express + Socket.IO webserver on port 3333
 * OBS Browser Source loads http://localhost:3333 for transparent overlay
 * Electron tray-only (no overlay BrowserWindow)
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// ── Safe Config Store (paths initialized AFTER app ready) ──────────────────
let CONFIG_DIR = null;
let CONFIG_FILE = null;

const DEFAULT_CONFIG = {
  twitch: {
    channel: '',
    oauthToken: '',
    botUsername: ''
  },
  scene: {
    moveZoneYMin: 0.55,
    moveZoneYMax: 0.90,
    maxAvatars: 50,
    inactivityTimeout: 120000,
    avatarScale: 4.0,
    personalSpaceRadius: 0.12,
    pushStrength: 0.55
  },
  admin: {
    autoOpen: true
  }
};

function initConfigPaths() {
  try {
    CONFIG_DIR = path.join(app.getPath('userData'), 'vcd-config');
    CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
  } catch (e) {
    // Fallback if app.getPath still fails
    CONFIG_DIR = path.join(require('os').homedir(), '.virtualclubdancers');
    CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
  }
}

function loadConfig() {
  if (!CONFIG_FILE) initConfigPaths();
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const saved = JSON.parse(raw);
      return {
        twitch: { ...DEFAULT_CONFIG.twitch, ...(saved.twitch || {}) },
        scene: { ...DEFAULT_CONFIG.scene, ...(saved.scene || {}) },
        admin: { ...DEFAULT_CONFIG.admin, ...(saved.admin || {}) }
      };
    }
  } catch (e) {
    console.error('[VCD] Config load error:', e.message);
  }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function saveConfig(config) {
  if (!CONFIG_FILE) initConfigPaths();
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('[VCD] Config save error:', e.message);
  }
}

let config = null; // Initialized after app ready

// ── State Variables ─────────────────────────────────────────────────────────
let adminWindow = null;
let twitchBot = null;
let avatarManager = null;
let beatDetector = null;
let io = null;
let httpServer = null;
let tray = null;

// Track Socket.IO clients by type
const clientTypes = new Map();

// ── Lazy-load modules (safer for packaged builds) ──────────────────────────
let TwitchBot = null;
let AvatarManager = null;
let BeatDetector = null;

function loadModules() {
  // Try multiple path strategies for packaged builds
  const tryPaths = [
    // Strategy 1: Relative from __dirname (works in dev and most packaged builds)
    () => {
      TwitchBot = require('../twitch/twitch-bot');
      AvatarManager = require('../avatar/avatar-manager');
      BeatDetector = require('../beat/beat-detector');
    },
    // Strategy 2: app.getAppPath() based
    () => {
      const appPath = app.getAppPath();
      TwitchBot = require(path.join(appPath, 'src', 'twitch', 'twitch-bot'));
      AvatarManager = require(path.join(appPath, 'src', 'avatar', 'avatar-manager'));
      BeatDetector = require(path.join(appPath, 'src', 'beat', 'beat-detector'));
    },
    // Strategy 3: process.resourcesPath based
    () => {
      const resPath = path.join(process.resourcesPath, 'app', 'src');
      TwitchBot = require(path.join(resPath, 'twitch', 'twitch-bot'));
      AvatarManager = require(path.join(resPath, 'avatar', 'avatar-manager'));
      BeatDetector = require(path.join(resPath, 'beat', 'beat-detector'));
    }
  ];

  for (let i = 0; i < tryPaths.length; i++) {
    try {
      tryPaths[i]();
      if (TwitchBot && AvatarManager && BeatDetector) {
        console.log(`[VCD] All modules loaded (strategy ${i + 1})`);
        return;
      }
    } catch (e) {
      console.warn(`[VCD] Module load strategy ${i + 1} failed:`, e.message);
      // Reset partial loads
      TwitchBot = null;
      AvatarManager = null;
      BeatDetector = null;
    }
  }

  console.error('[VCD] CRITICAL: All module load strategies failed!');
  console.error('[VCD] __dirname:', __dirname);
  console.error('[VCD] app.getAppPath():', app.getAppPath());
  console.error('[VCD] process.resourcesPath:', process.resourcesPath);
}

// ── Express + Socket.IO Server ─────────────────────────────────────────────
function startServer() {
  let express, socketIO;
  try {
    express = require('express');
    socketIO = require('socket.io');
  } catch (e) {
    console.error('[VCD] CRITICAL: Cannot load express/socket.io:', e.message);
    return;
  }

  const expressApp = express();
  const PORT = 3333;

  // CORS headers for OBS Browser Source
  expressApp.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
  });

  // Serve overlay HTML at root (for OBS Browser Source)
  expressApp.get('/', (req, res) => {
    try {
      const overlayPath = path.join(__dirname, '..', 'renderer', 'overlay.html');
      if (fs.existsSync(overlayPath)) {
        res.sendFile(overlayPath);
      } else {
        // Try alternate path for packaged build
        const altPath = path.join(app.getAppPath(), 'src', 'renderer', 'overlay.html');
        if (fs.existsSync(altPath)) {
          res.sendFile(altPath);
        } else {
          res.status(500).send('Overlay HTML not found at: ' + overlayPath);
        }
      }
    } catch (e) {
      res.status(500).send('Error: ' + e.message);
    }
  });

  // Serve admin HTML at /admin
  expressApp.get('/admin', (req, res) => {
    try {
      const adminPath = path.join(__dirname, '..', 'admin', 'admin.html');
      if (fs.existsSync(adminPath)) {
        res.sendFile(adminPath);
      } else {
        const altPath = path.join(app.getAppPath(), 'src', 'admin', 'admin.html');
        if (fs.existsSync(altPath)) {
          res.sendFile(altPath);
        } else {
          res.status(404).send('Admin panel not found');
        }
      }
    } catch (e) {
      res.status(500).send('Error: ' + e.message);
    }
  });

  // Serve animation data
  expressApp.get('/api/animations', (req, res) => {
    try {
      // Try multiple paths for the animation data
      const animPaths = [
        path.join(__dirname, '..', '..', 'data', 'animations', 'dances.json'),
        path.join(app.getAppPath(), 'data', 'animations', 'dances.json'),
        path.join(process.resourcesPath, 'data', 'animations', 'dances.json')
      ];

      let animPath = null;
      for (const p of animPaths) {
        if (fs.existsSync(p)) {
          animPath = p;
          break;
        }
      }

      if (!animPath) {
        res.json({ success: false, error: 'animations file not found', data: null });
        return;
      }

      const raw = fs.readFileSync(animPath, 'utf-8');
      const animations = JSON.parse(raw);
      res.json({ success: true, data: animations });
    } catch (err) {
      res.json({ success: false, error: err.message, data: null });
    }
  });

  // Health check
  expressApp.get('/api/status', (req, res) => {
    res.json({
      running: true,
      version: '2.2.0',
      twitch: twitchBot ? (twitchBot.connected ? 'connected' : 'disconnected') : 'not_configured',
      avatars: avatarManager ? avatarManager.avatars.size : 0,
      clients: clientTypes.size,
      uptime: Math.floor(process.uptime())
    });
  });

  httpServer = http.createServer(expressApp);

  // Socket.IO with CORS for OBS Browser Source
  io = socketIO(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // ── Socket.IO Connection Handler ─────────────────────────────────────────
  io.on('connection', (socket) => {
    console.log(`[IO] Client connected: ${socket.id}`);
    clientTypes.set(socket.id, 'unknown');

    // Send initial state with full config including avatarScale
    const initState = {
      type: 'init',
      twitchStatus: twitchBot && twitchBot.connected ? 'connected' : 'disconnected',
      channel: config.twitch.channel,
      avatars: avatarManager ? avatarManager.getAvatarList() : [],
      bpm: beatDetector ? beatDetector.bpm : 120,
      config: {
        twitch: config.twitch,
        scene: config.scene,
        admin: config.admin
      }
    };
    console.log('[IO] Sending init config to client:', JSON.stringify(config.scene));
    socket.emit('init', initState);

    // Client identifies itself
    socket.on('identify', (data) => {
      if (data && data.clientType) {
        clientTypes.set(socket.id, data.clientType);
        console.log(`[IO] Client ${socket.id} identified as: ${data.clientType}`);
      }
    });

    // Avatar updates from overlay
    socket.on('avatar-update', (data) => {
      if (avatarManager && data.avatars) {
        for (const avData of data.avatars) {
          if (avatarManager.avatars.has(avData.username)) {
            avatarManager.avatars.get(avData.username).currentEmote = avData.currentEmote;
          }
        }
      }
      broadcastToAdmin('avatarUpdate', data);
    });

    // Admin commands
    socket.on('admin-command', (data) => {
      handleAdminCommand(data);
    });

    socket.on('disconnect', () => {
      const cType = clientTypes.get(socket.id);
      console.log(`[IO] Client disconnected: ${socket.id} (was: ${cType})`);
      clientTypes.delete(socket.id);
    });
  });

  httpServer.listen(PORT, () => {
    console.log(`[VCD] Server running at http://localhost:${PORT}`);
    console.log(`[VCD] OBS Browser Source URL: http://localhost:${PORT}`);
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[VCD] Port ${PORT} already in use!`);
    } else {
      console.error('[VCD] Server error:', err.message);
    }
  });
}

// ── Send to specific client types ───────────────────────────────────────────
function sendToOverlay(event, data) {
  if (!io) return;
  for (const [socketId, cType] of clientTypes) {
    if (cType === 'overlay') {
      io.to(socketId).emit(event, data);
    }
  }
}

function broadcastToAdmin(event, data) {
  if (!io) return;
  for (const [socketId, cType] of clientTypes) {
    if (cType === 'admin') {
      io.to(socketId).emit(event, data);
    }
  }
}

function broadcastAll(event, data) {
  if (!io) return;
  io.emit(event, data);
}

// ── Admin Command Handler ──────────────────────────────────────────────────
function handleAdminCommand(msg) {
  switch (msg.type) {
    case 'triggerEmote':
      if (msg.username) {
        sendToOverlay('setEmote', { username: msg.username, emote: msg.emote });
        if (avatarManager) avatarManager.resetInactivity(msg.username);
      } else {
        sendToOverlay('partyMode', { mode: 'forceEmote', emote: msg.emote });
      }
      break;
    case 'removeAvatar':
      sendToOverlay('removeAvatar', { username: msg.username });
      if (avatarManager) avatarManager.removeAvatar(msg.username);
      break;
    case 'partyMode':
      sendToOverlay('partyMode', { mode: msg.mode, emote: msg.emote });
      break;
    case 'setBPM':
      if (beatDetector) {
        beatDetector.setManualBPM(msg.bpm);
      }
      break;
    case 'updateConfig':
      if (msg.config) {
        config.scene = { ...config.scene, ...msg.config };
        saveConfig(config);
        console.log('[VCD] Config updated:', JSON.stringify(config.scene));
        sendToOverlay('configUpdate', { config: config.scene });
        broadcastToAdmin('configSaved', { config: config.scene });
      }
      break;
    case 'audioBeatPulse':
      // Forward real audio beat from admin to overlay
      const beatBPM = msg.bpm || (beatDetector ? beatDetector.bpm : 120);
      sendToOverlay('audioBeat', { bpm: beatBPM });
      if (beatDetector && msg.bpm) beatDetector.setManualBPM(msg.bpm);
      break;
    case 'connectTwitch':
      console.log(`[VCD] Twitch connect request: channel=${msg.channel}`);
      startTwitchBot(msg.channel, msg.oauthToken, msg.botUsername);
      break;
    case 'disconnectTwitch':
      console.log('[VCD] Twitch disconnect request');
      stopTwitchBot();
      break;
    case 'spawnAvatar':
      if (msg.username) {
        if (avatarManager) avatarManager.addAvatar(msg.username);
        sendToOverlay('spawnAvatar', { username: msg.username });
        console.log(`[VCD] Avatar spawned via admin: ${msg.username}`);
      }
      break;
    case 'spawnConfetti':
      sendToOverlay('spawnConfetti', { x: msg.x, y: msg.y, count: msg.count || 30 });
      break;
  }
}

// ── Admin Panel Window ─────────────────────────────────────────────────────
function createAdminWindow() {
  if (adminWindow && !adminWindow.isDestroyed()) {
    adminWindow.focus();
    return;
  }

  adminWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    title: 'VirtualClubDancers - Admin Panel',
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Load admin from Express server instead of file
  adminWindow.loadURL('http://localhost:3333/admin');
  adminWindow.on('closed', () => {
    adminWindow = null;
  });
}

// ── Get Icon Path ──────────────────────────────────────────────────────────
function getIconPath() {
  const iconPaths = [
    path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
    path.join(app.getAppPath(), 'assets', 'icon.ico')
  ];
  for (const p of iconPaths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

// ── Twitch Bot ─────────────────────────────────────────────────────────────
function startTwitchBot(channel, oauthToken, botUsername) {
  if (!TwitchBot) {
    console.error('[VCD] TwitchBot module not loaded!');
    broadcastToAdmin('twitchError', { message: 'TwitchBot Modul konnte nicht geladen werden!' });
    return;
  }

  if (twitchBot) {
    try { twitchBot.disconnect(); } catch (e) { /* ignore */ }
    twitchBot = null;
  }

  const twitchConfig = {
    channel: (channel || config.twitch.channel || '').trim(),
    oauthToken: (oauthToken || config.twitch.oauthToken || '').trim(),
    botUsername: (botUsername || config.twitch.botUsername || channel || config.twitch.channel || '').trim()
  };

  if (!twitchConfig.channel) {
    broadcastToAdmin('twitchError', { message: 'Kanalname fehlt!' });
    return;
  }

  if (!twitchConfig.oauthToken) {
    broadcastToAdmin('twitchError', { message: 'OAuth Token fehlt!' });
    return;
  }

  const tokenClean = twitchConfig.oauthToken.startsWith('oauth:') ? twitchConfig.oauthToken.slice(6) : twitchConfig.oauthToken;
  if (tokenClean.length < 20) {
    broadcastToAdmin('twitchError', { message: 'OAuth Token scheint ungültig.' });
    return;
  }

  console.log(`[VCD] Starting Twitch bot: #${twitchConfig.channel}`);

  config.twitch = twitchConfig;
  saveConfig(config);

  try {
    twitchBot = new TwitchBot(twitchConfig);

    twitchBot.on('command', (data) => {
      handleTwitchCommand(data);
    });

    twitchBot.on('chat', (data) => {
      if (avatarManager && avatarManager.avatars.has(data.username)) {
        avatarManager.resetInactivity(data.username);
        sendToOverlay('resetInactivity', { username: data.username });
      }
      broadcastToAdmin('chatMessage', data);
    });

    twitchBot.on('connected', () => {
      console.log(`[VCD] Twitch connected to #${twitchConfig.channel}`);
      broadcastToAdmin('twitchStatus', { status: 'connected', channel: twitchConfig.channel });
      sendToOverlay('twitchConnected', { channel: twitchConfig.channel });
    });

    twitchBot.on('disconnected', () => {
      console.log('[VCD] Twitch disconnected');
      broadcastToAdmin('twitchStatus', { status: 'disconnected' });
    });

    twitchBot.on('error', (err) => {
      console.error('[VCD] Twitch error:', err.message);
      broadcastToAdmin('twitchError', { message: err.message });
    });

    twitchBot.connect();
  } catch (e) {
    console.error('[VCD] Failed to create Twitch bot:', e.message);
    broadcastToAdmin('twitchError', { message: 'Twitch Bot fehlgeschlagen: ' + e.message });
  }
}

function stopTwitchBot() {
  if (twitchBot) {
    try { twitchBot.disconnect(); } catch (e) { /* ignore */ }
    twitchBot = null;
    broadcastToAdmin('twitchStatus', { status: 'disconnected' });
  }
}

function handleTwitchCommand(data) {
  const { username, command, args } = data;

  switch (command) {
    case 'join':
      if (avatarManager) {
        const result = avatarManager.addAvatar(username);
        if (result) {
          sendToOverlay('spawnAvatar', { username });
          if (twitchBot) twitchBot.say(`@${username} ist jetzt im Club!`);
        } else {
          sendToOverlay('resetInactivity', { username });
          if (twitchBot) twitchBot.say(`@${username} du bist schon im Club!`);
        }
      }
      break;

    case 'leave':
    case 'quit':
    case 'exit':
      if (avatarManager) {
        avatarManager.removeAvatar(username);
        sendToOverlay('removeAvatar', { username });
        if (twitchBot) twitchBot.say(`@${username} verlässt den Club!`);
      }
      break;

    case 'dance':
      if (avatarManager) {
        const emoteName = args[0] || 'disco';
        if (!avatarManager.avatars.has(username)) {
          avatarManager.addAvatar(username);
          sendToOverlay('spawnAvatar', { username });
        }
        if (avatarManager.setEmote(username, emoteName)) {
          sendToOverlay('setEmote', { username, emote: emoteName });
          if (twitchBot) twitchBot.say(`@${username} tanzt ${emoteName}!`);
        } else {
          if (twitchBot) twitchBot.say(`@${username} Tanz "${emoteName}" nicht gefunden. !list dances`);
        }
      }
      break;

    case 'emote':
      if (args[0] && avatarManager) {
        const emoteName = args[0];
        if (!avatarManager.avatars.has(username)) {
          avatarManager.addAvatar(username);
          sendToOverlay('spawnAvatar', { username });
        }
        avatarManager.setEmote(username, emoteName);
        sendToOverlay('setEmote', { username, emote: emoteName });
        if (twitchBot) twitchBot.say(`@${username} macht ${emoteName}!`);
      }
      break;

    case 'list':
      if (twitchBot) {
        const listType = args[0] || 'dances';
        if (listType === 'dances') {
          const dances = avatarManager ? avatarManager.danceEmotes : [];
          twitchBot.say(`Tänze: ${dances.slice(0, 20).join(', ')} ...`);
        } else {
          const emotes = avatarManager ? avatarManager.socialEmotes : [];
          twitchBot.say(`Emotes: ${emotes.slice(0, 15).join(', ')}`);
        }
      }
      break;

    case 'stop':
      if (avatarManager) {
        avatarManager.setEmote(username, null);
        sendToOverlay('setEmote', { username, emote: null });
      }
      break;

    case 'hug':
    case 'highfive':
    case 'kiss':
    case 'box':
      if (avatarManager && args[0]) {
        const target = args[0].replace('@', '');
        if (avatarManager.setInteractionEmote(username, command, target)) {
          sendToOverlay('setEmote', { username, emote: command });
          const verbs = { hug: 'umarmt', highfive: 'gibt High-Five', kiss: 'küsst', box: 'boxt' };
          if (twitchBot) twitchBot.say(`@${username} ${verbs[command] || command} @${target}!`);
        }
      }
      break;

    case 'color':
      if (avatarManager && args[0] && args[1]) {
        avatarManager.setAvatarColor(username, args[0], args[1]);
        sendToOverlay('updateColor', { username, part: args[0], color: args[1] });
        if (twitchBot) twitchBot.say(`@${username} Farbe geändert!`);
      }
      break;

    default:
      if (avatarManager && avatarManager.allEmotes.includes(command)) {
        if (!avatarManager.avatars.has(username)) {
          avatarManager.addAvatar(username);
          sendToOverlay('spawnAvatar', { username });
        }
        avatarManager.setEmote(username, command);
        sendToOverlay('setEmote', { username, emote: command });
        if (twitchBot) twitchBot.say(`@${username} macht ${command}!`);
      }
      break;
  }

  broadcastToAdmin('command', { username, command, args });
}

// ── Beat Detector ──────────────────────────────────────────────────────────
function startBeatDetector() {
  if (!BeatDetector) return;
  beatDetector = new BeatDetector();

  beatDetector.on('beat', (beatInfo) => {
    if (avatarManager) avatarManager.onBeat(beatInfo);
    broadcastAll('beat', beatInfo);
  });

  beatDetector.on('bpmUpdate', (bpm) => {
    broadcastAll('bpmUpdate', { bpm });
  });
}

// ── System Tray ───────────────────────────────────────────────────────────
function createTray() {
  let trayIcon;
  try {
    const iconPaths = [
      path.join(__dirname, '..', '..', 'assets', 'tray-icon.png'),
      path.join(app.getAppPath(), 'assets', 'tray-icon.png')
    ];
    for (const p of iconPaths) {
      if (fs.existsSync(p)) {
        trayIcon = nativeImage.createFromPath(p);
        if (!trayIcon.isEmpty()) break;
      }
    }
  } catch (e) { /* ignore */ }

  if (!trayIcon || trayIcon.isEmpty()) {
    const size = 16;
    const buf = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      buf[i * 4] = 0x91;
      buf[i * 4 + 1] = 0x46;
      buf[i * 4 + 2] = 0xFF;
      buf[i * 4 + 3] = 0xFF;
    }
    trayIcon = nativeImage.createFromBuffer(buf, { width: size, height: size });
  }

  try {
    tray = new Tray(trayIcon);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'VirtualClubDancers v2.2.0', enabled: false },
      { type: 'separator' },
      {
        label: 'Admin Panel öffnen',
        click: () => {
          if (!adminWindow || adminWindow.isDestroyed()) {
            createAdminWindow();
          } else {
            adminWindow.focus();
          }
        }
      },
      {
        label: 'OBS-URL kopieren (http://localhost:3333)',
        click: () => {
          clipboard.writeText('http://localhost:3333');
        }
      },
      {
        label: 'Test-Avatar spawnen',
        click: () => {
          const testUser = 'TestDancer' + Math.floor(Math.random() * 100);
          if (avatarManager) avatarManager.addAvatar(testUser);
          sendToOverlay('spawnAvatar', { username: testUser });
          setTimeout(() => {
            const dances = ['disco', 'funky', 'robot', 'twist'];
            const emote = dances[Math.floor(Math.random() * dances.length)];
            sendToOverlay('setEmote', { username: testUser, emote });
          }, 500);
        }
      },
      { type: 'separator' },
      {
        label: 'Beenden',
        click: () => { cleanupAndQuit(); }
      }
    ]);

    tray.setToolTip('VirtualClubDancers - OBS Browser Source Overlay');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
      if (!adminWindow || adminWindow.isDestroyed()) {
        createAdminWindow();
      } else {
        adminWindow.focus();
      }
    });
  } catch (e) {
    console.error('[VCD] Tray creation failed (non-critical):', e.message);
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────
function cleanupAndQuit() {
  try { if (twitchBot) twitchBot.disconnect(); } catch (e) { /* ignore */ }
  try { if (beatDetector) beatDetector.stop(); } catch (e) { /* ignore */ }
  try { if (io) io.close(); } catch (e) { /* ignore */ }
  try { if (httpServer) httpServer.close(); } catch (e) { /* ignore */ }
  try { if (tray) tray.destroy(); } catch (e) { /* ignore */ }
  app.quit();
}

// ── App Lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  try {
    console.log('[VCD] VirtualClubDancers v2.2.0 starting...');
    console.log('[VCD] __dirname:', __dirname);
    console.log('[VCD] app.getAppPath():', app.getAppPath());

    // Initialize config paths AFTER app is ready
    initConfigPaths();
    config = loadConfig();

    // Load modules
    loadModules();

    // Initialize avatar manager
    if (AvatarManager) {
      avatarManager = new AvatarManager(config.scene);
      console.log('[VCD] AvatarManager initialized');
    } else {
      console.error('[VCD] AvatarManager not available - avatar features disabled');
    }

    // Start Express + Socket.IO server
    startServer();

    // Create system tray
    createTray();

    // Start beat detector
    startBeatDetector();

    // Create admin window after a short delay (give server time to start)
    setTimeout(() => {
      createAdminWindow();
    }, 1500);

    // Auto-connect Twitch if configured
    if (config.twitch.channel && config.twitch.oauthToken) {
      setTimeout(() => {
        console.log('[VCD] Auto-connecting Twitch...');
        startTwitchBot();
      }, 3000);
    }

    console.log('[VCD] Ready! Overlay at http://localhost:3333 + Admin at http://localhost:3333/admin');
  } catch (e) {
    console.error('[VCD] FATAL startup error:', e.message);
    console.error(e.stack);
  }
});

// Global error handlers - prevent crashes
process.on('uncaughtException', (err) => {
  console.error('[VCD] UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[VCD] UNHANDLED REJECTION:', reason);
});

// Don't quit when all windows are closed
app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('before-quit', () => {
  cleanupAndQuit();
});

app.on('second-instance', () => {
  if (adminWindow && !adminWindow.isDestroyed()) {
    if (adminWindow.isMinimized()) adminWindow.restore();
    adminWindow.focus();
  } else {
    createAdminWindow();
  }
});
