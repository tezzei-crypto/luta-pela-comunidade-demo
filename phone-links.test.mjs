import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeWhatsAppPhone as number,whatsAppUrl as url} from './dist/portal/phone-links.js';
test('WhatsApp: formatos brasileiros, DDD 55, internacional explícito e número fixo',()=>{
 for(const raw of ['(24) 98182-6950','24981826950','5524981826950','+55 24 98182-6950'])assert.equal(number(raw),'5524981826950');
 assert.equal(number('55981826950'),'5555981826950');assert.equal(number('+55 (55) 98182-6950'),'5555981826950');
 assert.equal(number('(21) 2345-6789'),'552123456789');assert.equal(number('+1 (202) 555-0123'),'12025550123');
 assert.equal(url('24 98182-6950'),'https://wa.me/5524981826950');
});
test('WhatsApp: dados incompletos, texto, ramal, URLs e números inválidos não abrem outro contato',()=>{
 for(const raw of [null,'','98182-6950','(20) 98182-6950','(24) 08182-6950','00000000000','(24) 98182-6950 ramal 2','javascript:alert(1)','https://wa.me/5524981826950','+55+24981826950','55249818269501234','+55 98182-6950'])assert.equal(url(raw),'',String(raw));
});
