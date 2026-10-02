const { build, Platform } = require('electron-builder');
const config = require('../package.json').build;
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const sourceRoot = path.resolve(__dirname, '..');
const snapshots = new Map();
function snapshot(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__pycache__') snapshot(file);
    } else if (entry.isFile())
      snapshots.set(path.relative(sourceRoot, file), fs.readFileSync(file));
  }
}
for (const directory of ['core', 'desktop', 'dist', 'voice', 'assets'])
  snapshot(path.join(sourceRoot, directory));
const builderLibrary = require.resolve('app-builder-lib', {
  paths: [path.dirname(require.resolve('electron-builder'))],
});
const asar = require(require.resolve('@electron/asar', { paths: [path.dirname(builderLibrary)] }));
build({
  targets: Platform.WINDOWS.createTarget(process.argv.includes('--portable') ? 'dir' : 'nsis'),
  config: {
    ...config,
    electronDist: path.dirname(require('electron')),
    directories: { output: 'release-final' },
    afterPack: async ({ appOutDir }) => {
      const output = path.resolve(appOutDir);
      const relative = path.relative(path.join(sourceRoot, 'release-final'), output);
      if (relative.startsWith('..') || path.isAbsolute(relative))
        throw Error('Unexpected package output directory.');
      const archive = path.join(output, 'resources', 'app.asar');
      // Builder may have inspected a previous archive at the same path.
      asar.uncache(archive);
      const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
      const expected = require('../package.json');
      if (
        metadata.name !== expected.name ||
        metadata.main !== expected.main ||
        metadata.version !== expected.version
      )
        throw Error('Packaged application metadata is invalid.');
      for (const [file, contents] of snapshots) {
        const packed = asar.extractFile(archive, file);
        if (!packed.equals(contents))
          throw Error(
            `Packaged file differs from the build snapshot: ${file}. Stop editing files during packaging and rebuild.`,
          );
        if (file.endsWith('.cjs')) new vm.Script(packed.toString('utf8'), { filename: file });
      }
      // The custom Electron distribution includes its demo app. A release should
      // contain only JARVIS, with no demo fallback masking a damaged archive.
      fs.rmSync(path.join(output, 'resources', 'default_app.asar'), { force: true });
      console.log(`Verified JARVIS metadata and ${snapshots.size} packaged application files.`);
    },
  },
}).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
