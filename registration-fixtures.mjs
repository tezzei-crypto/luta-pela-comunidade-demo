import {randomUUID} from 'node:crypto';
export const completeRegistrationAttachments=()=>[
 ...['studentDocument','guardianDocument','medicalCertificate'].map(key=>({filename:key+'.pdf',content:Buffer.from('%PDF-1.7 DOCUMENTO FICTICIO').toString('base64')})),
 {filename:'photo.jpg',content:Buffer.from([255,216,255,0]).toString('base64')}
];
export const completeRegistrationDocuments=()=>['student_document','guardian_document','medical_certificate','photo'].map(kind=>({id:randomUUID(),kind,object_path:'fixture/'+randomUUID(),original_name:'FICTICIO',mime:kind==='photo'?'image/jpeg':'application/pdf',size:20}));
