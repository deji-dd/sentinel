const apiKeyToUserId = new Map<string, number>();
const apiKeyCooldownUntil = new Map<string, number>();
const userCooldownUntil = new Map<number, number>();

function nowMs(): number {
  return Date.now();
}

function withJitter(waitMs: number, jitterMaxMs: number): number {
  const safeWait = Math.max(0, waitMs);
  const safeJitter = Math.max(0, jitterMaxMs);
  if (safeJitter === 0) {
    return safeWait;
  }

  const jitter = Math.floor(Math.random() * (safeJitter + 1));
  return safeWait + jitter;
}

function cleanupExpiredCooldowns(): void {
  const now = nowMs();

  for (const [apiKey, until] of apiKeyCooldownUntil.entries()) {
    if (until <= now) {
      apiKeyCooldownUntil.delete(apiKey);
    }
  }

  for (const [userId, until] of userCooldownUntil.entries()) {
    if (until <= now) {
      userCooldownUntil.delete(userId);
    }
  }
}

export function registerApiKeyUser(apiKey: string, userId: number): void {
  apiKeyToUserId.set(apiKey, userId);
}

export function setApiKeyCooldown(
  apiKey: string,
  waitMs: number,
  jitterMaxMs: number = 350,
): void {
  cleanupExpiredCooldowns();
  apiKeyCooldownUntil.set(apiKey, nowMs() + withJitter(waitMs, jitterMaxMs));
}

export function setUserCooldown(
  userId: number,
  waitMs: number,
  jitterMaxMs: number = 350,
): void {
  cleanupExpiredCooldowns();
  userCooldownUntil.set(userId, nowMs() + withJitter(waitMs, jitterMaxMs));
}

export function getApiKeyCooldownRemainingMs(apiKey: string): number {
  cleanupExpiredCooldowns();
  const now = nowMs();

  const keyRemaining = Math.max(
    0,
    (apiKeyCooldownUntil.get(apiKey) || 0) - now,
  );

  const userId = apiKeyToUserId.get(apiKey);
  const userRemaining = userId
    ? Math.max(0, (userCooldownUntil.get(userId) || 0) - now)
    : 0;

  return Math.max(keyRemaining, userRemaining);
}
