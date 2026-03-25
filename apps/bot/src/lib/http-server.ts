import express, { type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { type Client } from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "./db-client.js";
import { DatabaseIPRateLimiter } from "./assist-ip-rate-limiter.js";
import { getAllowedOrigins } from "./bot-config.js";
import { MagicLinkService } from "../services/magic-link-service.js";
import {
  webhookRouter,
  authRouter,
  configRouter,
  registerMapRoutes,
  registerAssistRoutes,
} from "../server/routes/index.js";
import {
  buildAssistButton,
  buildInitialAssistEmbed,
  createAssistTrackingStore,
  getAssistPayloadSizeBytes,
  getClientIp,
  isValidUuid,
  resolveStatusFieldValue,
  upsertEmbedField,
} from "../server/routes/assist/assist-support.js";
import {
  enrichAssistEmbed,
  incrementAssistStrikeByUuid,
} from "../server/routes/assist/assist-service.js";

const app = express();
app.set("trust proxy", 1);

// Health check - BEFORE any middleware to diagnose hangs
app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, ts: Date.now() });
});

app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);
app.use(express.json());
app.use(
  cors({
    origin: (origin, callback) => {
      const allowed = getAllowedOrigins();
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);

// Rate limiting for Map Painter API
const mapRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: {
    error:
      "Too many requests from this IP for Map Painter, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for Assist API (general flood protection)
const assistRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  message: {
    error:
      "Too many requests from this IP for Assist API, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

let discordClient: Client;
let ipRateLimiter: DatabaseIPRateLimiter;

// Proxy header removed
const ASSIST_ALLOWED_PROXY_METHODS = new Set(["POST", "PATCH", "DELETE"]);
const parsedAssistMaxPayloadBytes = Number.parseInt(
  process.env.ASSIST_MAX_PAYLOAD_BYTES || "16384",
  10,
);
const ASSIST_MAX_PAYLOAD_BYTES =
  Number.isFinite(parsedAssistMaxPayloadBytes) &&
  parsedAssistMaxPayloadBytes > 0
    ? parsedAssistMaxPayloadBytes
    : 16384;
const ASSIST_SLOW_DELIVERY_WARN_MS = 1000; // Flag transport lag at 1s+

const ASSIST_EMBED_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const assistTracking = createAssistTrackingStore(ASSIST_EMBED_TIMEOUT_MS);

/**
 * Initialize the HTTP server with Discord and database clients
 */
export function initHttpServer(client: Client, port: number = 3001) {
  discordClient = client;
  ipRateLimiter = new DatabaseIPRateLimiter(
    db,
    TABLE_NAMES.ASSIST_IP_RATE_LIMITS,
    TABLE_NAMES.ASSIST_SCRIPT_GENERATION_LIMITS,
  );
  const magicLinkService = new MagicLinkService(client);

  app.locals.discordClient = client;
  app.locals.magicLinkService = magicLinkService;

  // Health check endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      bot: discordClient.user?.tag || "not ready",
      timestamp: new Date().toISOString(),
    });
  });

  registerAssistRoutes({
    app,
    assistRateLimiter,
    ipRateLimiter,
    discordClient,
    port,
    allowedProxyMethods: ASSIST_ALLOWED_PROXY_METHODS,
    maxPayloadBytes: ASSIST_MAX_PAYLOAD_BYTES,
    slowDeliveryWarnMs: ASSIST_SLOW_DELIVERY_WARN_MS,
    isValidUuid,
    getClientIp,
    getAssistPayloadSizeBytes,
    resolveStatusFieldValue,
    buildInitialAssistEmbed,
    upsertEmbedField,
    getActiveTrackedAssist: assistTracking.getActiveTrackedAssist,
    scheduleAssistExpiry: assistTracking.scheduleAssistExpiry,
    buildAssistButton,
    incrementAssistStrikeByUuid,
    enrichAssistEmbed,
    setTrackedAssist: assistTracking.setTrackedAssist,
    clearTrackedAssist: assistTracking.clearTrackedAssist,
  });

  registerMapRoutes({
    app,
    mapRateLimiter,
    client,
    discordClient,
    magicLinkService,
  });

  // Keep legacy webhook paths stable for worker integrations.
  app.use("/", webhookRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/config", configRouter);

  // Start server
  app.listen(port, () => {
    console.log(`[HTTP] Server listening on port ${port}`);
  });

  return app;
}
