// Ferramenta de manutenção no servidor. Nunca imprime dados de alunos ou segredos.
import fs from 'node:fs';
import path from 'node:path';
import {createStore} from './portal-store.mjs';
import {parseCsv} from './portal-domain.mjs';
const store=createStore(process.env),command=process.argv[2];
try{
 if(command==='backup')console.log('Backup consistente criado:',await store.backup());
 else if(command==='import'){
  const file=process.argv[3];if(!file||!path.isAbsolute(file))throw Error('Informe o caminho absoluto de um CSV privado.');
  const members=await store.members(),admin=members.find(m=>m.role==='admin'&&m.active&&m.email===process.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase());if(!admin)throw Error('Administrador inicial não localizado.');
  const rows=parseCsv(fs.readFileSync(file,'utf8'));await store.backup();const n=await store.import(admin.user_id,rows);console.log(`${n} alunos importados; IDs preservados.`);
 }else throw Error('Use: node portal-maintenance.mjs backup | import /caminho/privado/alunos.csv');
}finally{store.close()}
