'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {prisma}=require('../configs/database');
const {upsertOrder,upsertAbandonedCart}=require('../services/commerceWebhookService');
if(process.env.TASK029_ISOLATED_DB!=='true'||!String(process.env.DATABASE_URL||'').includes('@127.0.0.1:5432/task029'))throw Error('Disposable task029 database required');
const tag=randomUUID().slice(0,8),key=x=>'t029-'+tag+'-'+x,results=[],store={id:randomUUID(),platform:'shopify'},other={id:randomUUID(),platform:'shopify'};
async function check(id,fn){try{await fn();results.push({id,status:'PASS'})}catch(e){results.push({id,status:'FAIL',error:e.message.slice(0,200)})}}
async function cart(s,id,extra={}){return upsertAbandonedCart(s,{id:key(id),token:key('token-'+id),created_at:new Date(Date.now()-3600000).toISOString(),updated_at:new Date(Date.now()-3600000).toISOString(),total_price:'25',currency:'USD',...extra})}
async function order(s,id,extra={}){await upsertOrder(s,'shopify',{id:key('order-'+id),created_at:new Date().toISOString(),total_price:'25',currency:'USD',...extra});return prisma.orders.findUniqueOrThrow({where:{store_id_external_order_id:{store_id:s.id,external_order_id:key('order-'+id)}}})}
async function run(){try{
const user=randomUUID(),org=randomUUID();
await prisma.users.create({data:{id:user,full_name:'Task029 Synthetic',email:key('user')+'@example.invalid'}});
await prisma.organizations.create({data:{id:org,owner_id:user,company_name:'Task029',industry:'other',country:'US',slug:key('org')}});
await prisma.stores.createMany({data:[{id:store.id,organization_id:org,platform:'shopify',shop_domain:key('store')+'.myshopify.com'},{id:other.id,organization_id:org,platform:'shopify',shop_domain:key('other')+'.myshopify.com'}]});
await check('TC029-01',async()=>{let c=await cart(store,'01');await order(store,'01',{checkout_token:c.source_checkout_token});let v=await prisma.abandoned_carts.findUniqueOrThrow({where:{id:c.id}});assert.equal(v.status,'recovered');assert.ok(v.recovered_at)});
await check('TC029-02',async()=>{let c=await cart(store,'02');await prisma.abandoned_carts.update({where:{id:c.id},data:{status:'abandoned'}});await order(store,'02',{checkout_token:c.source_checkout_token});assert.equal((await prisma.abandoned_carts.findUniqueOrThrow({where:{id:c.id}})).status,'recovered')});
await check('TC029-03',async()=>{let c=await cart(store,'03');await order(store,'03',{checkout_token:c.source_checkout_token});let a=await prisma.abandoned_carts.findUniqueOrThrow({where:{id:c.id}});await order(store,'03',{checkout_token:c.source_checkout_token});let b=await prisma.abandoned_carts.findUniqueOrThrow({where:{id:c.id}});assert.equal(a.recovered_at.getTime(),b.recovered_at.getTime())});
await check('TC029-08',async()=>{let c=await cart(store,'08',{completed_at:'2026-10-01T12:00:00.000Z'});assert.equal(c.status,'recovered')});
await check('TC029-09',async()=>{let c=await cart(store,'09');await order(store,'09',{checkout_token:c.source_checkout_token});assert.equal((await prisma.abandoned_carts.findUniqueOrThrow({where:{id:c.id}})).status,'recovered')});
await check('TC029-16',async()=>{let c=await cart(store,'16');assert.notEqual(c.status,'recovered')});
await check('TC029-17',async()=>{let c=await cart(store,'17');await order(store,'17');assert.notEqual((await prisma.abandoned_carts.findUniqueOrThrow({where:{id:c.id}})).status,'recovered')});
await check('TC029-26',async()=>{let c=await cart(other,'26');await order(store,'26',{checkout_token:c.source_checkout_token});assert.notEqual((await prisma.abandoned_carts.findUniqueOrThrow({where:{id:c.id}})).status,'recovered')});
await check('TC029-35',async()=>{let c=await cart(store,'35');await prisma.abandoned_carts.update({where:{id:c.id},data:{status:'abandoned'}});await order(store,'35',{checkout_token:c.source_checkout_token});assert.equal(await prisma.abandoned_carts.count({where:{id:c.id,status:'abandoned'}}),0)});
await check('TC029-38',async()=>{let c=await cart(store,'38');let o=await order(store,'38',{checkout_token:c.source_checkout_token});assert.equal(o.recovery_status,'completed');assert.equal(o.attribution_channel,null)});
await check('TC029-39',async()=>{let c=await cart(store,'39');let o=await order(store,'39',{checkout_token:c.source_checkout_token});assert.equal(Number(o.total),25)});
await check('TC029-45',async()=>{let c=await cart(store,'45');await order(store,'45',{checkout_token:c.source_checkout_token});let v=await cart(store,'45');assert.equal(v.status,'recovered')});
}finally{console.log('TASK029_RESULTS='+JSON.stringify(results));console.log('TASK029_SUMMARY='+JSON.stringify({passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,total:results.length}));await prisma.$disconnect()}if(results.some(x=>x.status==='FAIL'))process.exitCode=1}
run().catch(e=>{console.error(e);process.exitCode=1});
