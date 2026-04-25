/**
 * VirtualClubDancers - Twitch Bot (tmi.js)
 * Connects to Twitch chat, parses commands, and emits events
 * v1.2.0 - Improved connection handling, better error messages
 */

const tmi = require('tmi.js');
const EventEmitter = require('events');

class TwitchBot extends EventEmitter {
  constructor(config) {
    super();
    this.channel = config.channel;
    this.oauthToken = config.oauthToken;
    this.botUsername = config.botUsername || config.channel;
    this.client = null;
    this.connected = false;
    this.connecting = false;
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = 5;

    // Rate limiting
    this.userCooldowns = new Map();
    this.globalCommandQueue = [];
    this.globalCommandCount = 0;
    this.globalCommandWindow = 60000;
    this.maxGlobalCommands = 30;

    // Cooldowns per command type (ms)
    this.cooldowns = {
      dance: 5000,
      join: 10000,
      leave: 5000,
      wave: 3000,
      laugh: 3000,
      drink: 5000,
      eat: 5000,
      hug: 8000,
      highfive: 8000,
      color: 15000,
      emotes: 30000,
      default: 3000
    };

    // Mod/VIP cooldown multiplier
    this.modCooldownMult = 0.5;

    // Duplicate detection
    this.lastUserCommand = new Map();
    this.duplicateWindow = 3000;
  }

  connect() {
    if (this.connecting) {
      console.log('[Twitch] Already connecting, skipping...');
      return;
    }

    if (this.client) {
      try { this.client.disconnect(); } catch (e) { /* ignore */ }
      this.client = null;
    }

    this.connecting = true;
    this.connectionAttempts++;

    const channel = this.channel.toLowerCase().replace('#', '').trim();
    const username = (this.botUsername || channel).toLowerCase().trim();
    const oauthToken = this.oauthToken.startsWith('oauth:') ? this.oauthToken : `oauth:${this.oauthToken}`;

    console.log(`[Twitch] Connecting to #${channel} as ${username}... (attempt ${this.connectionAttempts})`);

    // Validate token format
    if (!oauthToken || oauthToken.length < 10) {
      this.connecting = false;
      const err = new Error('OAuth Token ist ungültig oder fehlt. Bitte Token auf twitchtokengenerator.com generieren.');
      this.emit('error', err);
      return;
    }

    this.client = new tmi.Client({
      options: { debug: false },
      connection: {
        reconnect: true,
        maxReconnectAttempts: 10,
        reconnectInterval: 5000,
        secure: true
      },
      identity: {
        username: username,
        password: oauthToken
      },
      channels: [channel]
    });

    this.client.on('connected', (addr, port) => {
      console.log(`[Twitch] Connected to ${addr}:${port} - joined #${channel}`);
      this.connected = true;
      this.connecting = false;
      this.connectionAttempts = 0;
      this.emit('connected');
    });

    this.client.on('disconnected', (reason) => {
      console.log(`[Twitch] Disconnected: ${reason}`);
      this.connected = false;
      this.connecting = false;
      this.emit('disconnected');
    });

    this.client.on('reconnect', () => {
      console.log('[Twitch] Reconnecting...');
    });

    this.client.on('notice', (channel, msgid, message) => {
      console.log(`[Twitch] Notice: ${msgid} - ${message}`);
      if (msgid === 'login_unsuccessful' || msgid === 'auth_failed') {
        this.connected = false;
        this.connecting = false;
        this.emit('error', new Error(`Login fehlgeschlagen: ${message}. Prüfe deinen OAuth Token! Gehe zu twitchtokengenerator.com`));
      }
    });

    this.client.on('message', (channel, userstate, message, self) => {
      if (self) return;
      this.handleMessage(userstate, message);
    });

    this.client.on('join', (channel, username, self) => {
      if (self) return;
    });

    this.client.connect().catch((err) => {
      console.error('[Twitch] Connection error:', err.message);
      this.connected = false;
      this.connecting = false;

      let errorMsg = 'Verbindung fehlgeschlagen';
      if (err.message && err.message.includes('ECONNREFUSED')) {
        errorMsg = 'Verbindung zum Twitch-Server abgelehnt. Internetverbindung prüfen!';
      } else if (err.message && err.message.includes('ETIMEDOUT')) {
        errorMsg = 'Verbindungstimeout. Internetverbindung prüfen!';
      } else if (err.message && err.message.includes('login')) {
        errorMsg = 'Login fehlgeschlagen. OAuth Token prüfen! Token auf twitchtokengenerator.com generieren.';
      } else if (err.message && err.message.includes('No response')) {
        errorMsg = 'Keine Antwort von Twitch. OAuth Token könnte abgelaufen sein!';
      } else {
        errorMsg = `Verbindung fehlgeschlagen: ${err.message}. Kanalname und OAuth Token prüfen!`;
      }

      this.emit('error', new Error(errorMsg));
    });
  }

  disconnect() {
    if (this.client) {
      this.connected = false;
      this.connecting = false;
      try {
        this.client.disconnect();
      } catch (e) {
        // Silently ignore disconnect errors
      }
      this.client = null;
    }
    this.emit('disconnected');
  }

  say(message) {
    if (!this.client || !this.connected) return;
    try {
      this.client.say(this.channel, message).catch(() => {});
    } catch (e) {
      // Silently fail - don't block for chat messages
    }
  }

  handleMessage(userstate, message) {
    const username = userstate['display-name'] || userstate.username;
    const isMod = userstate.mod || userstate['user-type'] === 'mod';
    const isVIP = userstate.badges && userstate.badges.vip;
    const isSub = userstate.subscriber;

    this.emit('chat', {
      username,
      message,
      isMod,
      isVIP,
      isSub,
      timestamp: Date.now()
    });

    const trimmed = message.trim();
    if (!trimmed.startsWith('!')) return;

    const parts = trimmed.slice(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    if (!this.checkRateLimit(username, command, isMod, isVIP)) {
      return;
    }

    const lastCmd = this.lastUserCommand.get(username);
    if (lastCmd && lastCmd.command === command && Date.now() - lastCmd.time < this.duplicateWindow) {
      return;
    }
    this.lastUserCommand.set(username, { command, time: Date.now() });

    this.emit('command', {
      username,
      command,
      args,
      isMod,
      isVIP,
      isSub,
      rawMessage: message
    });
  }

  checkRateLimit(username, command, isMod, isVIP) {
    const now = Date.now();
    const cooldownMult = (isMod || isVIP) ? this.modCooldownMult : 1;

    if (!this.userCooldowns.has(username)) {
      this.userCooldowns.set(username, new Map());
    }
    const userCooldowns = this.userCooldowns.get(username);
    const cooldownTime = (this.cooldowns[command] || this.cooldowns.default) * cooldownMult;

    if (userCooldowns.has(command)) {
      const lastTime = userCooldowns.get(command);
      if (now - lastTime < cooldownTime) {
        return false;
      }
    }
    userCooldowns.set(command, now);

    if (this.globalCommandCount >= this.maxGlobalCommands) {
      const oldestInWindow = this.globalCommandQueue[0];
      if (oldestInWindow && now - oldestInWindow < this.globalCommandWindow) {
        return false;
      }
      while (this.globalCommandQueue.length > 0 && now - this.globalCommandQueue[0] > this.globalCommandWindow) {
        this.globalCommandQueue.shift();
        this.globalCommandCount--;
      }
    }

    this.globalCommandQueue.push(now);
    this.globalCommandCount++;
    return true;
  }

  static getTokenGeneratorURL() {
    return 'https://twitchtokengenerator.com/';
  }
}

module.exports = TwitchBot;
