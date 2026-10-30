'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {prisma}=require('../configs/database');
const {upsertAbandonedCart,upsertOrder}=require('../services/commerceWebhookService');
const {promoteInactiveCheckouts}=require('../services/schedulerService');
const {isCheckoutInactive,ABANDONMENT_INACTIVITY_MS}=require('../services/checkoutInactivity');
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
}finally{
console.log('TASK033_RESULTS='+JSON.stringify(results));
console.log('TASK033_SUMMARY='+JSON.stringify({pass:results.filter(x=>x.status==='PASS').length,fail:results.filter(x=>x.status==='FAIL').length,total:results.length}));
if(results.some(x=>x.status==='FAIL'))process.exitCode=1;
await prisma.$disconnect();
}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
