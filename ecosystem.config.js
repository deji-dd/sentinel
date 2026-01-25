module.exports = {
  apps: [
    {
      name: "sentinel-worker",
      cwd: "/home/deji/repos/sentinel/apps/worker",
      script: "dist/index.js",
      interpreter: "node",
      node_args: ["--env-file=.env"],
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "250M",
      env: {
        NODE_ENV: "production",
      },
      error_file: "./logs/worker-error.log",
      out_file: "./logs/worker-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      time: true,
      // Restart strategy for stability
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 4000,
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: false,
      listen_timeout: 3000,
    },
    {
      name: "sentinel-bot",
      cwd: "/home/deji/repos/sentinel/apps/bot",
      script: "dist/index.js",
      interpreter: "node",
      node_args: ["--env-file=.env"],
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "250M",
      env: {
        NODE_ENV: "production",
      },
      error_file: "./logs/bot-error.log",
      out_file: "./logs/bot-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      time: true,
      // Restart strategy for stability
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 4000,
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: false,
      listen_timeout: 3000,
    },
  ],

  deploy: {
    production: {
      user: "deji",
      host: "100.96.215.46",
      ref: "origin/main",
      repo: "git@github.com:deji-dd/sentinel.git",
      path: "/home/deji/repos/sentinel",
      "pre-deploy-local": "",
      "post-deploy":
        "pnpm install && pnpm build:all && pm2 reload ecosystem.config.js --env production",
      "pre-setup": "",
    },
  },
};
