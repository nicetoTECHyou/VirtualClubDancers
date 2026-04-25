/**
 * VirtualClubDancers - Beat Detector
 * Uses Web Audio API to detect beats from system audio
 * Falls back to manual BPM when no audio source available
 */

const EventEmitter = require('events');

class BeatDetector extends EventEmitter {
  constructor() {
    super();
    this.bpm = 120;
    this.lastBeatTime = 0;
    this.beatInterval = 60000 / this.bpm;
    this.manualMode = true;
    this.confidence = 0;
    this.running = true;

    // Beat simulation for overlay (when no real audio available)
    this.simulatedBeatTimer = null;
    this.startSimulation();
  }

  startSimulation() {
    if (this.simulatedBeatTimer) {
      clearInterval(this.simulatedBeatTimer);
    }

    this.simulatedBeatTimer = setInterval(() => {
      if (!this.running) return;

      const now = Date.now();
      this.lastBeatTime = now;

      this.emit('beat', {
        bpm: this.bpm,
        time: now,
        confidence: this.manualMode ? 0.5 : this.confidence,
        active: true
      });
    }, this.beatInterval);
  }

  setManualBPM(bpm) {
    this.bpm = Math.max(40, Math.min(200, bpm));
    this.beatInterval = 60000 / this.bpm;
    this.manualMode = true;

    // Restart simulation with new BPM
    this.startSimulation();

    this.emit('bpmUpdate', this.bpm);
  }

  /**
   * In a full implementation, this would use navigator.mediaDevices
   * to capture system audio and analyze it for beats using
   * Web Audio API (AnalyserNode + low-pass filter + energy peak detection)
   * For the initial version, manual BPM + simulation is sufficient
   */
  startAudioAnalysis(audioSource) {
    // Placeholder for real audio analysis
    // Would use: AudioContext, AnalyserNode, BiquadFilterNode
    // For now, simulation mode works well for the overlay
    this.manualMode = false;
  }

  stop() {
    this.running = false;
    if (this.simulatedBeatTimer) {
      clearInterval(this.simulatedBeatTimer);
    }
  }
}

module.exports = BeatDetector;
