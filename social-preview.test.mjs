import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {withSocialPreview} from './social-preview.mjs';

test('social preview is rendered in the head, preserves the body and uses a public HTTPS image', () => {
  const html = '<html><head><title>Amavale &amp; projeto</title><meta name="description" content="Conheça o projeto."></head><body>Conteúdo</body></html>';
  const result = withSocialPreview(html, '/unidades/amavale/');
  assert.match(result, /property="og:title" content="Amavale &amp; projeto"/);
  assert.match(result, /property="og:description" content="Conheça o projeto\."/);
  assert.match(result, /property="og:url" content="https:\/\/www\.lutapelacomunidade\.com\.br\/unidades\/amavale\/"/);
  assert.match(result, /property="og:image" content="https:\/\/www\.lutapelacomunidade\.com\.br\/social-preview-v1\.png"/);
  assert.ok(result.indexOf('og:image') < result.indexOf('</head>'));
  assert.ok(result.endsWith('<body>Conteúdo</body></html>'));
});

test('private portals share only a generic team title and image metadata escapes markup', () => {
  const result = withSocialPreview('<head><title>Dados particulares</title></head>', '/administracao/');
  assert.match(result, /og:title" content="Luta pela Comunidade — Área da equipe"/);
  assert.doesNotMatch(result, /og:title" content="Dados particulares/);
  assert.match(withSocialPreview('<head><title>&quot;&lt;script&gt;</title></head>', '//evil.example/'), /og:url" content="https:\/\/www\.lutapelacomunidade\.com\.br\/"/);
  assert.match(withSocialPreview('<head><title>&quot;&lt;script&gt;</title></head>', '/'), /og:title" content="&quot;&lt;script&gt;"/);
});

test('all shipped HTML pages receive exactly one share image and the declared image dimensions match', () => {
  function scan(dir) {return fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? scan(`${dir}/${entry.name}`) : entry.name.endsWith('.html') ? [`${dir}/${entry.name}`] : []);}
  for (const file of scan(new URL('./dist', import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'))) {
    const html = fs.readFileSync(file, 'utf8');
    assert.equal((withSocialPreview(html, '/').match(/property="og:image"/g) || []).length, 1, file);
  }
  const png = fs.readFileSync(new URL('./dist/social-preview-v1.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 1734);
  assert.equal(png.readUInt32BE(20), 907);
  assert.ok(png.length < 2 * 1024 * 1024);
});
