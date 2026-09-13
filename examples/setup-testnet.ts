// Explicit, resumable testnet setup. Never called by the purchase flow.
import { initiateDeveloperControlledWalletsClient, registerEntitySecretCiphertext } from '@circle-fin/developer-controlled-wallets';
import { CHAIN_CONFIGS } from '@circle-fin/x402-batching/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
process.umask(0o077);
mkdirSync('.state',{recursive:true,mode:0o700});
const path='.state/circle-setup.json';
const state:any=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{entitySecret:randomBytes(32).toString('hex'),walletSetKey:randomUUID(),walletsKey:randomUUID(),approveKey:randomUUID(),depositKey:randomUUID()};
function save(){writeFileSync(`${path}.tmp`,JSON.stringify(state,null,2),{mode:0o600});renameSync(`${path}.tmp`,path);}
save();
const apiKey=readFileSync('.state/circle-api.key.txt','utf8').trim();
if(!apiKey.startsWith('TEST_API_KEY:')) throw new Error('Testnet key required');
const client=initiateDeveloperControlledWalletsClient({apiKey,entitySecret:state.entitySecret});
async function wait(id:string){
 for(let i=0;i<60;i++){
  const tx=(await client.getTransaction({id})).data?.transaction;
  if(tx?.state==='COMPLETE'||tx?.state==='CONFIRMED') return;
  if(['FAILED','DENIED','CANCELLED'].includes(tx?.state??'')) throw new Error(`Transaction ${id}: ${tx?.state}`);
  await Bun.sleep(3000);
 }
 throw new Error(`Transaction ${id} pending; rerun setup to resume`);
}
try{
 if(!state.registered){
  // Never rotate an existing entity secret. Registration is first-use only.
  const log=console.log; console.log=()=>{};
  try{
   const result=await registerEntitySecretCiphertext({apiKey,entitySecret:state.entitySecret,recoveryFileDownloadPath:'.state'});
   if(!result.data?.recoveryFile) throw new Error('Recovery file missing');
   writeFileSync('.state/circle-recovery.dat',result.data.recoveryFile,{mode:0o600});
   state.registered=true;save();
  }finally{console.log=log;}
  console.log('Circle entity secret registered; recovery saved privately.');
 }
 if(!state.walletSetId){state.walletSetId=(await client.createWalletSet({name:'Jio x402 Arc Testnet',idempotencyKey:state.walletSetKey})).data?.walletSet?.id;save();}
 if(!state.walletSetId) throw new Error('Wallet set missing');
 if(!state.wallets){state.wallets=(await client.createWallets({walletSetId:state.walletSetId,blockchains:['ARC-TESTNET'],accountType:'EOA',count:2,idempotencyKey:state.walletsKey})).data?.wallets;save();}
 if(state.wallets?.length!==2) throw new Error('Expected buyer and seller wallets');
 for(const wallet of state.wallets){
  state.funded??={};
  if(!state.funded[wallet.id]){
   const balances=(await client.getWalletTokenBalance({id:wallet.id})).data?.tokenBalances??[];
   const funded=balances.some(b=>b.token.tokenAddress?.toLowerCase()===CHAIN_CONFIGS.arcTestnet.usdc.toLowerCase() && Number(b.amount)>=1);
   if(!funded) await client.requestTestnetTokens({address:wallet.address,blockchain:'ARC-TESTNET',usdc:true});
   state.funded[wallet.id]=true;save();
  }
 }
 console.log('Buyer and seller EOA wallets created; testnet faucet requested.');
 const walletAddress=state.wallets[0].address;
 const chain=CHAIN_CONFIGS.arcTestnet;
 if(!state.approvalId){state.approvalId=(await client.createContractExecutionTransaction({walletAddress,blockchain:'ARC-TESTNET',contractAddress:chain.usdc,abiFunctionSignature:'approve(address,uint256)',abiParameters:[chain.gatewayWallet,'1000000'],fee:{type:'level',config:{feeLevel:'MEDIUM'}},idempotencyKey:state.approveKey})).data?.id;save();}
 if(!state.approvalId) throw new Error('Approval ID missing');
 await wait(state.approvalId);
 if(!state.depositId){state.depositId=(await client.createContractExecutionTransaction({walletAddress,blockchain:'ARC-TESTNET',contractAddress:chain.gatewayWallet,abiFunctionSignature:'deposit(address,uint256)',abiParameters:[chain.usdc,'1000000'],fee:{type:'level',config:{feeLevel:'MEDIUM'}},idempotencyKey:state.depositKey})).data?.id;save();}
 if(!state.depositId) throw new Error('Deposit ID missing');
 await wait(state.depositId);
 const response=await fetch('https://gateway-api-testnet.circle.com/v1/balances',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'USDC',sources:[{domain:26,depositor:walletAddress}]}),signal:AbortSignal.timeout(10000)});
 if(!response.ok) throw new Error(`Gateway balance HTTP ${response.status}`);
 console.log({buyer:walletAddress,seller:state.wallets[1].address,deposit_id:state.depositId,gateway_balance:await response.json()});
}catch(error:any){
 // Circle/Axios exceptions may contain authorization headers; never dump them.
 console.error({setup_failed:true,http_status:error.response?.status??error.status,code:error.response?.data?.code??error.code,message:error.response?'Circle API rejected setup':error.message});
 process.exitCode=1;
}
