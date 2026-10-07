import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createStore,portalConfigured} from './portal-store.mjs';
import {parseCsv} from './portal-domain.mjs';
// One-time import from Render Secret Files. No private roster is part of this repository.
export async function initializePortal(env=process.env){
 if(!env.BOOTSTRAP_STUDENTS_FILE||!portalConfigured(env))return;
 const source=env.BOOTSTRAP_STUDENTS_FILE;if(!path.isAbsolute(source))throw Error('Initial roster must be a private absolute path.');
 const content=fs.readFileSync(source,'utf8'),digest=createHash('sha256').update(content).digest('hex');
 const store=createStore(env),marker=path.join(env.PORTAL_DATA_DIR,'initial-import-'+digest+'.done');
 if(fs.existsSync(marker))return;
 const rows=parseCsv(content),members=await store.members(),admin=members.find(m=>m.active&&m.role==='admin'&&m.email===env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase());
 if(!admin)throw Error('Initial administrator unavailable.');
 const current=await store.students();
 if(current.length===0){await store.import(admin.user_id,rows);console.log('Initial private roster imported:',rows.length)}
 else if(rows.some(r=>!current.some(s=>s.id===r.id&&s.name===r.name&&s.birth_date===r.birth_date)))throw Error('Initial roster differs from the existing database. Manual review required.');
 await store.backup();fs.writeFileSync(marker,new Date().toISOString(),{mode:0o600});
}
