module.exports = {
  apps: [
    {
      name: "mirror",
      script: "src/server.js",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "380M",
      env: {
        NODE_ENV: "production",
        PORT: 7000,
        PUBLIC_BASE_URL: "",
        DATA_DIR: "/tmp",
        NODE_OPTIONS: "--max-old-space-size=350",

        // TMDB
        TMDB_API_KEY: "5fcddff5c20144ce3c8e376968a8807d",

        // Kakito / Blaze (Xtream Codes principal)
        IPTV_SERVER: "kakito.xyz",
        IPTV_USERNAME: "MirrorPrincipal",
        IPTV_PASSWORD: "ditj7j1h",
        IPTV_PORT: "443",

        // Space (Xtream Codes)
        XTREAM_SPACE_SERVER: "telaplay93.top",
        XTREAM_SPACE_USER: "LuizDavi@",
        XTREAM_SPACE_PASS: "fBkvnKe5Mq",
        XTREAM_SPACE_PORT: "80",

        // CDN Proxy (Cloudflare Worker)
        CDN_PROXY: "https://mirror-cdn.dev-avmirror.workers.dev",

        // Relay VPS (proxy de streams — se não definido, usa PUBLIC_BASE_URL)
        // RELAY_BASE_URL: "http://IP_DA_VPS_RELAY:7100",

        // NetTV (Xtream Codes)
        XTREAM_NETTV_SERVER: "p2vipserver.top",
        XTREAM_NETTV_USER: "BugouVortex2",
        XTREAM_NETTV_PASS: "69233090",
        XTREAM_NETTV_PORT: "80",
      },
      error_file: "/home/suporte/.pm2/logs/mirror-error.log",
      out_file: "/home/suporte/.pm2/logs/mirror-out.log",
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,

      health_check_url: "http://127.0.0.1:7000/health",
      health_check_grace: 3000,

      node_args: "--max-old-space-size=350 --gc-interval=100",

      log_type: "json",
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",

      listen_timeout: 10000,
      kill_timeout: 5000,
    },
  ],
};
