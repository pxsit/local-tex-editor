const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const common = {
  bundle: true,
  format: 'esm',
  minify: true,
  sourcemap: true,
  target: 'es2022',
  logLevel: 'info',
  loader: { '.svg': 'text' },
};

(async () => {
  await Promise.all([
    esbuild.build({
      ...common,
      entryPoints: [path.join(__dirname, 'src/app/main.js')],
      outfile: path.join(__dirname, 'public/app.js'),
    }),
    esbuild.build({
      ...common,
      entryPoints: [path.join(__dirname, 'src/viewer/main.js')],
      outfile: path.join(__dirname, 'public/viewer.js'),
    }),
  ]);
  fs.copyFileSync(
    path.join(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),
    path.join(__dirname, 'public/pdf.worker.min.mjs'),
  );
  console.log('build done');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
