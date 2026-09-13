// Real Circle and Jio APIs. Reruns recover the same purchase, never a fresh charge.
import { buyer } from './buyer.ts';
import { ensure } from '../src/contract.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const path='.state/live-quote.json';
try{
 const q=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):await buyer.quote({operation:'create',configuration_id:'small',duration_seconds:1800,client_public_key:process.env.SSH_PUBLIC_KEY!,max_amount_atomic:'4275'});
 writeFileSync(path,JSON.stringify(q),{mode:0o600});
 const first=await buyer.purchase(q,q.quote_id) as any;
 const retry=await buyer.purchase(q,q.quote_id) as any;
 ensure(first.order_id===retry.order_id,'RETRY_CHANGED_ORDER');
 console.log({order:first.order_id,payment:first.payment_status,retry_same_order:true});
 for(let i=0;i<40;i++){
  const receipt=await buyer.receipt(q.quote_id) as any;
  writeFileSync('docs/live-payment.json',JSON.stringify({checked_at:new Date().toISOString(),...receipt},null,2)+'\n');
  if(receipt.compute_status==='ready'||receipt.compute_status==='failed'){
   console.log({order:receipt.order_id,payment:receipt.payment_status,compute:receipt.compute_status,computer:receipt.computer_id,refund:receipt.refund_status});
   ensure(receipt.compute_status==='ready','COMPUTE_FAILED');break;
  }
  if(i===39) throw new Error('Order pending; rerun to recover');
  await Bun.sleep(3000);
 }
}catch(e:any){console.error({error:e.code??'LIVE_TEST_FAILED',message:e.response?'Circle API error':e.message});process.exitCode=1;}
