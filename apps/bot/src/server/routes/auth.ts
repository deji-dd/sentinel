import { Router, type Request, type Response } from "express";
import { getUiUrl } from "../../lib/bot-config.js";
import { getServerContext } from "../context.js";

// Make sure discordClient and magicLinkService are passed via res.locals or req object
export const authRouter = Router();

authRouter.get("/magic-link", async (req: Request, res: Response) => {
  const token = req.query.token as string;
  const uiUrl = getUiUrl();
  const { magicLinkService } = getServerContext(req);

  if (!token) {
    return res.redirect(`${uiUrl}/?error=missing_token`);
  }

  try {
    const activation = await magicLinkService.activateToken(token);
    if (!activation) {
      return res.redirect(`${uiUrl}/?error=invalid_token`);
    }

    const redirectUrl = new URL(uiUrl + activation.targetPath);
    redirectUrl.searchParams.set("session", activation.sessionToken);

    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error("[AUTH] Error activated Magic Link:", error);
    res.redirect(`${uiUrl}/?error=activation_failed`);
  }
});

authRouter.get("/me", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService, discordClient } = getServerContext(req);

  try {
    const session = await magicLinkService.validateSession(token);
    if (!session)
      return res.status(401).json({ error: "Invalid or expired session" });

    // Fetch user profile from Discord cache/API (we only need basic info)
    try {
      const user = await discordClient.users.fetch(session.discord_id);
      res.json({
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        global_name: user.globalName,
        scope: session.scope,
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_err) {
      // Fallback to minimal data if fetch fails
      res.json({
        id: session.discord_id,
        username: "Unknown User",
        avatar: null,
        global_name: "Unknown User",
        scope: session.scope,
      });
    }
  } catch (error) {
    console.error("[AUTH] Error validating session:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

authRouter.post("/sign-out", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  const { magicLinkService } = getServerContext(req);

  if (token) {
    await magicLinkService.terminateSession(token);
  }
  return res.json({ success: true });
});
