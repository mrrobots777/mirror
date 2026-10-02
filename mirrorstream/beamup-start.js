#!/usr/bin/env node
console.log(
  "[beamup-start] argv=" + JSON.stringify(process.argv.slice(1)) +
  " cwd=" + process.cwd() +
  " PORT=" + process.env.PORT +
  " NODE_ENV=" + process.env.NODE_ENV +
  " PUBLIC_BASE_URL=" + process.env.PUBLIC_BASE_URL +
  " DATA_DIR=" + process.env.DATA_DIR +
  " SCRAPER_TIMEOUT_MS=" + process.env.SCRAPER_TIMEOUT_MS +
  " BEAMUP_TEST_ENV=" + process.env.BEAMUP_TEST_ENV
);
require("/app/mirrorstream/src/server.js");
