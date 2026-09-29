'use client';

/**
 * SleepTimer — Sprint 1
 *
 * Modes: 15m, 30m, 45m, 60m, end-of-track, custom
 * At expiry: 5-second volume fade → pause → clear
 */

export type SleepTimerMode =
  | 15
  | 30
  | 45
  | 60
  | 'end-of-track'
  | number; // custom minutes

type OnTickCallback = (remainingMs: number) => void;
type OnExpireCallback = () => void;

export class SleepTimer {
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private tickId: ReturnType<typeof setInterval> | null = null;
  private endTime = 0;
  private fadeId: ReturnType<typeof setInterval> | null = null;

  private onTick: OnTickCallback;
  private onExpire: OnExpireCallback;

  constructor(onTick: OnTickCallback, onExpire: OnExpireCallback) {
    this.onTick = onTick;
    this.onExpire = onExpire;
  }

  /** Start timer for `minutes` from now. Pass Infinity for end-of-track mode. */
  start(minutes: number) {
    this.clear();
    const durationMs = minutes * 60 * 1000;
    this.endTime = Date.now() + durationMs;

    // Tick every second
    this.tickId = setInterval(() => {
      const remaining = Math.max(0, this.endTime - Date.now());
      this.onTick(remaining);
      if (remaining <= 0) {
        this._expire();
      }
    }, 1000);

    // Hard timer as backup
    this.timerId = setTimeout(() => this._expire(), durationMs);
  }

  /** Start in end-of-track mode — caller must call .expireNow() on track end */
  startEndOfTrack() {
    this.clear();
    this.endTime = Infinity;
    // No tick needed for end-of-track; remaining = 0 shown as "after current song"
    this.onTick(Infinity);
  }

  expireNow() {
    if (this.endTime === Infinity) {
      this._expire();
    }
  }

  getRemainingMs(): number {
    if (!this.endTime || this.endTime === Infinity) return Infinity;
    return Math.max(0, this.endTime - Date.now());
  }

  isEndOfTrackMode(): boolean {
    return this.endTime === Infinity;
  }

  isActive(): boolean {
    return this.endTime > 0;
  }

  clear() {
    if (this.timerId !== null) clearTimeout(this.timerId);
    if (this.tickId !== null) clearInterval(this.tickId);
    if (this.fadeId !== null) clearInterval(this.fadeId);
    this.timerId = null;
    this.tickId = null;
    this.fadeId = null;
    this.endTime = 0;
  }

  private _expire() {
    this.clear();
    // 5-second volume fade then pause
    import('@/lib/audio/AudioManager').then(({ audioManager }) => {
      if (!audioManager) {
        this.onExpire();
        return;
      }

      const startVol = audioManager.volume;
      const steps = 50; // 5s / 100ms
      let step = 0;

      this.fadeId = setInterval(() => {
        step++;
        const ratio = 1 - step / steps;
        audioManager.setVolume(Math.max(0, startVol * ratio));

        if (step >= steps) {
          if (this.fadeId !== null) clearInterval(this.fadeId);
          this.fadeId = null;
          audioManager.pause();
          // Restore volume after pause
          setTimeout(() => audioManager.setVolume(startVol), 300);
          this.onExpire();
        }
      }, 100);
    });
  }
}
