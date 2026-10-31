'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {prisma}=require('../configs/database');
const {upsertAbandonedCart,upsertOrder}=require('../services/commerceWebhookService');
const {promoteInactiveCheckouts}=require('../services/schedulerService');
const {isCheckoutInactive,ABANDONMENT_INACTIVITY_MS}=require('../services/checkoutInactivity');
const dashboardController=require('../controller/dashboardController');
if(process.env.TASK033_ISOLATED_DB!=='true'||!String(process.env.DATABASE_URL||'').includes('@127.0.0.1:5432/task033'))throw Error('Disposable task033 database required');
const prefix='task033-'+randomUUID().slice(0,8),store={id:randomUUID(),platform:'shopify'};
const results=[];
async function check(name,fn){try{await fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:String(e.message).slice(0,260)});}}
const checkout=(s,extra={})=>({id:prefix+'-checkout-'+s,token:prefix+'-token-'+s,created_at:'2026-10-30T08:00:00Z',updated_at:'2026-10-30T08:01:00Z',total_price:'25',currency:'USD',...extra});
const order=(s,extra={})=>({id:prefix+'-order-'+s,checkout_token:prefix+'-token-'+s,created_at:'2026-10-30T08:40:00Z',total_price:'25',currency:'USD',...extra});
const cart=s=>prisma.abandoned_carts.findFirstOrThrow({where:{store_id:store.id,external_cart_id:prefix+'-checkout-'+s}});
async function main(){
try{
const user=randomUUID(),org=randomUUID();
await prisma.users.create({data:{id:user,full_name:'Task033 Test',email:prefix+'@example.invalid'}});
await prisma.organizations.create({data:{id:org,owner_id:user,company_name:'Task033',industry:'other',country:'US',slug:prefix}});
await prisma.organization_members.create({data:{organization_id:org,user_id:user,role:'Owner',status:'active'}});
await prisma.stores.create({data:{id:store.id,organization_id:org,platform:'shopify',shop_domain:prefix+'.myshopify.com',status:'active'}});
await check('TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries',async()=>{
assert.equal(ABANDONMENT_INACTIVITY_MS,900000);
const now=new Date('2026-10-30T09:00:00Z');
for(const sec of [60,300,600,840,899])assert.equal(isCheckoutInactive(new Date(now.getTime()-sec*1000),now),false);
for(const sec of [900,901,1200,1800,3600])assert.equal(isCheckoutInactive(new Date(now.getTime()-sec*1000),now),true);
});
await check('TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase',async()=>{
await upsertAbandonedCart(store,checkout('core'));
assert.equal((await cart('core')).status,'pending');
await promoteInactiveCheckouts();
assert.equal((await cart('core')).status,'abandoned');
await upsertOrder(store,'shopify',order('core'));
const c=await cart('core');
const o=await prisma.orders.findFirstOrThrow({where:{store_id:store.id,external_order_id:prefix+'-order-core'}});
assert.equal(o.abandoned_cart_id,c.id);
assert.equal(c.status,'recovered');
assert.equal(await prisma.abandoned_carts.count({where:{store_id:store.id,status:'abandoned',id:c.id}}),0);
});
await check('TC033-33-34-35-36-41-stale-and-repeated-classifier-cannot-reopen',async()=>{
await upsertAbandonedCart(store,checkout('core',{updated_at:'2026-10-30T08:00:00Z'}));
await upsertAbandonedCart(store,checkout('core',{updated_at:'2026-10-30T08:00:00Z'}));
await promoteInactiveCheckouts();await promoteInactiveCheckouts();
assert.equal((await cart('core')).status,'recovered');
});
await check('TC033-37-38-57-duplicate-purchase-and-checkout-do-not-duplicate',async()=>{
await upsertOrder(store,'shopify',order('core'));
await upsertAbandonedCart(store,checkout('core'));
assert.equal(await prisma.orders.count({where:{store_id:store.id,external_order_id:prefix+'-order-core'}}),1);
assert.equal(await prisma.abandoned_carts.count({where:{store_id:store.id,external_cart_id:prefix+'-checkout-core'}}),1);
assert.equal((await cart('core')).status,'recovered');
});
await check('TC033-28-weak-evidence-does-not-complete-abandoned-checkout',async()=>{
await upsertAbandonedCart(store,checkout('unmatched'));
await promoteInactiveCheckouts();
await upsertOrder(store,'shopify',order('unmatched',{checkout_token:null,checkout_id:null,cart_token:null}));
assert.equal((await cart('unmatched')).status,'abandoned');
});

await check('TC033-14-recent-activity-prevents-abandonment',async()=>{
const suffix='recent-activity';
await upsertAbandonedCart(store,checkout(suffix,{updated_at:new Date().toISOString()}));
await promoteInactiveCheckouts();
assert.equal((await cart(suffix)).status,'pending');
});
await check('TC033-17-exact-checkout-id-matching-after-abandonment',async()=>{
const suffix='exact-id';
await upsertAbandonedCart(store,checkout(suffix));
await promoteInactiveCheckouts();
await upsertOrder(store,'shopify',order(suffix,{checkout_id:prefix+'-checkout-'+suffix,checkout_token:null}));
const c=await cart(suffix);
const o=await prisma.orders.findFirstOrThrow({where:{store_id:store.id,external_order_id:prefix+'-order-'+suffix}});
assert.equal(o.abandoned_cart_id,c.id);assert.equal(c.status,'recovered');
});
await check('TC033-21-22-23-24-25-weak-evidence-never-completes',async()=>{
const suffix='weak-evidence';
await upsertAbandonedCart(store,checkout(suffix,{email:'same@example.invalid',total_price:'25'}));
await promoteInactiveCheckouts();
await upsertOrder(store,'shopify',order(suffix,{checkout_token:null,checkout_id:null,cart_token:null,email:'same@example.invalid',total_price:'25'}));
assert.equal((await cart(suffix)).status,'abandoned');
});
await check('TC033-54-55-56-58-59-active-abandonment-and-order-financial-integrity',async()=>{
const c=await cart('core');
const o=await prisma.orders.findFirstOrThrow({where:{store_id:store.id,external_order_id:prefix+'-order-core'}});
assert.equal(c.status,'recovered');
assert.equal(Number(o.total),25);
assert.equal(await prisma.abandoned_carts.count({where:{store_id:store.id,id:c.id,status:'abandoned'}}),0);
assert.equal(await prisma.orders.count({where:{store_id:store.id,external_order_id:o.external_order_id}}),1);
assert.equal(o.recovery_sequence_id??null,null);
});
await check('TC033-70-deterministic-repeatable-fixtures',async()=>{
for(const suffix of ['repeat-a','repeat-b']){
await upsertAbandonedCart(store,checkout(suffix));
await promoteInactiveCheckouts();
assert.equal((await cart(suffix)).status,'abandoned');
await upsertOrder(store,'shopify',order(suffix));
assert.equal((await cart(suffix)).status,'recovered');
}
});

await check('TC033-39-concurrent-scheduler-and-purchase-final-state-completed',async()=>{
const suffix='race-scheduler';
await upsertAbandonedCart(store,checkout(suffix));
await Promise.all([promoteInactiveCheckouts(),upsertOrder(store,'shopify',order(suffix))]);
assert.equal((await cart(suffix)).status,'recovered');
});
await check('TC033-40-concurrent-order-reconciliation-single-relationship',async()=>{
const suffix='race-orders';
await upsertAbandonedCart(store,checkout(suffix));
await promoteInactiveCheckouts();
await Promise.all([upsertOrder(store,'shopify',order(suffix)),upsertOrder(store,'shopify',order(suffix))]);
const c=await cart(suffix);
assert.equal(c.status,'recovered');
assert.equal(await prisma.orders.count({where:{store_id:store.id,external_order_id:prefix+'-order-'+suffix}}),1);
});
await check('TC033-42-43-cross-merchant-isolation-with-overlapping-source-identifiers',async()=>{
const otherUser=randomUUID(),otherOrg=randomUUID(),otherStore={id:randomUUID(),platform:'shopify'};
await prisma.users.create({data:{id:otherUser,full_name:'Task033 Other',email:prefix+'-other@example.invalid'}});
await prisma.organizations.create({data:{id:otherOrg,owner_id:otherUser,company_name:'Task033 Other',industry:'other',country:'US',slug:prefix+'-other'}});
await prisma.stores.create({data:{id:otherStore.id,organization_id:otherOrg,platform:'shopify',shop_domain:prefix+'-other.myshopify.com',status:'active'}});
const suffix='merchant-overlap';
await upsertAbandonedCart(store,checkout(suffix));
await upsertAbandonedCart(otherStore,checkout(suffix));
await promoteInactiveCheckouts();
await upsertOrder(otherStore,'shopify',order(suffix));
assert.equal((await cart(suffix)).status,'abandoned');
assert.equal((await prisma.abandoned_carts.findFirstOrThrow({where:{store_id:otherStore.id,external_cart_id:prefix+'-checkout-'+suffix}})).status,'recovered');
await upsertOrder(store,'shopify',order(suffix));
assert.equal((await cart(suffix)).status,'recovered');
assert.equal(await prisma.orders.count({where:{external_order_id:prefix+'-order-'+suffix}}),2);
});
await check('TC033-45-checkout-persistence-failure-does-not-report-success',async()=>{
const suffix='checkout-write-fail';
const badStore={id:randomUUID(),platform:'shopify'};
await assert.rejects(upsertAbandonedCart(badStore,checkout(suffix)));
assert.equal(await prisma.abandoned_carts.count({where:{external_cart_id:prefix+'-checkout-'+suffix}}),0);
});
await check('TC033-47-order-persistence-failure-preserves-checkout',async()=>{
const suffix='order-write-fail';
await upsertAbandonedCart(store,checkout(suffix));
await promoteInactiveCheckouts();
await assert.rejects(upsertOrder({id:randomUUID(),platform:'shopify'},'shopify',order(suffix)));
assert.equal((await cart(suffix)).status,'abandoned');
});
await check('TC033-49-fresh-prisma-client-verifies-durable-completion',async()=>{
const {PrismaClient}=require('@prisma/client');
const fresh=new PrismaClient();
try{
const c=await fresh.abandoned_carts.findFirstOrThrow({where:{store_id:store.id,external_cart_id:prefix+'-checkout-core'}});
const o=await fresh.orders.findFirstOrThrow({where:{store_id:store.id,external_order_id:prefix+'-order-core'}});
assert.equal(c.status,'recovered');assert.equal(o.abandoned_cart_id,c.id);
}finally{await fresh.$disconnect();}
});


await check('TC033-46-48-transaction-rollback-on-injected-database-failure',async()=>{
const suffix='tx-rollback';
const before=await prisma.abandoned_carts.count({where:{store_id:store.id,status:'pending'}});
await assert.rejects(prisma.$transaction(async tx=>{
await tx.abandoned_carts.updateMany({where:{store_id:store.id,status:'pending'},data:{status:'abandoned'}});
throw new Error('TASK033_INJECTED_TRANSACTION_FAILURE');
}),/TASK033_INJECTED_TRANSACTION_FAILURE/);
assert.equal(await prisma.abandoned_carts.count({where:{store_id:store.id,status:'pending'}}),before);
await upsertAbandonedCart(store,checkout(suffix));
assert.equal(await prisma.abandoned_carts.count({where:{store_id:store.id,external_cart_id:prefix+'-checkout-'+suffix}}),1);
await promoteInactiveCheckouts();
await upsertOrder(store,'shopify',order(suffix));
assert.equal((await cart(suffix)).status,'recovered');
});


await check('TC033-19-safe-cart-token-reconciliation',async()=>{
const suffix='cart-token-safe',token=prefix+'-shared-cart-token';
await upsertAbandonedCart(store,checkout(suffix,{cart_token:token}));
await promoteInactiveCheckouts();
await upsertOrder(store,'shopify',order(suffix,{checkout_token:null,checkout_id:null,cart_token:token}));
const c=await cart(suffix);
const o=await prisma.orders.findFirstOrThrow({where:{store_id:store.id,external_order_id:prefix+'-order-'+suffix}});
assert.equal(o.abandoned_cart_id,c.id);assert.equal(c.status,'recovered');
});
await check('TC033-20-26-conflicting-and-ambiguous-identifiers-never-force-link',async()=>{
const a='conflict-a',b='conflict-b';
await upsertAbandonedCart(store,checkout(a));
await upsertAbandonedCart(store,checkout(b));
await promoteInactiveCheckouts();
await upsertOrder(store,'shopify',order('conflict',{checkout_id:prefix+'-checkout-'+a,checkout_token:prefix+'-token-'+b}));
const o=await prisma.orders.findFirstOrThrow({where:{store_id:store.id,external_order_id:prefix+'-order-conflict'}});
assert.equal(o.abandoned_cart_id,null);
const conflict=await prisma.order_checkout_reconciliation_cases.findFirst({where:{store_id:store.id,order_id:o.id}});
assert.equal(conflict.status,'UNRESOLVED');assert.equal(conflict.reason,'CONFLICTING_IDENTIFIERS');
});
await check('TC033-27-existing-checkout-ownership-rejects-second-order-claim',async()=>{
const suffix='single-owner';
await upsertAbandonedCart(store,checkout(suffix));
await promoteInactiveCheckouts();
await upsertOrder(store,'shopify',order(suffix));
const second=await upsertOrder(store,'shopify',order(suffix+'-second',{checkout_id:prefix+'-checkout-'+suffix,checkout_token:null}));
assert.equal(second.abandoned_cart_id,null);
assert.equal(await prisma.orders.count({where:{store_id:store.id,abandoned_cart_id:(await cart(suffix)).id}}),1);
});
await check('TC033-31-32-60-source-identifiers-and-completion-timestamp-preserved',async()=>{
const suffix='source-integrity',sourceTime='2026-10-30T08:40:00.000Z';
await upsertAbandonedCart(store,checkout(suffix));
await promoteInactiveCheckouts();
await upsertOrder(store,'shopify',order(suffix,{created_at:sourceTime,checkout_id:prefix+'-checkout-'+suffix}));
const c=await cart(suffix);
const o=await prisma.orders.findFirstOrThrow({where:{store_id:store.id,external_order_id:prefix+'-order-'+suffix}});
assert.equal(c.source_checkout_id,prefix+'-checkout-'+suffix);
assert.equal(o.source_checkout_id,prefix+'-checkout-'+suffix);
assert.equal(c.recovered_at.toISOString(),sourceTime);
});
await check('TC033-61-large-Shopify-identifier-is-preserved-exactly',async()=>{
const huge='9223372036854775806';
await upsertAbandonedCart(store,{...checkout('large-id'),id:huge,checkout_id:huge,token:null});
await promoteInactiveCheckouts();
await upsertOrder(store,'shopify',{...order('large-id'),id:prefix+'-order-large-id',checkout_id:huge,checkout_token:null});
const c=await prisma.abandoned_carts.findFirstOrThrow({where:{store_id:store.id,external_cart_id:huge}});
const o=await prisma.orders.findFirstOrThrow({where:{store_id:store.id,external_order_id:prefix+'-order-large-id'}});
assert.equal(c.source_checkout_id,huge);assert.equal(o.source_checkout_id,huge);assert.equal(o.abandoned_cart_id,c.id);
});
await check('TC033-62-63-missing-and-invalid-identifiers-do-not-fabricate-links',async()=>{
const suffix='missing-identity';
await upsertAbandonedCart(store,checkout(suffix));
await promoteInactiveCheckouts();
await upsertOrder(store,'shopify',order(suffix,{checkout_id:null,checkout_token:null,cart_token:null}));
assert.equal((await cart(suffix)).status,'abandoned');
await assert.rejects(upsertOrder(store,'shopify',order('invalid-identity',{checkout_id:{bad:'object'},checkout_token:null,cart_token:null})));
});
await check('TC033-51-52-53-historical-payload-mappers-use-shared-persistence-path',async()=>{
const sync=require('../services/shopifySync');
const suffix='historical-map';
const mappedCheckout=sync.abandonedPayload({id:'gid://shopify/AbandonedCheckout/'+prefix+'-checkout-'+suffix,createdAt:'2026-10-30T08:00:00Z',updatedAt:'2026-10-30T08:01:00Z',totalPriceSet:{shopMoney:{amount:'25',currencyCode:'USD'}}});
await upsertAbandonedCart(store,mappedCheckout);
await promoteInactiveCheckouts();
const mappedOrder=sync.orderPayload({id:'gid://shopify/Order/'+prefix+'-order-'+suffix,checkoutToken:prefix+'-token-'+suffix,createdAt:'2026-10-30T08:40:00Z',displayFinancialStatus:'PAID',totalPriceSet:{shopMoney:{amount:'25',currencyCode:'USD'}},currentTotalPriceSet:{shopMoney:{amount:'25',currencyCode:'USD'}},subtotalPriceSet:{shopMoney:{amount:'25',currencyCode:'USD'}},totalDiscountsSet:{shopMoney:{amount:'0',currencyCode:'USD'}},lineItems:{nodes:[]}});
await upsertOrder(store,'shopify',{...mappedOrder,checkout_id:prefix+'-checkout-'+suffix});
const c=await cart(suffix);
const o=await prisma.orders.findFirstOrThrow({where:{store_id:store.id,external_order_id:prefix+'-order-'+suffix}});
assert.equal(c.status,'recovered');assert.equal(o.abandoned_cart_id,c.id);
await upsertAbandonedCart(store,mappedCheckout);
await upsertOrder(store,'shopify',{...mappedOrder,checkout_id:prefix+'-checkout-'+suffix});
assert.equal(await prisma.abandoned_carts.count({where:{store_id:store.id,external_cart_id:prefix+'-checkout-'+suffix}}),1);
assert.equal(await prisma.orders.count({where:{store_id:store.id,external_order_id:prefix+'-order-'+suffix}}),1);
});
await check('TC033-54-55-58-59-real-dashboard-metric-query-integrity',async()=>{
const now=new Date();
const cutoff=new Date(now.getTime()-900000);
const expectedActive=await prisma.abandoned_carts.count({where:{store_id:store.id,OR:[
{status:'abandoned',recovered_at:null,updated_at:{lte:cutoff}},
{status:'pending',recovered_at:null,updated_at:{lte:cutoff}},
{status:'in_sequence'},
]}});
const expectedAtRisk=await prisma.abandoned_carts.aggregate({where:{store_id:store.id,OR:[
{status:'abandoned',recovered_at:null,updated_at:{lte:cutoff}},
{status:'pending',recovered_at:null,updated_at:{lte:cutoff}},
]},_sum:{cart_value:true}});
const completedOrder=await prisma.orders.findFirstOrThrow({where:{store_id:store.id,external_order_id:prefix+'-order-core'}});
assert.equal(completedOrder.recovery_status,'completed');
assert.equal((await cart('core')).status,'recovered');
let statusCode=0,body;
const response={status(code){statusCode=code;return this;},json(value){body=value;return this;}};
await dashboardController.getKpis({user:{id:user}},response,error=>{throw error;});
assert.equal(statusCode,200);
const metrics=Object.fromEntries(body.data.kpi.map(item=>[item.id,item]));
assert.equal(Number(metrics.carts.value),expectedActive,'Actual Command Center endpoint must exclude completed/recovered checkouts from active abandonment');
assert.equal(Number(String(metrics.risk.value).replace(/[$,]/g,'')),Number(expectedAtRisk._sum.cart_value||0),'Revenue at risk must equal eligible open abandoned checkout value only');
assert.equal(Number(String(metrics.rev.value).replace(/[$,]/g,'')),0,'A normal completed order must not be mislabeled as Revluma-attributed recovered revenue');
});

await check('TC033-50-separate-node-process-verifies-persisted-reconciliation',async()=>{
const {execFileSync}=require('node:child_process');
const script=`const assert=require('node:assert/strict');const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{const c=await p.abandoned_carts.findFirstOrThrow({where:{store_id:process.env.TASK033_STORE_ID,external_cart_id:process.env.TASK033_CART_ID}});const o=await p.orders.findFirstOrThrow({where:{store_id:process.env.TASK033_STORE_ID,external_order_id:process.env.TASK033_ORDER_ID}});assert.equal(c.status,'recovered');assert.equal(o.abandoned_cart_id,c.id);await p.$disconnect()})().catch(e=>{console.error(e);process.exit(1)})`;
execFileSync(process.execPath,['-e',script],{cwd:require('node:path').resolve(__dirname,'../..'),env:{...process.env,TASK033_STORE_ID:store.id,TASK033_CART_ID:prefix+'-checkout-core',TASK033_ORDER_ID:prefix+'-order-core'},timeout:20000,stdio:'pipe'});
});
}finally{
console.log('TASK033_RESULTS='+JSON.stringify(results));
console.log('TASK033_SUMMARY='+JSON.stringify({pass:results.filter(x=>x.status==='PASS').length,fail:results.filter(x=>x.status==='FAIL').length,total:results.length}));
if(results.some(x=>x.status==='FAIL'))process.exitCode=1;
await prisma.$disconnect();
}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
