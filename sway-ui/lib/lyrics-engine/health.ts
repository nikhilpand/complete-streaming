/**
 * health.ts
 * Provider Health Tracker & Circuit Breaker (Section 21 & 22)
 */

import { ProviderHealth, FailureClass } from './types';

class HealthTracker {
  private healthMap = new Map<string, ProviderHealth>();
  private consecutiveFailures = new Map<string, number>();

  private getOrCreate(providerId: string): ProviderHealth {
    let health = this.healthMap.get(providerId);
    if (!health) {
      health = {
        providerId,
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        timeoutCount: 0,
        malformedCount: 0,
        averageLatencyMs: 0,
        isCircuitOpen: false,
      };
      this.healthMap.set(providerId, health);
      this.consecutiveFailures.set(providerId, 0);
    }
    return health;
  }

  isAvailable(providerId: string): boolean {
    const health = this.getOrCreate(providerId);
    if (!health.isCircuitOpen) return true;

    // Check if cooldown expired (half-open state: allow 1 probe)
    const now = Date.now();
    if (health.circuitCooldownUntil && now > health.circuitCooldownUntil) {
      health.isCircuitOpen = false;
      health.circuitCooldownUntil = undefined;
      return true;
    }

    return false;
  }

  recordSuccess(providerId: string, latencyMs: number) {
    const health = this.getOrCreate(providerId);
    health.totalRequests++;
    health.successCount++;
    health.lastSuccessAt = Date.now();
    health.isCircuitOpen = false;
    health.circuitCooldownUntil = undefined;
    this.consecutiveFailures.set(providerId, 0);

    // Exponential moving average for latency
    health.averageLatencyMs = health.averageLatencyMs === 0
      ? latencyMs
      : Math.round(health.averageLatencyMs * 0.8 + latencyMs * 0.2);
  }

  recordFailure(providerId: string, failureClass: FailureClass, latencyMs?: number) {
    const health = this.getOrCreate(providerId);
    health.totalRequests++;
    health.failureCount++;
    health.lastFailureAt = Date.now();

    if (failureClass === 'TIMEOUT') {
      health.timeoutCount++;
    } else if (failureClass === 'MALFORMED_RESPONSE') {
      health.malformedCount++;
    }

    // NOT_FOUND or BAD_MATCH does not punish provider health
    if (failureClass === 'NOT_FOUND' || failureClass === 'BAD_MATCH') {
      return;
    }

    // CAPTCHA, RATE_LIMITED, or SERVER_ERROR increases consecutive failure counter
    const curFailures = (this.consecutiveFailures.get(providerId) || 0) + 1;
    this.consecutiveFailures.set(providerId, curFailures);

    // Section 22: 3 consecutive serious failures -> temporary demotion & cooldown
    if (failureClass === 'CAPTCHA' || failureClass === 'RATE_LIMITED' || curFailures >= 3) {
      health.isCircuitOpen = true;
      const cooldownMs = failureClass === 'CAPTCHA' ? 300000 : 45000; // 5 min for captcha, 45s for 429
      health.circuitCooldownUntil = Date.now() + cooldownMs;
    }
  }

  getSnapshot(providerId: string): ProviderHealth {
    return { ...this.getOrCreate(providerId) };
  }
}

export const providerHealthTracker = new HealthTracker();
