'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {prisma}=require('../configs/database');
const {upsertOrder,upsertAbandonedCart}=require('../services/commerceWebhookService');
if(process.env.TASK030_ISOLATED_DB!=='true'||!String(process.env.DATABASE_URL||'').includes('@127.0.0.1:5432/task030'))throw Error('Disposable task030 PostgreSQL required');
const tag=randomUUID().slice(0,8),key=x=>'t030-'+tag+'-'+x,results=[],store={id:randomUUID(),platform:'shopify'},other={id:randomUUID(),platform:'shopify'};
const t0='2026-10-30T09:00:00.000Z',t1='2026-10-30T09:05:00.000Z',t2='2026-10-30T09:10:00.000Z';
async function check(id,fn){try{await fn();results.push({id,status:'PASS'})}catch(e){results.push({id,status:'FAIL',error:e.message.slice(0,240)})}}
const payload=(id,extra={})=>({id:key(id),token:key('token-'+id),created_at:t0,updated_at:t1,total_price:'25',currency:'USD',...extra});
async function cart(s,id,extra={}){return upsertAbandonedCart(s,payload(id,extra))}
async function order(s,id,extra={}){return upsertOrder(s,'shopify',{id:key('order-'+id),created_at:t2,total_price:'25',currency:'USD',...extra})}
async function get(id){return prisma.abandoned_carts.findUniqueOrThrow({where:{id}})}
async function run(){try{
const user=randomUUID(),org=randomUUID();
await prisma.users.create({data:{id:user,full_name:'Task030 Synthetic',email:key('user')+'@example.invalid'}});
await prisma.organizations.create({data:{id:org,owner_id:user,company_name:'Task030',industry:'other',country:'US',slug:key('org')}});
await prisma.stores.createMany({data:[{id:store.id,organization_id:org,platform:'shopify',shop_domain:key('store')+'.myshopify.com'},{id:other.id,organization_id:org,platform:'shopify',shop_domain:key('other')+'.myshopify.com'}]});
await check('TC030-01',async()=>{let c=await cart(store,'01',{completed_at:t2});await cart(store,'01',{updated_at:t0});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-02',async()=>{let c=await cart(store,'02',{completed_at:t2});await cart(store,'02',{updated_at:t1});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-03',async()=>{let c=await cart(store,'03',{completed_at:t2});for(let i=0;i<3;i++)await cart(store,'03',{updated_at:t0});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-04',async()=>{let c=await cart(store,'04');await order(store,'04',{checkout_token:c.source_checkout_token});await cart(store,'04',{updated_at:t0});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-05',async()=>{let c=await cart(store,'05',{completed_at:t2});await cart(store,'05',{updated_at:t0});assert.equal((await get(c.id)).recovered_at.toISOString(),t2)});
await check('TC030-06',async()=>{let c=await cart(store,'06');await prisma.abandoned_carts.update({where:{id:c.id},data:{status:'abandoned'}});await order(store,'06',{checkout_token:c.source_checkout_token});await cart(store,'06',{updated_at:t0});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-07',async()=>{let c=await cart(store,'07',{completed_at:t2});await cart(store,'07',{updated_at:t0});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-08',async()=>{let c=await cart(store,'08',{completed_at:t2});await cart(store,'08',{updated_at:t0});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-09',async()=>{let c=await cart(store,'09',{completed_at:t2});await cart(store,'09',{updated_at:t1});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-10',async()=>{let c=await cart(store,'10',{completed_at:t2});await cart(store,'10',{updated_at:undefined});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-11',async()=>{let c=await cart(store,'11',{completed_at:t2});await cart(store,'11',{updated_at:'invalid'});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-12',async()=>{let c=await cart(store,'12',{completed_at:t2});await cart(store,'12',{updated_at:'2026-10-31T00:00:00.000Z'});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-13',async()=>{let c=await cart(store,'13',{completed_at:t2});await cart(store,'13',{updated_at:'2026-10-31T00:00:00.000Z',total_price:'30'});assert.equal((await get(c.id)).status,'recovered');assert.equal(Number((await get(c.id)).cart_value),30)});
await check('TC030-14',async()=>{let c=await cart(store,'14',{completed_at:t2});await cart(store,'14',{completed_at:undefined});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-15',async()=>{let c=await cart(store,'15',{completed_at:t2});await cart(store,'15',{completed_at:null});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-16',async()=>{let c=await cart(store,'16',{completed_at:t2});await cart(store,'16',{completed_at:''});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-17',async()=>{let c=await cart(store,'17',{completed_at:t2});await cart(store,'17');assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-18',async()=>{let c=await cart(store,'18',{completed_at:t2});await cart(store,'18',{updated_at:t0});assert.equal(await prisma.abandoned_carts.count({where:{id:c.id}}),1)});
await check('TC030-19',async()=>{let c=await cart(store,'19');await order(store,'19',{checkout_token:c.source_checkout_token});await cart(store,'19');assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-20',async()=>{let c=await cart(store,'20');await order(store,'20',{checkout_token:c.source_checkout_token});await order(store,'20',{checkout_token:c.source_checkout_token});await cart(store,'20');assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-23',async()=>{let c=await cart(store,'23',{completed_at:t2});for(const v of [t0,t1,t0])await cart(store,'23',{updated_at:v});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-24',async()=>{let c=await cart(store,'24',{completed_at:t2});await Promise.all([cart(store,'24',{updated_at:t0}),cart(store,'24',{updated_at:t1})]);assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-25',async()=>{let c=await cart(store,'25');await Promise.all([order(store,'25',{checkout_token:c.source_checkout_token}),cart(store,'25',{updated_at:t0})]);assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-26',async()=>{let c=await cart(store,'26',{completed_at:t2});await Promise.all(Array.from({length:3},()=>cart(store,'26',{updated_at:t0})));assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-28',async()=>{let c=await cart(store,'28',{completed_at:t2});await cart(store,'28',{updated_at:t0});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-29',async()=>{let c=await cart(store,'29',{completed_at:t2});await cart(store,'29',{updated_at:t0});await cart(store,'29',{updated_at:t0});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-30',async()=>{let c=await cart(store,'30',{completed_at:t2});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-31',async()=>{let c=await cart(other,'31',{completed_at:t2});await cart(store,'31',{updated_at:t0});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-32',async()=>{let a=await cart(store,'32',{completed_at:t2}),b=await cart(other,'32');await cart(other,'32',{updated_at:t0});assert.equal((await get(a.id)).status,'recovered');assert.equal((await get(b.id)).status,'pending')});
await check('TC030-34',async()=>{let c=await cart(store,'34');await order(store,'34',{checkout_token:c.source_checkout_token});await cart(store,'34',{updated_at:t0});assert.equal(await prisma.orders.count({where:{store_id:store.id,abandoned_cart_id:c.id}}),1)});
await check('TC030-37',async()=>{let c=await cart(store,'37',{completed_at:t2});await cart(store,'37',{updated_at:t0});assert.equal((await get(c.id)).source_checkout_token,c.source_checkout_token)});
await check('TC030-39',async()=>{let c=await cart(store,'39',{completed_at:t2});await cart(store,'39',{updated_at:t0});assert.equal(await prisma.abandoned_carts.count({where:{id:c.id,status:'abandoned'}}),0)});
await check('TC030-40',async()=>{let c=await cart(store,'40',{completed_at:t2});await cart(store,'40',{updated_at:t0});assert.equal(await prisma.abandoned_carts.count({where:{id:c.id,status:'abandoned'}}),0)});
await check('TC030-41',async()=>{let c=await cart(store,'41',{completed_at:t2});await cart(store,'41',{updated_at:t0});assert.equal(await prisma.abandoned_carts.count({where:{id:c.id,status:'recovered'}}),1)});
await check('TC030-42',async()=>{let c=await cart(store,'42');await order(store,'42',{checkout_token:c.source_checkout_token});await cart(store,'42',{updated_at:t0});assert.equal(await prisma.orders.count({where:{store_id:store.id,abandoned_cart_id:c.id}}),1)});
await check('TC030-43',async()=>{let c=await cart(store,'43');await order(store,'43',{checkout_token:c.source_checkout_token});await cart(store,'43',{updated_at:t0});assert.equal(await prisma.orders.count({where:{store_id:store.id,abandoned_cart_id:c.id}}),1)});
await check('TC030-45',async()=>{let c=await cart(store,'45',{completed_at:t2});await cart(store,'45',{updated_at:t0});assert.equal((await get(c.id)).status,'recovered')});
await check('TC030-48',async()=>{let c=await cart(store,'48');await cart(store,'48',{updated_at:t2,total_price:'45'});assert.equal(Number((await get(c.id)).cart_value),45);assert.equal((await get(c.id)).status,'pending')});
await check('TC030-50',async()=>{let c=await cart(store,'50',{completed_at:t2});await cart(store,'50',{updated_at:t0});assert.equal(await prisma.abandoned_carts.count({where:{id:c.id}}),1)});
}finally{console.log('TASK030_RESULTS='+JSON.stringify(results));console.log('TASK030_SUMMARY='+JSON.stringify({passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,total:results.length}));await prisma.$disconnect()}if(results.some(x=>x.status==='FAIL'))process.exitCode=1}
run().catch(e=>{console.error(e);process.exitCode=1});
