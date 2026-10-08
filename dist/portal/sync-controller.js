export function createSyncController({readRevision,refresh,isEditing,isActive,onPending=()=>{},onUpdated=()=>{},onError=()=>{}}){
 let revision='',busy=false,generation=0;
 return {
  reset(){revision='';generation++;busy=false},
  async poll(){if(busy||!isActive())return;busy=true;const own=generation;
   try{const result=await readRevision();if(own!==generation||!isActive())return;if(!revision){revision=result.revision;return}if(result.revision===revision)return;
    if(isEditing()){onPending();return}await refresh();if(own!==generation||!isActive())return;revision=result.revision;onUpdated();
   }catch(error){if(own===generation&&isActive())onError(error)}finally{if(own===generation)busy=false}
  }
 };
}
