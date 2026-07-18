const fs = require("fs");
const path = require("path");

function parseEnv(filePath) {
  const env = {};
  try {
    const text = fs.readFileSync(filePath, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const val = line
        .slice(idx + 1)
        .trim()
        .replace(/^"|"$/g, "");
      if (key) env[key] = val;
    }
  } catch (err) {
    console.warn(`PM2 env load skipped for ${filePath}: ${err.message}`);
  }
  return env;
}

// __dirname makes it portable for both local dev testing and production
const basePath = __dirname;
const workerEnv = parseEnv(path.join(basePath, "apps/worker/.env"));
const botEnv = parseEnv(path.join(basePath, "apps/bot/.env"));
const apiEnv = parseEnv(path.join(basePath, "apps/api/.env")); // Future Dashboard API

module.exports = {
  apps: [
    // 1. THE BRAIN (Heavy Lifter)
    {
      name: "sentinel-worker",
      cwd: path.join(basePath, "apps/worker"),
      script: "dist/index.js",
      interpreter: "node",
      // Given slightly more RAM since it processes Torn API payloads
      node_args: ["--max-old-space-size=200"],
      env: { NODE_ENV: "development", ...workerEnv },
      env_production: { NODE_ENV: "production", ...workerEnv },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "300M", // Hard cap
      error_file: "./logs/worker-error.log",
      out_file: "./logs/worker-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      time: true,
      max_size: "10M",
      retain: 3,
    },
    // 2. THE HANDS (Discord Connection)
    {
      name: "sentinel-bot",
      cwd: path.join(basePath, "apps/bot"),
      script: "dist/index.js",
      interpreter: "node",
      // Severely restricted RAM, it just forwards commands and listens to IPC
      node_args: ["--max-old-space-size=100"],
      env: { NODE_ENV: "development", ...botEnv },
      env_production: { NODE_ENV: "production", ...botEnv },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "125M", // Hard cap
      error_file: "./logs/bot-error.log",
      out_file: "./logs/bot-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      time: true,
      max_size: "10M",
      retain: 3,
    },
    // 3. THE BRIDGE (Dashboard Server)
    {
      name: "sentinel-api",
      cwd: path.join(basePath, "apps/api"),
      script: "dist/index.js",
      interpreter: "node",
      // Fastify/Express are tiny. Kept very lean.
      node_args: ["--max-old-space-size=100"],
      env: { NODE_ENV: "development", ...apiEnv },
      env_production: { NODE_ENV: "production", ...apiEnv },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "125M", // Hard cap
      error_file: "./logs/api-error.log",
      out_file: "./logs/api-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      time: true,
      max_size: "10M",
      retain: 3,
    },
  ],

  deploy: {
    production: {
      user: "deji",
      host: "100.96.215.46",
      ref: "origin/main",
      repo: "git@github.com:deji-dd/sentinel.git",
      path: "/home/deji/repos/sentinel",
      "post-deploy":
        "pnpm install && pnpm build && pm2 reload ecosystem.config.js --env production",
    },
  },
};
