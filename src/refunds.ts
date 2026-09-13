// Operator treasury worker: separate process, credentials never reach the guest.
import { initiateDeveloperControlledWalletsClient, type CircleDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { db } from './db.ts';
import { ASSET, ensure, atomic } from './contract.ts';
type Treasury=Pick<CircleDeveloperControlledWalletsClient,'createContractExecutionTransaction'|'getTransaction'>;
export async function processRefund(id:string,client:Treasury){
 const lock=await db.connect();
 try{
  await lock.query("SELECT pg_advisory_lock(hashtextextended('jio-refund:'||$1,0))",[id]);
  const r=(await db.query(`SELECT r.*,o.payer,o.payment_status,q.terms,q.requirements FROM jio_payments.refunds r JOIN jio_payments.orders o ON o.id=r.order_id JOIN jio_payments.quotes q ON q.id=o.quote_id WHERE r.order_id=$1`,[id])).rows[0];
  ensure(r,'REFUND_NOT_FOUND',404);
  ensure(['accepted','settled'].includes(r.payment_status) && r.recipient===r.payer && /^0x[0-9a-f]{40}$/.test(r.recipient) && r.amount_atomic===r.terms.total_amount_atomic && atomic(r.amount_atomic)>0n,'REFUND_BINDING_INVALID');
  ensure(r.requirements.payTo.toLowerCase()===process.env.SELLER_ADDRESS?.toLowerCase(),'REFUND_SELLER_CHANGED');
  if(r.status==='confirmed') return r.status;
  let transfer=r.provider_transfer_id;
  if(!transfer){
   // ponytail: ambiguous submissions older than an hour need operator lookup;
   // never assume a provider's deduplication retention is unlimited.
   ensure(!r.attempted_at || Date.now()-new Date(r.attempted_at).getTime()<3600000,'REFUND_REQUIRES_OPERATOR_LOOKUP');
   await db.query('UPDATE jio_payments.refunds SET attempted_at=COALESCE(attempted_at,now()) WHERE order_id=$1',[id]);
   transfer=(await client.createContractExecutionTransaction({walletAddress:r.requirements.payTo,blockchain:'ARC-TESTNET',contractAddress:ASSET,abiFunctionSignature:'transfer(address,uint256)',abiParameters:[r.recipient,r.amount_atomic],fee:{type:'level',config:{feeLevel:'MEDIUM'}},idempotencyKey:id})).data?.id;
   ensure(transfer,'REFUND_SUBMISSION_UNKNOWN',503);
   await db.query("UPDATE jio_payments.refunds SET provider_transfer_id=$2,status='submitted' WHERE order_id=$1",[id,transfer]);
  }
  const tx=(await client.getTransaction({id:transfer})).data?.transaction;
  if(tx && ['COMPLETE','CONFIRMED'].includes(tx.state)){
   await db.query("UPDATE jio_payments.refunds SET status='confirmed',transaction_hash=$2 WHERE order_id=$1",[id,tx.txHash??null]);return 'confirmed';
  }
  ensure(!tx || !['FAILED','DENIED','CANCELLED'].includes(tx.state),'REFUND_REQUIRES_OPERATOR_REVIEW',503);
  return 'submitted';
 }finally{await lock.query("SELECT pg_advisory_unlock(hashtextextended('jio-refund:'||$1,0))",[id]);lock.release();}
}
if(import.meta.main){
 try{
  const {CIRCLE_API_KEY:apiKey,CIRCLE_ENTITY_SECRET:entitySecret}=process.env;
  ensure(apiKey && apiKey.startsWith('TEST_API_KEY:') && entitySecret,'CIRCLE_TESTNET_TREASURY_REQUIRED');
  const id=process.argv[2];ensure(id && /^[0-9a-f-]{36}$/.test(id),'ORDER_ID_REQUIRED');
  console.log({order:id,refund:await processRefund(id,initiateDeveloperControlledWalletsClient({apiKey,entitySecret}))});
 }catch(e:any){console.error({error:e.code??'REFUND_UNKNOWN',message:e.response?'Circle API error':e.message});process.exitCode=1;}
 finally{await db.end();}
}
