'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {prisma}=require('../configs/database');
const {upsertOrder,upsertAbandonedCart}=require('../services/commerceWebhookService');
if(process.env.TASK020_ISOLATED_DB!=='true'||!/^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost):5432\/task020\b/.test(process.env.DATABASE_URL||''))throw Error('Disposable localhost task020 PostgreSQL and explicit opt-in required');
const tag=randomUUID().slice(0,8),uid=randomUUID(),org=randomUUID(),a=randomUUID(),b=randomUUID(),stores=[{id:a,platform:'shopify'},{id:b,platform:'shopify'}],results=[];let n=0;
const key=x=>`task020-${tag}-${x}`;
async function cart(store,suffix,customer='A',attrs={}){const payload={id:key('checkout-'+suffix),created_at:new Date(Date.now()-60000).toISOString(),updated_at:new Date(Date.now()-30000).toISOString(),total_price:'25',currency:'USD',...attrs};if(customer!==undefined)payload.customer=customer===null?null:{id:key('customer-'+customer),first_name:'Synthetic',last_name:'Customer'};return upsertAbandonedCart(store,payload)}
async function order(store,suffix,customer='A',attrs={}){const payload={id:key('order-'+(++n)+'-'+suffix),created_at:new Date().toISOString(),total_price:'25',currency:'USD',...attrs};if(customer!==undefined)payload.customer=customer===null?null:{id:key('customer-'+customer),first_name:'Synthetic',last_name:'Customer'};await upsertOrder(store,'shopify',payload);return prisma.orders.findUniqueOrThrow({where:{store_id_external_order_id:{store_id:store.id,external_order_id:String(payload.id)}}})}
async function state(c){return prisma.abandoned_carts.findUniqueOrThrow({where:{id:c.id}})}
async function check(id,description,fn){try{await fn();results.push({id,description,status:'PASS'})}catch(e){results.push({id,description,status:'FAIL',error:String(e.message).slice(0,350)})}}
async function unchanged(c){const now=await state(c);assert.equal(now.status,c.status);assert.equal(now.recovered_at?.getTime()??null,c.recovered_at?.getTime()??null)}
async function unmatched(o,carts=[]){assert.equal(o.abandoned_cart_id,null);assert.notEqual(o.recovery_status,'recovered');for(const c of carts)await unchanged(c)}
async function run(){try{
await prisma.users.create({data:{id:uid,full_name:'Task020 Synthetic',email:key('user')+'@example.invalid'}});
await prisma.organizations.create({data:{id:org,owner_id:uid,company_name:'Task020',industry:'other',country:'US',slug:key('org')}});
await prisma.stores.createMany({data:[{id:a,organization_id:org,platform:'shopify',shop_domain:key('store')+'.myshopify.com'},{id:b,organization_id:org,platform:'shopify',shop_domain:key('store-b')+'.myshopify.com'}]});
const s=stores[0],t=stores[1];
await check('TC020-01','same customer no authoritative identifier',async()=>{const c=await cart(s,'01');const o=await order(s,'01');assert.equal(o.customer_id,c.customer_id);await unmatched(o,[c])});
await check('TC020-02','same customer three checkouts',async()=>{const cs=await Promise.all(['a','b','c'].map(x=>cart(s,'02'+x)));await unmatched(await order(s,'02'),cs)});
await check('TC020-03','same customer one checkout',async()=>{const c=await cart(s,'03');await unmatched(await order(s,'03'),[c])});
await check('TC020-04','previously abandoned checkout',async()=>{const c=await cart(s,'04');await prisma.abandoned_carts.update({where:{id:c.id},data:{status:'abandoned'}});await unmatched(await order(s,'04'),[{...c,status:'abandoned'}])});
await check('TC020-05','mixed recovered abandoned pending states',async()=>{const cs=await Promise.all(['a','b','c'].map(x=>cart(s,'05'+x)));await prisma.abandoned_carts.update({where:{id:cs[0].id},data:{status:'recovered',recovered_at:new Date()}});await prisma.abandoned_carts.update({where:{id:cs[1].id},data:{status:'abandoned'}});const prior=await Promise.all(cs.map(state));await unmatched(await order(s,'05'),prior)});
await check('TC020-06','repeated purchases same customer',async()=>{const cs=await Promise.all(['a','b'].map(x=>cart(s,'06'+x)));for(let i=0;i<3;i++)await unmatched(await order(s,'06'+i),cs)});
await check('TC020-07','same customer same product',async()=>{const items=[{id:key('product'),product_id:key('product'),title:'Synthetic item',price:'25',quantity:1}];const c=await cart(s,'07','A',{line_items:items});await unmatched(await order(s,'07','A',{line_items:items}),[c])});
await check('TC020-08','same customer same amount',async()=>{const c=await cart(s,'08','A',{total_price:'25'});await unmatched(await order(s,'08','A',{total_price:'25'}),[c])});
await check('TC020-09','same customer nearby timestamps',async()=>{const ts=new Date().toISOString();const c=await cart(s,'09','A',{created_at:ts,updated_at:ts});await unmatched(await order(s,'09','A',{created_at:ts}),[c])});
await check('TC020-10','different customer',async()=>{const c=await cart(s,'10','A');await unmatched(await order(s,'10','B'),[c])});
await check('TC020-11','order missing customer id',async()=>{const c=await cart(s,'11','A');await unmatched(await order(s,'11',undefined),[c])});
await check('TC020-12','both customer IDs null',async()=>{const c=await cart(s,'12',null);await unmatched(await order(s,'12',null),[c])});
await check('TC020-13','guest checkout',async()=>{const c=await cart(s,'13',null);await unmatched(await order(s,'13',null,{email:'guest@example.invalid'}),[c])});
await check('TC020-14','customer profile changed',async()=>{const c=await cart(s,'14','A',{customer:{id:key('customer-A'),first_name:'Before'}});await unmatched(await order(s,'14','A',{customer:{id:key('customer-A'),first_name:'After'}}),[c])});
await check('TC020-15','cross merchant customer id collision',async()=>{const x=await cart(s,'15a'),y=await cart(t,'15b');await unmatched(await order(s,'15'),[x,y])});
await check('TC020-16','authoritative ID conflicts with customer identity',async()=>{const x=await cart(s,'16a','A'),y=await cart(s,'16b','B');const o=await order(s,'16','A',{checkout_id:y.external_cart_id});assert.equal(o.abandoned_cart_id,y.id);await unchanged(x);assert.equal((await state(y)).status,'recovered')});
await check('TC020-17','existing relationship not reassigned by customer',async()=>{const x=await cart(s,'17a','A'),y=await cart(s,'17b','A');const external=key('order-17');const o=await order(s,'17','A',{id:external,checkout_id:x.external_cart_id});assert.equal(o.abandoned_cart_id,x.id);const repeat=await order(s,'17-repeat','A',{id:external});assert.equal(repeat.abandoned_cart_id,x.id);await unchanged(y)});
await check('TC020-18','duplicate internal customer records with equivalent profile',async()=>{const c=await cart(s,'18','A');await prisma.customers.upsert({where:{store_id_external_id:{store_id:a,external_id:key('customer-alias')}},create:{store_id:a,external_id:key('customer-alias'),email:'duplicate@example.invalid'},update:{}});await unmatched(await order(s,'18','A'),[c])});
await check('TC020-19','repeated customer-only attempt',async()=>{const c=await cart(s,'19');const id=key('order-19');for(let i=0;i<3;i++)await unmatched(await order(s,'19','A',{id}),[c])});
await check('TC020-20','abandonment preserved',async()=>{const c=await cart(s,'20');await prisma.abandoned_carts.update({where:{id:c.id},data:{status:'abandoned'}});await unmatched(await order(s,'20'),[{...c,status:'abandoned'}])});
await check('TC020-21','no false recovered order revenue',async()=>{const c=await cart(s,'21');const o=await order(s,'21');await unmatched(o,[c]);assert.equal(o.recovery_status,'completed');assert.equal(o.total.toString(),'25')});
await check('TC020-22','unresolved relationship remains null',async()=>{const c=await cart(s,'22');const o=await order(s,'22');await unmatched(o,[c]);assert.equal((await prisma.orders.findUniqueOrThrow({where:{id:o.id}})).abandoned_cart_id,null)});
}finally{await prisma.stores.deleteMany({where:{id:{in:[a,b]}}});await prisma.organizations.deleteMany({where:{id:org}});await prisma.users.deleteMany({where:{id:uid}});await prisma.$disconnect()}
console.log('TASK020_RESULTS='+JSON.stringify(results));console.log('TASK020_SUMMARY='+JSON.stringify({passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,total:results.length}));if(results.some(x=>x.status==='FAIL'))process.exitCode=1}
run().catch(e=>{console.error(e);process.exitCode=1});
