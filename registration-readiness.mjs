// Requirements already stated in the public registration form. Uploads still need human review.
export function registrationReadiness(row){
 const documents=typeof row.documents==='string'?JSON.parse(row.documents):row.documents||[];
 const required={student_document:'Documento do aluno',guardian_document:'Documento do responsável',medical_certificate:'Atestado médico',photo:'Foto de registro'};
 const online_consent=row.source!=='staff'&&row.consent_version==='2026-10-07-portal';
 const consent_attachment=documents.some(d=>d.kind==='consent');
 const missing=Object.entries(required).filter(([kind])=>!documents.some(d=>d.kind===kind)).map(([,label])=>label);
 if(!online_consent&&!consent_attachment)missing.push('Comprovação da autorização do responsável');
 return {online_consent,consent_attachment,missing,ready:missing.length===0};
}
