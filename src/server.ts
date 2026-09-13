import { randomUUID } from 'node:crypto';
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import { db, transaction } from './db.ts';
import { ensure, Fault, owner, rental, amount, canonical, hash } from './contract.ts';
import { quoteCompute, getComputer } from './compute.ts';
import { requirements, payment, facilitator } from './payment.ts';
import { runWorker } from './worker.ts';
import { openapi } from './openapi.ts';
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
function origin() {
 const value=process.env.PUBLIC_ORIGIN ?? 'http://127.0.0.1:4020';
 const u=new URL(value);
 ensure(u.origin===value && (u.protocol==='https:' || u.hostname==='127.0.0.1'),'INVALID_PUBLIC_ORIGIN',503);
 return value;
}
async function paymentCall<T>(call:Promise<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([call,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('payment timeout')),20000);timer.unref();})]);}
 finally{clearTimeout(timer);}
}
export async function orderStatus(id:string,who:string) {
 const {rows}=await db.query(`SELECT o.id AS order_id,o.payment_status,o.compute_status,o.operation_id,o.computer_id,o.provider_reference,o.payment_response,o.settlement_transaction_hash,q.expires_at AS quote_expires_at,q.terms,q.requirements,
 r.status AS refund_status,r.amount_atomic AS refund_amount_atomic,r.provider_transfer_id AS refund_transfer_id,r.transaction_hash AS refund_transaction_hash
 FROM jio_payments.orders o JOIN jio_payments.quotes q ON q.id=o.quote_id LEFT JOIN jio_payments.refunds r ON r.order_id=o.id WHERE o.id=$1 AND o.owner=$2`,[id,who]);
 ensure(rows[0],'ORDER_NOT_FOUND',404);
 let computer=null;
 if(rows[0].computer_id) try{
  const live=await getComputer(rows[0].computer_id);
  computer={state:live.state,expires_at_unix_seconds:live.expires_at_unix_seconds,last_checked_at_unix_seconds:live.last_checked_at_unix_seconds};
 }catch{/* Missing current data must not present a stale ready VM as live. */}
 return {...rows[0],computer,computer_status_available:computer!==null,status_url:`${origin()}/v1/compute/orders/${id}`,settlement_status:rows[0].payment_status==='settled'?'settled':'unconfirmed'};
}
export async function handle(req:Request):Promise<Response> {
 try {
  const u=new URL(req.url);
  ensure(u.host===new URL(origin()).host,'UNTRUSTED_ORIGIN',400);
  // The loopback listener sits behind TLS termination. Sign the configured
  // public URL, never a client-supplied Forwarded/X-Forwarded-Host value.
  req=new Request(new URL(u.pathname+u.search,origin()).toString(),req);
  if(u.pathname==='/openapi.json' && req.method==='GET') return Response.json(openapi);
  ensure(!u.search,'QUERY_UNSUPPORTED');
  const body=await req.text(); ensure(Buffer.byteLength(body)<=4096,'BODY_TOO_LARGE',413);
  const who=await owner(req,body);
  if(req.method==='POST' && u.pathname==='/v1/compute/quotes') {
   let value; try { value=JSON.parse(body); } catch { throw new Fault(400,'INVALID_JSON'); }
   const request=rental(value), compute=await quoteCompute(request);
   const id=randomUUID(), price=amount(request.duration_seconds), expires=new Date(Date.now()+60000);
   const terms={...request,...compute,total_amount_atomic:price,currency:'USDC',network:'eip155:5042002',price_basis:'proportional_published_resource_rate_no_subscription',purchase_url:`${origin()}/v1/compute/quotes/${id}/purchase`};
   const expected=requirements(price,process.env.SELLER_ADDRESS??'');
   await db.query('INSERT INTO jio_payments.quotes(id,owner,terms,requirements,expires_at) VALUES($1,$2,$3,$4,$5)',[id,who,terms,expected,expires]);
   return Response.json({quote_id:id,...terms,expires_at:expires.toISOString()},{status:201});
  }
  const read=u.pathname.match(new RegExp(`^/v1/compute/orders/(${uuid})(/receipt)?$`));
  if(read && req.method==='GET') return Response.json(await orderStatus(read[1]!,who));
  const match=u.pathname.match(new RegExp(`^/v1/compute/quotes/(${uuid})/purchase$`));
  ensure(match && req.method==='POST','NOT_FOUND',404);
  ensure(body==='' || body==='{}','PURCHASE_BODY_MUST_BE_EMPTY');
  const id=match[1]!, key=req.headers.get('idempotency-key');
  ensure(key && /^[A-Za-z0-9_-]{1,64}$/.test(key),'IDEMPOTENCY_KEY_REQUIRED');
  const digest=hash(canonical({quote_id:id,body}));
  const previous=await db.query('SELECT id,request_hash FROM jio_payments.orders WHERE owner=$1 AND idempotency_key=$2',[who,key]);
  if(previous.rows[0]) {
   ensure(previous.rows[0].request_hash===digest,'IDEMPOTENCY_CONFLICT',409);
   return Response.json(await orderStatus(previous.rows[0].id,who),{status:202});
  }
  const quote=(await db.query('SELECT * FROM jio_payments.quotes WHERE id=$1 AND owner=$2',[id,who])).rows[0];
  ensure(quote,'QUOTE_NOT_FOUND',404);
  ensure(new Date(quote.expires_at).getTime()>Date.now(),'QUOTE_EXPIRED',410);
  const header=req.headers.get('payment-signature');
  if(!header) {
   const required={x402Version:2,resource:{url:req.url,description:'One Jio small computer rental',mimeType:'application/json'},accepts:[quote.requirements]};
   return Response.json(required,{status:402,headers:{'PAYMENT-REQUIRED':encodePaymentRequiredHeader(required)}});
  }
  const p=payment(header,quote.requirements,req.url);
  ensure(p.payer===who,'PAYER_OWNER_MISMATCH',403);
  // Recheck capacity before charging; this is explicitly not a reservation.
  await quoteCompute(quote.terms);
  const claimed=await transaction(async c=>{
   await c.query('SELECT id FROM jio_payments.quotes WHERE id=$1 FOR UPDATE',[id]);
   const prior=(await c.query('SELECT id,owner,idempotency_key,request_hash FROM jio_payments.orders WHERE quote_id=$1',[id])).rows[0];
   if(prior) { ensure(prior.owner===who && prior.idempotency_key===key && prior.request_hash===digest,'QUOTE_ALREADY_PURCHASED',409); return false; }
   const current=(await c.query('SELECT expires_at>now() AS valid FROM jio_payments.quotes WHERE id=$1',[id])).rows[0];
   ensure(current.valid,'QUOTE_EXPIRED',410);
   await c.query(`INSERT INTO jio_payments.orders(id,quote_id,owner,idempotency_key,request_hash,authorization_id,payer,nonce,payment_status,retry_at) VALUES($1,$1,$2,$3,$4,$5,$6,$7,'submitting',now()+interval '45 seconds')`,[id,who,key,digest,p.identity,p.payer,p.nonce]);
   return true;
  });
  if(!claimed) return Response.json(await orderStatus(id,who),{status:202});
  // The attempt is durable before the network call. No transaction spans it.
  let response;
  try {
   const verified=await paymentCall(facilitator.verify({...p.payload,resource:{url:req.url,description:p.payload.resource?.description??'',mimeType:p.payload.resource?.mimeType??'application/json'}},quote.requirements));
   if(!verified.isValid || verified.payer?.toLowerCase()!==who) {
    await db.query("UPDATE jio_payments.orders SET payment_status='rejected',compute_status='failed' WHERE id=$1 AND payment_status='submitting'",[id]);
    return Response.json({error:'PAYMENT_REJECTED',order_id:id,status_url:`${origin()}/v1/compute/orders/${id}`},{status:402});
   }
   response=await paymentCall(facilitator.settle({...p.payload,resource:{url:req.url,description:p.payload.resource?.description??'',mimeType:p.payload.resource?.mimeType??'application/json'}},quote.requirements));
  } catch {
   await db.query("UPDATE jio_payments.orders SET payment_status='unknown' WHERE id=$1 AND payment_status='submitting'",[id]);
   return Response.json(await orderStatus(id,who),{status:202});
  }
  // Ambiguous/nonce-used responses need reconciliation, not another signature.
  const accepted=response.success && response.payer?.toLowerCase()===p.payer && response.network===quote.requirements.network;
  await db.query("UPDATE jio_payments.orders SET payment_status=$2,payment_response=$3,retry_at=now() WHERE id=$1 AND payment_status IN ('submitting','unknown')",[id,accepted?'accepted':'unknown',response]);
  return Response.json(await orderStatus(id,who),{status:202,headers:accepted?{'PAYMENT-RESPONSE':encodePaymentResponseHeader({...response,network:quote.requirements.network})}:{}});
 } catch(e:any) {
  // Never log request headers, payment signatures, provider bodies or secrets.
  if(e?.code==='23505') return Response.json({error:'PAYMENT_OR_IDEMPOTENCY_REPLAY'},{status:409});
  return Response.json({error:e instanceof Fault?e.code:'REQUEST_FAILED'},{status:e instanceof Fault?e.status:500});
 }
}
if(import.meta.main) {
 ensure(process.env.DATABASE_URL,'DATABASE_URL_REQUIRED',503);
 const service=Bun.serve({hostname:'127.0.0.1',port:Number(process.env.PORT??4020),maxRequestBodySize:4096,idleTimeout:60,fetch:handle});
 console.log(`Jio payments listening on ${service.url}`);
 await runWorker();
}
