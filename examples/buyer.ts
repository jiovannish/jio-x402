import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { BatchEvmScheme } from '@circle-fin/x402-batching/client';
import { Buyer } from '../src/buyer.ts';
import { ensure, amount } from '../src/contract.ts';
import { mkdirSync } from 'node:fs';
const {CIRCLE_API_KEY:apiKey,CIRCLE_ENTITY_SECRET:entitySecret,CIRCLE_WALLET_ADDRESS:walletAddress,SELLER_ADDRESS:seller,PUBLIC_ORIGIN:origin,SSH_PUBLIC_KEY:ssh}=process.env;
ensure(apiKey && entitySecret && walletAddress && seller && origin && ssh,'Configure Circle credentials, wallet, seller, origin and SSH_PUBLIC_KEY');
const client=initiateDeveloperControlledWalletsClient({apiKey,entitySecret});
const hex=(s:string|undefined):`0x${string}`=>{ensure(s,'CIRCLE_SIGNATURE_MISSING');return (s.startsWith('0x')?s:`0x${s}`) as `0x${string}`;};
const scheme=new BatchEvmScheme({address:walletAddress as `0x${string}`,signTypedData:async params=>{
 const data=JSON.stringify({domain:{...params.domain,chainId:params.domain.chainId.toString()},primaryType:params.primaryType,types:{EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}],...params.types},message:params.message},(_,v)=>typeof v==='bigint'?v.toString():v);
 return hex((await client.signTypedData({walletAddress,blockchain:'ARC-TESTNET',data})).data?.signature);
}});
mkdirSync('.state',{recursive:true,mode:0o700});
export const buyer=new Buyer(origin,seller,walletAddress as `0x${string}`,async message=>hex((await client.signMessage({walletAddress,blockchain:'ARC-TESTNET',message,encodedByHex:false})).data?.signature),scheme,'.state/buyer.sqlite',process.env.BUDGET_ATOMIC??'10000');
// Funding is a separate deliberate setup operation. This example never deposits,
// replenishes or bridges funds in response to a quote or a 402.
if(import.meta.main){
 try{
  const seconds=Number(process.argv[2]??1800);
  const q=await buyer.quote({operation:'create',configuration_id:'small',duration_seconds:seconds,client_public_key:ssh,max_amount_atomic:amount(seconds)});
  console.log(await buyer.purchase(q,q.quote_id));
  console.log(await buyer.receipt(q.quote_id));
 }catch(e:any){console.error({error:e.code??'BUYER_FAILED',message:e.response?'Circle API error':e.message});process.exitCode=1;}
}
