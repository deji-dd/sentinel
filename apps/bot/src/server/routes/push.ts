import { Router, type Request, type Response } from "express";
import { db } from "../../lib/db-client.js";
import { TABLE_NAMES } from "@sentinel/shared";

export const pushRouter = Router();

// Middleware to verify internal secret
function verifyInternalSecret(req: Request, res: Response, next: () => void) {
  const secretHeader = req.headers["x-sentinel-secret"] || req.headers["x-push-secret"];
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

  const expectedSecret = process.env.SENTINEL_INTERNAL_SECRET;
  const expectedPushSecret = process.env.PUSH_INTERNAL_SECRET;

  const provided = secretHeader || token;

  const isSecretValid = !!expectedSecret && provided === expectedSecret;
  const isPushSecretValid = !!expectedPushSecret && provided === expectedPushSecret;

  if (!isSecretValid && !isPushSecretValid) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

// Apply authentication middleware to all endpoints in this router
pushRouter.use(verifyInternalSecret);

// GET /api/push/subscriptions
pushRouter.get("/subscriptions", async (req: Request, res: Response) => {
  try {
    const rows = await db
      .selectFrom(TABLE_NAMES.PUSH_SUBSCRIPTIONS)
      .selectAll()
      .execute();

    // Map rows back to Web Push StoredSubscription format
    const subs = rows.map((row) => ({
      endpoint: row.endpoint,
      expirationTime: row.expiration_time,
      keys: {
        p256dh: row.p256dh,
        auth: row.auth,
      },
    }));

    res.json(subs);
  } catch (error) {
    console.error("[pushRouter GET /subscriptions] Error:", error);
    res.status(500).json({ error: "Failed to read subscriptions" });
  }
});

// POST /api/push/subscriptions (Write/overwrite all subscriptions)
pushRouter.post("/subscriptions", async (req: Request, res: Response) => {
  try {
    const subs = req.body as any[];
    if (!Array.isArray(subs)) {
      return res.status(400).json({ error: "Expected an array of subscriptions" });
    }

    // Wrap in a transaction to safely overwrite
    await db.transaction().execute(async (trx) => {
      // 1. Delete all existing subscriptions
      await trx.deleteFrom(TABLE_NAMES.PUSH_SUBSCRIPTIONS).execute();

      // 2. Insert new ones if any exist
      if (subs.length > 0) {
        const values = subs.map((sub) => ({
          endpoint: sub.endpoint,
          expiration_time: sub.expirationTime || null,
          p256dh: sub.keys?.p256dh,
          auth: sub.keys?.auth,
        }));
        await trx
          .insertInto(TABLE_NAMES.PUSH_SUBSCRIPTIONS)
          .values(values)
          .execute();
      }
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("[pushRouter POST /subscriptions] Error:", error);
    res.status(500).json({ error: "Failed to write subscriptions" });
  }
});
