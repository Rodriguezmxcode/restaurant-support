import { readSession } from '../server/authSession.js';
import { createTransfer, getTransfer, listTransfers, listTransferAudit, receiveTransfer, reconcileTransfer, type TransferItem, type TransferReceiptStatus } from '../server/transferStore.js';

type ApiRequest={method?:string;headers?:{cookie?:string};query?:Record<string,string|string[]>;body?:Record<string,unknown>};
type ApiResponse={status:(code:number)=>ApiResponse;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};
const locations=['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];
function bodyString(value:unknown){return typeof value==='string'?value.trim():'';}
function isCorporate(role:string){return role==='Founder'||role==='Corporate';}
function canUseLocation(user:NonNullable<ReturnType<typeof readSession>>,location:string){return isCorporate(user.role)||user.role==='Kitchen'||user.locations.includes(location);}
function validItems(value:unknown):value is TransferItem[]{return Array.isArray(value)&&value.length>0&&value.every(item=>item&&typeof item==='object'&&typeof (item as TransferItem).name==='string'&&Number.isFinite(Number((item as TransferItem).expectedQty)));}

export default async function handler(req:ApiRequest,res:ApiResponse){
  const user=readSession(req.headers?.cookie); if(!user)return res.status(401).json({error:'Authentication required'});
  res.setHeader?.('Cache-Control','private, no-store');
  try{
    if(!req.method||req.method==='GET'){
      const id=typeof req.query?.id==='string'?req.query.id:'';
      if(id){const transfer=await getTransfer(id);if(!transfer)return res.status(404).json({error:'Transfer not found'});if(!canUseLocation(user,transfer.sourceLocation)&&!canUseLocation(user,transfer.destinationLocation))return res.status(403).json({error:'Transfer outside your location scope'});return res.status(200).json({transfer,audit:await listTransferAudit(id)});}
      return res.status(200).json({transfers:await listTransfers(user)});
    }
    if(req.method==='POST'){
      const source=bodyString(req.body?.sourceLocation),destination=bodyString(req.body?.destinationLocation),notes=bodyString(req.body?.notes);
      if(!locations.includes(source)||!locations.includes(destination)||source===destination)return res.status(400).json({error:'Valid source and destination locations are required'});
      if(!canUseLocation(user,source))return res.status(403).json({error:'You cannot dispatch from this location'});
      if(!validItems(req.body?.items))return res.status(400).json({error:'At least one valid transfer item is required'});
      const items=(req.body?.items as TransferItem[]).map((item,index)=>({id:item.id||`item-${index+1}`,name:item.name.trim(),unit:item.unit?.trim(),expectedQty:Number(item.expectedQty),note:item.note?.trim()}));
      return res.status(201).json({transfer:await createTransfer({sourceLocation:source,destinationLocation:destination,items,notes:notes||undefined},user)});
    }
    if(req.method==='PUT'){
      const id=bodyString(req.body?.id),action=bodyString(req.body?.action); if(!id)return res.status(400).json({error:'Transfer id required'});
      const existing=await getTransfer(id);if(!existing)return res.status(404).json({error:'Transfer not found'});
      if(action==='receive'){
        if(!canUseLocation(user,existing.destinationLocation))return res.status(403).json({error:'Only the receiving location or Corporate can record receipt'});
        const receiptStatus=bodyString(req.body?.receiptStatus) as TransferReceiptStatus; if(!['Complete','Partial','Incomplete'].includes(receiptStatus))return res.status(400).json({error:'Receipt status must be Complete, Partial or Incomplete'});
        const receiverName=bodyString(req.body?.receiverName);if(!receiverName)return res.status(400).json({error:'Receiver name is required'});
        const receivedAt=bodyString(req.body?.receivedAt)||new Date().toISOString(); if(!validItems(req.body?.items))return res.status(400).json({error:'Received item quantities are required'});
        const items=(req.body?.items as TransferItem[]).map((item,index)=>{const expected=Number(item.expectedQty);const received=Math.max(0,Number(item.receivedQty??0));return {id:item.id||`item-${index+1}`,name:item.name.trim(),unit:item.unit?.trim(),expectedQty:expected,receivedQty:received,shortageQty:Math.max(0,expected-received),note:item.note?.trim()};});
        const hasShortage=items.some(item=>(item.shortageQty??0)>0); if(receiptStatus==='Complete'&&hasShortage)return res.status(400).json({error:'A Complete receipt cannot contain shortages'});
        return res.status(200).json({transfer:await receiveTransfer(id,{receiptStatus:receiptStatus as Exclude<TransferReceiptStatus,'Pending'>,receiverName,receivedAt,items,notes:bodyString(req.body?.notes)||undefined},user)});
      }
      if(action==='reconcile'){
        if(!isCorporate(user.role))return res.status(403).json({error:'Only Corporate or Founder can reconcile a transfer'});const reason=bodyString(req.body?.reason);if(!reason)return res.status(400).json({error:'Reconciliation reason is required'});return res.status(200).json({transfer:await reconcileTransfer(id,reason,user)});
      }
      return res.status(400).json({error:'Unsupported transfer action'});
    }
    res.setHeader?.('Allow','GET, POST, PUT');return res.status(405).json({error:'Method not allowed'});
  }catch(error){console.error('[OpsVista Transfers]',error instanceof Error?error.message:error);return res.status(503).json({error:error instanceof Error?error.message:'Transfer ledger unavailable'});}
}
