#!/usr/bin/env node
const os = require("os");
console.log("[sonda] hostname=" + os.hostname());
console.log("[sonda] chaves de env: " + Object.keys(process.env).sort().join(","));
require("/app/mirrorstream/src/server.js");
