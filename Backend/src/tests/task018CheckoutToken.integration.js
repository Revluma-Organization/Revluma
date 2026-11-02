'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { prisma } = require('../configs/database');
const { upsertOrder, upsertAbandonedCart } = require('../services/commerceWebhookService');
if(process.env.TASK018_ISOLATED_DB !== 'true' || !/^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost):5432\/task018\b/.test(process.env.DATABASE_URL||'')) throw Error('Requires disposable localhost task018 database and opt-in');
const uid=randomUUID(),org=randomUUID(),a=randomUUID(),b=randomUUID(),tag=randomUUID().slice(0,8),results=[];
let counter=0;
const stores=[{id:a,platform:'shopify'},{id:b,platform:'shopify'}];
const token=(x)=>`TOK_${tag}_${x}`;
const cPayload=(key,t,extra={})=>({cart_token:t,token:t,created_at:new Date(Date.now()-60000).toISOString(),updated_at:new Date(Date.now()-30000).toISOString(),total_price:'25.00',currency:'USD',...extra});
async function cart(store,key,t,extra={}) {return upsertAbandonedCart(store,cPayload(key,t,extra));}
async function order(store,key,t,extra={}){const payload={id:`order-${tag}-${++counter}`,created_at:new Date().toISOString(),total_price:'25.00',currency:'USD',customer:{id:`customer-${tag}-${key}`},...extra};if(t!==undefined)payload.checkout_token=t;await upsertOrder(store,'shopify',payload);return prisma.orders.findUniqueOrThrow({where:{store_id_external_order_id:{store_id:store.id,external_order_id:String(payload.id)}}});}
async function state(c){return prisma.abandoned_carts.findUniqueOrThrow({where:{id:c.id}})}
async function check(id,description,fn){try{await fn();results.push({id,description,status:'PASS'});}catch(e){results.push({id,description,status:'FAIL',error:String(e.message).slice(0,260)});}}
async function run(){
 try {
 await prisma.users.create({data:{id:uid,full_name:'Task018 Synthetic',email:`task018-${tag}@example.invalid`}});
 await prisma.organizations.create({data:{id:org,owner_id:uid,company_name:'Task018',industry:'other',country:'US',slug:`task018-${tag}`}});
 await prisma.stores.createMany({data:[{id:a,organization_id:org,platform:'shopify',shop_domain:`task018-${tag}.myshopify.com`},{id:b,organization_id:org,platform:'shopify',shop_domain:`task018-${tag}-b.myshopify.com`}]});
 // All positive fixtures omit order.checkout_id and order.cart_token. Checkout payloads use cart_token as the sole persisted identifier; the independently tested order.checkout_token must match that exact string.
 await check('TC018-01','exact token',async()=>{const c=await cart(stores[0],'01',token('01'));assert.equal((await order(stores[0],'01',token('01'))).abandoned_cart_id,c.id)});
 await check('TC018-02','checkout ID absent',async()=>{const c=await cart(stores[0],'02',token('02'));assert.equal((await order(stores[0],'02',token('02'),{checkout_id:null})).abandoned_cart_id,c.id)});
 await check('TC018-03','incorrect token',async()=>{const c=await cart(stores[0],'03',token('03a'));assert.equal((await order(stores[0],'03',token('03b'))).abandoned_cart_id,null);assert.equal((await state(c)).status,'pending')});
 await check('TC018-04','multiple checkouts',async()=>{const x=await cart(stores[0],'04a',token('04a')),y=await cart(stores[0],'04b',token('04b')),z=await cart(stores[0],'04c',token('04c'));assert.equal((await order(stores[0],'04',token('04b'))).abandoned_cart_id,y.id);for(const c of [x,z])assert.equal((await state(c)).status,'pending')});
 await check('TC018-05','same customer',async()=>{const customer={id:`customer-05-${tag}`};const x=await cart(stores[0],'05a',token('05a'),{customer}),y=await cart(stores[0],'05b',token('05b'),{customer});assert.equal((await order(stores[0],'05',token('05b'),{customer})).abandoned_cart_id,y.id);assert.equal((await state(x)).status,'pending')});
 await check('TC018-06','same totals and timestamps',async()=>{const x=await cart(stores[0],'06a',token('06a')),y=await cart(stores[0],'06b',token('06b'));assert.equal((await order(stores[0],'06',token('06a'))).abandoned_cart_id,x.id);assert.equal((await state(y)).status,'pending')});
 await check('TC018-07','cross merchant token collision',async()=>{const x=await cart(stores[0],'07a',token('07')),y=await cart(stores[1],'07b',token('07'));assert.equal((await order(stores[0],'07',token('07'))).abandoned_cart_id,x.id);assert.equal((await state(y)).status,'pending')});
 await check('TC018-08','missing token',async()=>{assert.equal((await order(stores[0],'08',undefined)).abandoned_cart_id,null)});
 await check('TC018-09','null token',async()=>{assert.equal((await order(stores[0],'09',null)).abandoned_cart_id,null)});
 await check('TC018-10','empty token',async()=>{assert.equal((await order(stores[0],'10','')).abandoned_cart_id,null)});
 await check('TC018-11','whitespace token',async()=>{assert.equal((await order(stores[0],'11','  ')).abandoned_cart_id,null)});
 await check('TC018-12','case-sensitive exact',async()=>{const c=await cart(stores[0],'12',token('AbC'));assert.equal((await order(stores[0],'12',token('abc'))).abandoned_cart_id,null);assert.equal((await state(c)).status,'pending')});
 await check('TC018-13','prefix not equal',async()=>{const x=await cart(stores[0],'13a',token('prefix')),y=await cart(stores[0],'13b',token('prefixLong'));assert.equal((await order(stores[0],'13',token('prefix'))).abandoned_cart_id,x.id);assert.equal((await state(y)).status,'pending')});
 await check('TC018-14','duplicate token must reject',async()=>{const c=await cart(stores[0],'14',token('14'));await prisma.abandoned_carts.create({data:{store_id:a,external_cart_id:c.external_cart_id,cart_value:25,currency:'USD',status:'pending',abandoned_at:new Date(),updated_at:new Date()}});assert.equal((await order(stores[0],'14',token('14'))).abandoned_cart_id,null)});
 await check('TC018-15','conflicting ID and token must not silently link',async()=>{const x=await cart(stores[0],'15a',token('15a')),y=await cart(stores[0],'15b',token('15b'));const o=await order(stores[0],'15',token('15b'),{checkout_id:x.external_cart_id});assert.equal(o.abandoned_cart_id,null);assert.equal((await state(x)).status,'pending');assert.equal((await state(y)).status,'pending')});
 await check('TC018-16','repeat unique token',async()=>{const c=await cart(stores[0],'16',token('16'));for(let i=0;i<3;i++)assert.equal((await order(stores[0],'16',token('16'))).abandoned_cart_id,c.id)});
 await check('TC018-17','order before checkout',async()=>{const t=token('17');const o=await order(stores[0],'17',t);assert.equal(o.abandoned_cart_id,null);const c=await cart(stores[0],'17',t);const refreshed=await prisma.orders.findUniqueOrThrow({where:{id:o.id}});assert.equal(refreshed.abandoned_cart_id,c.id,'late checkout should reconcile existing order without replay')});
 await check('TC018-18','persisted FK',async()=>{const c=await cart(stores[0],'18',token('18'));const o=await order(stores[0],'18',token('18'));assert.equal(o.abandoned_cart_id,c.id);assert.equal((await prisma.orders.findUniqueOrThrow({where:{id:o.id}})).abandoned_cart_id,c.id)});
 await check('TC018-19','completion only matching checkout',async()=>{const x=await cart(stores[0],'19a',token('19a')),y=await cart(stores[0],'19b',token('19b'));await order(stores[0],'19',token('19b'));assert.equal((await state(y)).status,'recovered');assert.equal((await state(x)).status,'pending')});
 // This is the real Shopify checkout token field: token, not cart_token. It is intentionally different from cart_token.
 await check('TC018-REAL','actual checkout.token must survive cart_token precedence',async()=>{const checkoutToken=token('real-checkout'),cartToken=token('real-cart');const c=await cart(stores[0],'real',cartToken,{token:checkoutToken});assert.equal((await order(stores[0],'real',checkoutToken)).abandoned_cart_id,c.id)});
 }finally{await prisma.stores.deleteMany({where:{id:{in:[a,b]}}});await prisma.organizations.deleteMany({where:{id:org}});await prisma.users.deleteMany({where:{id:uid}});await prisma.$disconnect();}
 console.log('TASK018_RESULTS='+JSON.stringify(results));
 console.log('TASK018_SUMMARY='+JSON.stringify({passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,total:results.length}));
 if(results.some(x=>x.status==='FAIL'))process.exitCode=1;
}
run().catch(e=>{console.error(e);process.exitCode=1});
