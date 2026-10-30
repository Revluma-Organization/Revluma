'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { prisma } = require('../configs/database');
const { upsertOrder, upsertAbandonedCart } = require('../services/commerceWebhookService');
if (process.env.TASK017_ISOLATED_DB !== 'true' || !/^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost):5432\/task017\b/.test(process.env.DATABASE_URL || '')) {
  throw Error('TASK017 requires explicitly opted-in local task017 PostgreSQL database');
}
const id = () => randomUUID();
const tag = randomUUID().slice(0, 8);
const userId = id(), orgId = id(), storeA = id(), storeB = id();
const results = [];
let serial = 0;
const payload = (key, attrs={}) => ({ id: `order-${tag}-${++serial}`, created_at: new Date().toISOString(), total_price: '25.00', currency: 'USD', customer: { id: `customer-${tag}-${key}` }, ...attrs });
const checkout = (key, attrs={}) => ({ id: `checkout-${tag}-${key}`, created_at: new Date(Date.now()-60000).toISOString(), updated_at: new Date(Date.now()-30000).toISOString(), total_price: '25.00', currency: 'USD', ...attrs });
const stores = [{ id: storeA, platform: 'shopify' }, { id: storeB, platform: 'shopify' }];
async function check(name, fn, expected='PASS') {
  try { const info = await fn(); results.push({ name, status: expected, info: info || '' }); }
  catch(e) { results.push({ name, status: 'FAIL', error: String(e.message).slice(0,300) }); }
}
async function order(store, key, attrs={}) {
  const p=payload(key, attrs); await upsertOrder(store,'shopify',p);
  return prisma.orders.findUniqueOrThrow({ where: { store_id_external_order_id: { store_id: store.id, external_order_id: String(p.id) } } });
}
async function cart(store,key,attrs={}) { return upsertAbandonedCart(store,checkout(key,attrs)); }
async function run(){
  try {
    await prisma.users.create({ data:{ id:userId, full_name:'Task017 Synthetic',email:`task017-${tag}@example.invalid` } });
    await prisma.organizations.create({data:{id:orgId,owner_id:userId,company_name:'Task017',industry:'other',country:'US',slug:`task017-${tag}`}});
    await prisma.stores.createMany({data:[{id:storeA,organization_id:orgId,platform:'shopify',shop_domain:`task017-${tag}.myshopify.com`},{id:storeB,organization_id:orgId,platform:'shopify',shop_domain:`task017-${tag}-b.myshopify.com`}]});
    await check('TC017-01 valid exact ID',async()=>{const c=await cart(stores[0],'01');const o=await order(stores[0],'01',{checkout_id:c.external_cart_id});assert.equal(o.abandoned_cart_id,c.id);assert.equal((await prisma.abandoned_carts.findUniqueOrThrow({where:{id:c.id}})).status,'recovered')});
    await check('TC017-02 incorrect ID',async()=>{const c=await cart(stores[0],'02');const o=await order(stores[0],'02',{checkout_id:'missing-017'});assert.equal(o.abandoned_cart_id,null);assert.equal((await prisma.abandoned_carts.findUniqueOrThrow({where:{id:c.id}})).status,'pending')});
    await check('TC017-03 multiple merchant checkouts',async()=>{const a=await cart(stores[0],'03a'),b=await cart(stores[0],'03b'),c=await cart(stores[0],'03c');const o=await order(stores[0],'03',{checkout_id:b.external_cart_id});assert.equal(o.abandoned_cart_id,b.id);for(const x of [a,c])assert.equal((await prisma.abandoned_carts.findUniqueOrThrow({where:{id:x.id}})).status,'pending')});
    await check('TC017-04 same customer multiple checkouts',async()=>{const customer={id:'same-customer-017'};const a=await cart(stores[0],'04a',{customer}),b=await cart(stores[0],'04b',{customer});const o=await order(stores[0],'04',{customer,checkout_id:b.external_cart_id});assert.equal(o.abandoned_cart_id,b.id);assert.equal((await prisma.abandoned_carts.findUniqueOrThrow({where:{id:a.id}})).status,'pending')});
    await check('TC017-05 different customers similar orders',async()=>{const a=await cart(stores[0],'05a',{customer:{id:'05a'}}),b=await cart(stores[0],'05b',{customer:{id:'05b'}});const o=await order(stores[0],'05',{checkout_id:b.external_cart_id,customer:{id:'05a'}});assert.equal(o.abandoned_cart_id,b.id);assert.notEqual(o.abandoned_cart_id,a.id)});
    await check('TC017-06 cross merchant collision',async()=>{const shared=`collision-${tag}`;const a=await cart(stores[0],'06a',{id:shared}),b=await cart(stores[1],'06b',{id:shared});const o=await order(stores[0],'06',{checkout_id:shared});assert.equal(o.abandoned_cart_id,a.id);assert.equal((await prisma.abandoned_carts.findUniqueOrThrow({where:{id:b.id}})).status,'pending')});
    await check('TC017-07 missing checkout ID',async()=>{const o=await order(stores[0],'07');assert.equal(o.abandoned_cart_id,null)});
    await check('TC017-08 null checkout ID',async()=>{const o=await order(stores[0],'08',{checkout_id:null});assert.equal(o.abandoned_cart_id,null)});
    await check('TC017-09 empty checkout ID',async()=>{const o=await order(stores[0],'09',{checkout_id:''});assert.equal(o.abandoned_cart_id,null)});
    await check('TC017-10 numeric vs string',async()=>{const c=await cart(stores[0],'10',{id:'123456789'});const o=await order(stores[0],'10',{checkout_id:123456789});assert.equal(o.abandoned_cart_id,c.id)});
    await check('TC017-11 large string numeric ID',async()=>{const large='900719925474099312345';const c=await cart(stores[0],'11',{id:large});const other=await cart(stores[0],'11b',{id:'900719925474099312346'});const o=await order(stores[0],'11',{checkout_id:large});assert.equal(o.abandoned_cart_id,c.id);assert.notEqual(o.abandoned_cart_id,other.id)});
    await check('TC017-12 REST/GraphQL formats',async()=>{const c=await cart(stores[0],'12',{id:'gid://shopify/Checkout/123'});const o=await order(stores[0],'12',{checkout_id:'123'});assert.equal(o.abandoned_cart_id,null);return 'No conversion implemented; no false equivalence. Conversion semantics not verified; not applicable.'},'NOT APPLICABLE');
    await check('TC017-13 duplicate same-store checkout IDs',async()=>{const c=await cart(stores[0],'13');const duplicate=await prisma.abandoned_carts.create({data:{store_id:storeA,external_cart_id:c.external_cart_id,cart_value:25,currency:'USD',status:'pending',abandoned_at:new Date(),updated_at:new Date(Date.now()+60000)}});const o=await order(stores[0],'13',{checkout_id:c.external_cart_id});assert.equal(o.abandoned_cart_id,null,'Ambiguous duplicate ID must not arbitrarily select a row');return duplicate.id},'PASS');
    await check('TC017-14 deterministic unique ID',async()=>{const c=await cart(stores[0],'14');for(let i=0;i<3;i++){const o=await order(stores[0],'14',{checkout_id:c.external_cart_id});assert.equal(o.abandoned_cart_id,c.id)}});
    await check('TC017-15 persisted relationship',async()=>{const c=await cart(stores[0],'15');const o=await order(stores[0],'15',{checkout_id:c.external_cart_id});assert.equal(o.abandoned_cart_id,c.id)});
    await check('TC017-16 completion effect',async()=>{const a=await cart(stores[0],'16a'),b=await cart(stores[0],'16b');await order(stores[0],'16',{checkout_id:b.external_cart_id});assert.equal((await prisma.abandoned_carts.findUniqueOrThrow({where:{id:b.id}})).status,'recovered');assert.equal((await prisma.abandoned_carts.findUniqueOrThrow({where:{id:a.id}})).status,'pending')});
    await check('TC017-17 conflicting identifier precedence',async()=>{const exact=await cart(stores[0],'17-exact');const other=await cart(stores[0],'17-other',{updated_at:new Date(Date.now()+30000).toISOString()});const o=await order(stores[0],'17',{checkout_id:exact.external_cart_id,cart_token:other.external_cart_id});assert.equal(o.abandoned_cart_id,exact.id,'Authoritative exact checkout ID must win over unrelated cart token')});
  } finally {
    await prisma.stores.deleteMany({where:{id:{in:[storeA,storeB]}}});
    await prisma.organizations.deleteMany({where:{id:orgId}});
    await prisma.users.deleteMany({where:{id:userId}});
    await prisma.$disconnect();
  }
  console.log('TASK017_RESULTS='+JSON.stringify(results));
  console.log('TASK017_SUMMARY='+JSON.stringify({passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,notApplicable:results.filter(x=>x.status==='NOT APPLICABLE').length}));
  if(results.some(x=>x.status==='FAIL'))process.exitCode=1;
}
run().catch(e=>{console.error(e);process.exitCode=1});
