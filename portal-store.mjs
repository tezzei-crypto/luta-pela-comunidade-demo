import {createSqliteStore} from './portal-sqlite.mjs';
const stores=new Map();
export const portalConfigured=env=>!!env.PORTAL_DATA_DIR&&env.PORTAL_SECRET?.length>=32;
export function createStore(env=process.env){
 if(!portalConfigured(env))throw Object.assign(Error('Armazenamento privado ainda não configurado.'),{status:503});
 const key=env.PORTAL_DATA_DIR+'|'+env.PORTAL_SECRET;
 if(!stores.has(key))stores.set(key,createSqliteStore(env));
 return stores.get(key);
}
