// Preserve member IDs and foreign keys when adding the teacher role to an existing installation.
export function migrateMembers(db){
 const table=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='members'").get();
 if(!table||table.sql.includes("'teacher'"))return;
 db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
 try{
  db.exec(`CREATE TABLE members_upgrade(user_id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','secretary','psychologist','social_worker','guardian','teacher')),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));
  INSERT INTO members_upgrade SELECT user_id,email,role,active FROM members;
  DROP TABLE members;
  ALTER TABLE members_upgrade RENAME TO members;`);
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Member migration failed integrity validation.');
  db.exec('COMMIT;');
 }catch(e){db.exec('ROLLBACK;');throw e}finally{db.exec('PRAGMA foreign_keys=ON;')}
}
