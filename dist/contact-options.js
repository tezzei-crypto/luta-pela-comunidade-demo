export const contactProfiles = Object.freeze({
 sponsor: 'Patrocinador',
 participant: 'Interessado em fazer parte do projeto',
 family: 'Pais e responsáveis'
});
export const contactUnits = Object.freeze({amavale:'Amavale',valparaiso:'Valparaíso','vale-do-carangola':'Vale do Carangola'});
export function contactMessage(profile,unit=''){
 if(!Object.hasOwn(contactProfiles,profile)||unit&&!Object.hasOwn(contactUnits,unit))throw Error('Escolha uma opção válida.');
 return 'Luta pela Comunidade\n'+({sponsor:'Olá! Tenho interesse em patrocinar ou apoiar o projeto.',participant:'Olá! Tenho interesse em fazer parte do projeto.',family:'Olá! Sou pai, mãe ou responsável e gostaria de falar com a secretaria.'}[profile])+(unit?'\nNúcleo: '+contactUnits[unit]+'.':'')+'\nPodem me orientar?';
}
