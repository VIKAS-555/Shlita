/**
 * Web Audio API High-Tech Sound Synthesizer for Shlita
 * Zero external mp3 dependencies — synthesized entirely via native AudioContext.
 */

class SoundEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;

  constructor() {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('shlita_sound_muted') : null;
    this.isMuted = saved === 'true';
  }

  private initCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        this.ctx = new AudioCtxClass();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('shlita_sound_muted', String(this.isMuted));
    }
    if (!this.isMuted) {
      this.playClick();
    }
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  /**
   * High-tech UI click blip (subtle 1200Hz sine wave decay)
   */
  public playClick() {
    if (this.isMuted) return;
    const ctx = this.initCtx();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.04);

      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.045);
    } catch {
      // AudioContext failure fallback
    }
  }

  /**
   * Uplifting harmonic chime on authorized settlement confirmation
   */
  public playSuccess() {
    if (this.isMuted) return;
    const ctx = this.initCtx();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.06);

        gain.gain.setValueAtTime(0.08, now + idx * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.25);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.06);
        osc.stop(now + idx * 0.06 + 0.28);
      });
    } catch {}
  }

  /**
   * Crisp low-frequency shield deflection when a violation is blocked
   */
  public playBlocked() {
    if (this.isMuted) return;
    const ctx = this.initCtx();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.14);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.15);
    } catch {}
  }

  /**
   * Deep ominous sub-bass hum + warning tone when circuit breaker trips
   */
  public playCircuitHum() {
    if (this.isMuted) return;
    const ctx = this.initCtx();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;

      // Sub-bass rumble
      const oscSub = ctx.createOscillator();
      const gainSub = ctx.createGain();
      oscSub.type = 'sine';
      oscSub.frequency.setValueAtTime(65, now);
      oscSub.frequency.linearRampToValueAtTime(45, now + 0.5);
      gainSub.gain.setValueAtTime(0.2, now);
      gainSub.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      oscSub.connect(gainSub);
      gainSub.connect(ctx.destination);
      oscSub.start(now);
      oscSub.stop(now + 0.52);

      // Harsh hazard warble
      const oscAlarm = ctx.createOscillator();
      const gainAlarm = ctx.createGain();
      oscAlarm.type = 'sawtooth';
      oscAlarm.frequency.setValueAtTime(440, now);
      oscAlarm.frequency.setValueAtTime(370, now + 0.12);
      oscAlarm.frequency.setValueAtTime(440, now + 0.24);
      oscAlarm.frequency.setValueAtTime(370, now + 0.36);
      gainAlarm.gain.setValueAtTime(0.08, now);
      gainAlarm.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
      oscAlarm.connect(gainAlarm);
      gainAlarm.connect(ctx.destination);
      oscAlarm.start(now);
      oscAlarm.stop(now + 0.5);
    } catch {}
  }

  /**
   * Mechanical heavy lock engagement sound when Squads Multi-Sig threshold is verified
   */
  public playMultiSigLock() {
    if (this.isMuted) return;
    const ctx = this.initCtx();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      // Mechanical click 1
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'square';
      osc1.frequency.setValueAtTime(800, now);
      osc1.frequency.exponentialRampToValueAtTime(200, now + 0.05);
      gain1.gain.setValueAtTime(0.09, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.06);

      // Heavy vault latch click 2
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(220, now + 0.08);
      osc2.frequency.exponentialRampToValueAtTime(80, now + 0.22);
      gain2.gain.setValueAtTime(0.18, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.24);
    } catch {}
  }
}

export const sounds = new SoundEngine();
