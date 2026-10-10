// Synthetic, isolated fixtures for authorization tests. Never used by the server.
export async function fixtureTeacher(store,admin,units=['amavale'],email='fixture-teacher@example.test'){
 return store.saveTeacher(admin,null,{name:'Docente Fictício '+email.split('@')[0],email,phone:'24999999999',status:'pending',test_access:true,units,version:0});
}
export async function fixtureGroup(store,admin,unit,students=[],label='Turma de teste'){
 const teacher=await fixtureTeacher(store,admin,[unit],unit+'-'+Math.random().toString(36).slice(2)+'@example.test');
 return store.saveGroup(admin,null,{unit,label,students,teachers:[teacher.user_id],weekdays:[0,1,2,3,4,5,6],start_time:'18:00',end_time:'19:00',active:true,version:0});
}
