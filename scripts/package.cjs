const { build, Platform } = require('electron-builder');
const config = require('../package.json').build;
const path = require('node:path');
build({
  targets: Platform.WINDOWS.createTarget(process.argv.includes('--portable') ? 'dir' : 'nsis'),
  config: {
    ...config,
    electronDist: path.dirname(require('electron')),
    directories: { output: 'release-final' },
  },
}).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
