import { readSession } from '../server/authSession.js';
import { createPayment, decidePayment, getPayment, issuePayment, listPayments, paymentAudit } from '../server/paymentStore.js';

type ApiRequest={method?:string;headers?:{cookie?:string};query?:Record<string,string|string[]>;body?:Record<string,unknown>};
type ApiResponse={status:(code:number)=>ApiResponse;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};
const locations=['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const isApprover=(role:string)=>role==='Founder'||role==='Corporate';
const isIssuer=(role:string)=>role==='Administration';
const canUseLocation=(u:NonNullable<ReturnType<typeof readSession>>,location:string)=>isApprover(u.role)||u.role==='Administration'||u.locations.includes(location);

export default async function handler(req:ApiRequest,res:ApiResponse){
 const user=readSession(req.headers?.cookie);if(!user)return res.status(401).json({error:'Authentication required'});res.setHeader?.('Cache-Control','private, no-store');
 try{
  if(!req.method||req.method==='GET'){
   const id=typeof req.query?.id==='string'?req.query.id:'';
   if(id){const payment=await getPayment(id);if(!payment)return res.status(404).json({error:'Payment request not found'});if(!canUseLocation(user,payment.location)&&payment.requestedById!==user.id)return res.status(403).json({error:'Payment request outside your scope'});return res.status(200).json({payment,audit:await paymentAudit(id)});}
   return res.status(200).json({payments:await listPayments(user)});
  }
  if(req.method==='POST'){
   const location=text(req.body?.location),requestDate=text(req.body?.requestDate),title=text(req.body?.title),payee=text(req.body?.payee),reason=text(req.body?.reason),amount=Number(req.body?.amount);
   if(!locations.includes(location)||!canUseLocation(user,location))return res.status(403).json({error:'You cannot request payment for this location'});
   if(!requestDate||!title||!payee||!reason||!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Date, title, payee, amount and reason are required'});
   return res.status(201).json({payment:await createPayment({location,requestDate,title,payee,amount,reason},user)});
  }
  if(req.method==='PUT'){
   const id=text(req.body?.id),action=text(req.body?.action);if(!id)return res.status(400).json({error:'Payment id required'});
   if(action==='approve'||action==='reject'){
    if(!isApprover(user.role))return res.status(403).json({error:'Only Corporate or Founder can approve or reject payments'});
    const note=text(req.body?.note);return res.status(200).json({payment:await decidePayment(id,action==='approve'?'Approved':'Rejected',note,user)});
   }
   if(action==='issue'){
    if(!isIssuer(user.role))return res.status(403).json({error:'Only Administration can issue approved payments'});
    const checkNumber=text(req.body?.checkNumber),checkDate=text(req.body?.checkDate),note=text(req.body?.note);
    if(!checkNumber||!checkDate)return res.status(400).json({error:'Check number and check date are required'});
    return res.status(200).json({payment:await issuePayment(id,{checkNumber,checkDate,note:note||undefined},user)});
   }
   return res.status(400).json({error:'Unsupported payment action'});
  }
  res.setHeader?.('Allow','GET, POST, PUT');return res.status(405).json({error:'Method not allowed'});
 }catch(error){console.error('[OpsVista Payments]',error instanceof Error?error.message:error);return res.status(503).json({error:error instanceof Error?error.message:'Payment workflow unavailable'});}
}
