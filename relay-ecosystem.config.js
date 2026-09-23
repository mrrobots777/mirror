module.exports = {
  apps: [
    {
      name: "mirror-relay",
      script: "relay-server.js",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "380M",
      env: {
        NODE_ENV: "production",
        PORT: 7100,
        NODE_OPTIONS: "--max-old-space-size=350",
      },
      error_file: "/home/suporte/.pm2/logs/mirror-relay-error.log",
      out_file: "/home/suporte/.pm2/logs/mirror-relay-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,

      health_check_url: "http://127.0.0.1:7100/health",
      health_check_grace: 3000,

      node_args: "--max-old-space-size=350 --gc-interval=100",
      listen_timeout: 10000,
      kill_timeout: 5000,
    },
  ],
};
