/**
 * VirtualClubDancers - Avatar Manager
 * Manages avatar lifecycle, emotes, inactivity, and interactions
 * Emote names match the concept document exactly
 */

class AvatarManager {
  constructor(sceneConfig) {
    this.config = sceneConfig || {
      moveZoneYMin: 0.55,
      moveZoneYMax: 0.90,
      maxAvatars: 50,
      inactivityTimeout: 120000
    };

    this.avatars = new Map();

    // ── Dance Emotes (48) - matching concept document ──────────────────────
    this.danceEmotes = [
      // Classic Dances (8)
      'disco', 'funky', 'robot', 'twist', 'mashpotato', 'swim', 'busstop', 'hustle',
      // Hip-Hop / Street (8)
      'dab', 'floss', 'worm', 'dougie', 'naenae', 'shiggy', 'inmyfeelings', 'kick',
      // Party Moves (8)
      'jump', 'spin', 'wave', 'bounce', 'shuffle', 'runningman', 'vibe', 'groove',
      // Retro / 80s (6)
      'breakdance', 'moonwalk', 'thriller', 'vogue', 'electricslide', 'macarena',
      // Cartoon / Fun (6)
      'chickendance', 'penguin', 'robotarms', 'cabbagepatch', 'sprinkler', 'lawnmower',
      // Epic / Show-Off (7)
      'airguitar', 'headbang', 'rave', 'drop', 'slowdance', 'sway', 'poplock',
      // Beat-Sync (5)
      'beatbounce', 'rhythmstep', 'pulse', 'tempowalk', 'bassdrop'
    ];

    // ── Social Emotes (20) - matching concept document ─────────────────────
    this.socialEmotes = [
      // Greetings
      'winken', 'peace', 'thumbsup',
      // Emotions
      'lachen', 'cry', 'angry', 'surprise', 'heart',
      // Consumption
      'drink', 'eat', 'cheer',
      // Interactions
      'hug', 'highfive', 'kiss', 'box',
      // Poses
      'sit', 'kneel', 'lay',
      // Special
      'confetti', 'dj'
    ];

    this.allEmotes = [...this.danceEmotes, ...this.socialEmotes];

    // Command aliases (for Twitch chat compatibility)
    this.aliases = {
      'wave': 'winken',
      'winken': 'winken',
      'laugh': 'lachen',
      'lachen': 'lachen',
      'dance': 'disco',
      'ymca': 'vogue',
      'macarena': 'macarena',
      'gangnam': 'bounce'
    };

    this.globalMode = null;
  }

  addAvatar(username) {
    if (this.avatars.has(username)) {
      return null;
    }

    if (this.avatars.size >= this.config.maxAvatars) {
      this.removeOldestInactive();
    }

    const avatarData = {
      username,
      joinedAt: Date.now(),
      lastActivity: Date.now(),
      currentEmote: null,
      colors: {},
      interacting: false,
      interactionPartner: null
    };

    this.avatars.set(username, avatarData);
    return avatarData;
  }

  removeAvatar(username) {
    return this.avatars.delete(username);
  }

  removeOldestInactive() {
    let oldest = null;
    for (const [name, data] of this.avatars) {
      if (!oldest || data.lastActivity < oldest.lastActivity) {
        oldest = { name, ...data };
      }
    }
    if (oldest) {
      this.avatars.delete(oldest.name);
    }
  }

  resetInactivity(username) {
    const avatar = this.avatars.get(username);
    if (avatar) {
      avatar.lastActivity = Date.now();
    }
  }

  setEmote(username, emoteName) {
    if (!emoteName) {
      const avatar = this.avatars.get(username);
      if (avatar) {
        avatar.currentEmote = null;
        return true;
      }
      return false;
    }

    // Resolve aliases
    const resolvedEmote = this.aliases[emoteName.toLowerCase()] || emoteName.toLowerCase();

    if (!this.allEmotes.includes(resolvedEmote)) {
      return false;
    }

    // Auto-join on any emote command
    if (!this.avatars.has(username)) {
      this.addAvatar(username);
    }

    const avatar = this.avatars.get(username);
    if (avatar) {
      avatar.currentEmote = resolvedEmote;
      avatar.lastActivity = Date.now();
      return true;
    }
    return false;
  }

  setInteractionEmote(username, emoteName, targetUsername) {
    const target = this.avatars.get(targetUsername);
    if (!target) return false;

    const avatar = this.avatars.get(username);
    if (!avatar) return false;

    avatar.currentEmote = emoteName;
    avatar.interacting = true;
    avatar.interactionPartner = targetUsername;
    avatar.lastActivity = Date.now();
    return true;
  }

  forceEmote(username, emoteName) {
    return this.setEmote(username, emoteName);
  }

  setAvatarColor(username, part, color) {
    const avatar = this.avatars.get(username);
    if (avatar) {
      avatar.colors[part] = color;
      avatar.lastActivity = Date.now();
      return true;
    }
    return false;
  }

  setGlobalMode(mode) {
    this.globalMode = mode;
  }

  getAvatarList() {
    return [...this.avatars.values()].map(a => ({
      username: a.username,
      joinedAt: a.joinedAt,
      lastActivity: a.lastActivity,
      currentEmote: a.currentEmote,
      interacting: a.interacting,
      interactionPartner: a.interactionPartner
    }));
  }

  getAvailableEmotes() {
    return this.allEmotes;
  }

  getDanceEmotes() {
    return this.danceEmotes;
  }

  getSocialEmotes() {
    return this.socialEmotes;
  }

  onBeat(beatInfo) {
    // Beat sync handled by overlay renderer
  }
}

module.exports = AvatarManager;
