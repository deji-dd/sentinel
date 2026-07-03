const apiKeyToUserId = new Map();
const apiKeyCooldownUntil = new Map();
const userCooldownUntil = new Map();
function nowMs() {
    return Date.now();
}
function withJitter(waitMs, jitterMaxMs) {
    const safeWait = Math.max(0, waitMs);
    const safeJitter = Math.max(0, jitterMaxMs);
    if (safeJitter === 0) {
        return safeWait;
    }
    const jitter = Math.floor(Math.random() * (safeJitter + 1));
    return safeWait + jitter;
}
function cleanupExpiredCooldowns() {
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
export function registerApiKeyUser(apiKey, userId) {
    apiKeyToUserId.set(apiKey, userId);
}
export function setApiKeyCooldown(apiKey, waitMs, jitterMaxMs = 350) {
    cleanupExpiredCooldowns();
    apiKeyCooldownUntil.set(apiKey, nowMs() + withJitter(waitMs, jitterMaxMs));
}
export function setUserCooldown(userId, waitMs, jitterMaxMs = 350) {
    cleanupExpiredCooldowns();
    userCooldownUntil.set(userId, nowMs() + withJitter(waitMs, jitterMaxMs));
}
export function getApiKeyCooldownRemainingMs(apiKey) {
    cleanupExpiredCooldowns();
    const now = nowMs();
    const keyRemaining = Math.max(0, (apiKeyCooldownUntil.get(apiKey) || 0) - now);
    const userId = apiKeyToUserId.get(apiKey);
    const userRemaining = userId
        ? Math.max(0, (userCooldownUntil.get(userId) || 0) - now)
        : 0;
    return Math.max(keyRemaining, userRemaining);
}
