#!/usr/bin/env node
// A stable entry point, so pnpm can link the command at install time, before dist/ is built.
import "../dist/index.js";
