// PM2 process definition. On the server, from the repository root:
//   pm2 start deploy/ecosystem.config.cjs && pm2 save
// Later restarts: pm2 restart akanksha-ai
//
// The server reads the root .env at start (dotenv in server/src/index.js); nothing secret lives here.
const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "akanksha-ai",
      cwd: path.resolve(__dirname, "../server"),
      script: "src/index.js",
      instances: 1, // one process: sessions, caches and the nightly check live in memory
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
      time: true,
    },
  ],
};
