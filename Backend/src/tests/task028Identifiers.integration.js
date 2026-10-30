'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {prisma}=require('../configs/database');
if(process.env.TASK028_ISOLATED_DB!=='true'||!String(process.env.DATABASE_URL||'').includes('@127.0.0.1:5432/task028'))throw Error('Disposable localhost task028 PostgreSQL and explicit opt-in required');
if(process.env.TASK028_ISOLATED_DB!=='true'||!/^postgres(?:ql)?:\\/\\/[^@]+@(?:127\\.0\\.0\\.1|localhost):5432\\/task028\\b/.test(process.env.DATABASE_URL||''))throw Error('Disposable task028 DB required');
const tag=randomUUID().slice(0,8),uid=randomUUID(),org=randomUUID(),a=randomUUID(),b=randomUUID(),s={id:a,platform:'shopify'},t={id:b,platform:'shopify'},results=[];
let serial=0;const key=x=>`t028-${tag}-${x}`;
async function cart(store,name,extra={}){return upsertAbandonedCart(store,{id:key('checkout-'+name),created_at:new Date(Date.now()-90000).toISOString(),updated_at:new Date(Date.now()-60000).toISOString(),total_price:'25',currency:'USD',...extra})}
async function order(store,name,extra={}){const id=extra.id||key('order-'+name+'-'+(++serial));await upsertOrder(store,'shopify',{id,created_at:new Date().toISOString(),total_price:'25',currency:'USD',...extra});return prisma.orders.findUniqueOrThrow({where:{store_id_external_order_id:{store_id:store.id,external_order_id:String(id)}}})}
async function check(id,fn){try{await fn();results.push({id,status:'PASS'})}catch(e){results.push({id,status:'FAIL',error:String(e.message).slice(0,260)})}}
async function run(){try{
await prisma.users.create({data:{id:uid,full_name:'Task028 Synthetic',email:key('user')+'@example.invalid'}});
await prisma.organizations.create({data:{id:org,owner_id:uid,company_name:'Task028',industry:'other',country:'US',slug:key('org')}});
await prisma.stores.createMany({data:[{id:a,organization_id:org,platform:'shopify',shop_domain:key('store')+'.myshopify.com'},{id:b,organization_id:org,platform:'shopify',shop_domain:key('store2')+'.myshopify.com'}]});
await check('TC028-01',async()=>{let o=await order(s,'01');assert.ok(o.external_order_id.startsWith(key('order')))});
await check('TC028-02',async()=>{let c=await cart(s,'02');assert.equal(c.source_checkout_id,key('checkout-02'))});
await check('TC028-03',async()=>{let c=await cart(s,'03',{token:key('token03')});assert.equal(c.source_checkout_token,key('token03'))});
await check('TC028-04',async()=>{let c=await cart(s,'04',{cart_token:key('cart04')});assert.equal(c.source_cart_token,key('cart04'))});
await check('TC028-05',async()=>{let o=await order(s,'05',{checkout_id:key('checkout05')});assert.equal(o.source_checkout_id,key('checkout05'))});
await check('TC028-06',async()=>{let o=await order(s,'06',{checkout_token:key('token06')});assert.equal(o.source_checkout_token,key('token06'))});
await check('TC028-07',async()=>{let o=await order(s,'07',{cart_token:key('cart07')});assert.equal(o.source_cart_token,key('cart07'))});
await check('TC028-08',async()=>{let id='gid://shopify/Checkout/9007199254740999';let c=await cart(s,'08',{checkout_id:id});assert.equal(c.source_checkout_id,id)});
await check('TC028-09',async()=>{let id='900719925474099999999';let o=await order(s,'09',{checkout_id:id});assert.equal(o.source_checkout_id,id)});
await check('TC028-10',async()=>{let id='gid://shopify/Checkout/9007199254740999';let c=await cart(s,'10',{checkout_id:id});assert.equal(c.source_checkout_id,id)});
await check('TC028-11',async()=>{let o=await order(s,'11');assert.equal(o.source_checkout_token,null)});
await check('TC028-12',async()=>{let o=await order(s,'12',{checkout_token:null});assert.equal(o.source_checkout_token,null)});
await check('TC028-13',async()=>{let o=await order(s,'13',{checkout_token:''});assert.equal(o.source_checkout_token,null)});
await check('TC028-14',async()=>{await assert.rejects(order(s,'14',{checkout_token:{bad:1}}),/Invalid Shopify identifier type/)});
await check('TC028-15',async()=>{let id=key('repeat15');await order(s,'15',{id,checkout_token:key('token15')});await order(s,'15',{id});assert.equal(await prisma.orders.count({where:{store_id:s.id,external_order_id:id}}),1)});
await check('TC028-16',async()=>{await cart(s,'16',{token:key('token16')});let c=await cart(s,'16');assert.equal(c.source_checkout_token,key('token16'))});
await check('TC028-17',async()=>{let id=key('repeat17');await order(s,'17',{id,checkout_token:key('token17')});let o=await order(s,'17',{id});assert.equal(o.source_checkout_token,key('token17'))});
await check('TC028-18',async()=>{await cart(s,'18',{token:key('token18')});let c=await cart(s,'18',{updated_at:new Date().toISOString()});assert.equal(c.source_checkout_token,key('token18'))});
await check('TC028-19',async()=>{let id=key('repeat19');await order(s,'19',{id,checkout_token:key('token19a')});await assert.rejects(order(s,'19',{id,checkout_token:key('token19b')}),/Conflicting Shopify source identifier/);let o=await prisma.orders.findFirstOrThrow({where:{store_id:s.id,external_order_id:id}});assert.equal(o.source_checkout_token,key('token19a'))});
await check('TC028-20',async()=>{await cart(s,'20',{token:key('token20a')});await assert.rejects(cart(s,'20',{token:key('token20b'),updated_at:new Date().toISOString()}),/Conflicting Shopify source identifier/);let c=await prisma.abandoned_carts.findFirstOrThrow({where:{store_id:s.id,external_cart_id:key('checkout-20')}});assert.equal(c.source_checkout_token,key('token20a'))});
await check('TC028-21',async()=>{let c=await cart(s,'21',{token:key('token21')});let o=await order(s,'21',{checkout_token:key('token21')});assert.equal(o.abandoned_cart_id,c.id)});
await check('TC028-22',async()=>{let o=await order(s,'22',{checkout_token:key('missing22')});assert.equal(o.abandoned_cart_id,null);assert.ok(await prisma.order_checkout_reconciliation_cases.findFirst({where:{store_id:s.id,order_id:o.id}}))});
await check('TC028-23',async()=>{let c=await cart(s,'23a',{token:key('token23a')});await cart(s,'23b',{cart_token:key('cart23b')});let o=await order(s,'23',{checkout_token:key('token23a'),cart_token:key('cart23b')});assert.equal(o.abandoned_cart_id,null);assert.ok(c.id)});
await check('TC028-24',async()=>{let c=await cart(s,'24',{token:key('token24')});let a=await order(s,'24a',{checkout_token:key('token24')});let b=await order(s,'24b',{checkout_token:key('token24')});assert.equal(a.abandoned_cart_id,c.id);assert.equal(b.abandoned_cart_id,null)});
await check('TC028-25',async()=>{let o=await order(s,'25',{checkout_token:key('token25')});assert.equal(o.source_checkout_token,key('token25'));assert.equal(o.abandoned_cart_id,null)});
await check('TC028-26',async()=>{let c=await cart(s,'26',{token:key('token26')});assert.equal(c.source_checkout_token,key('token26'))});
await check('TC028-30',async()=>{let a=await cart(s,'30',{token:key('same30')});let b=await cart(t,'30',{token:key('same30')});assert.notEqual(a.id,b.id)});
await check('TC028-32',async()=>{let c=await cart(s,'32',{token:key('token32')});await prisma.$disconnect();await prisma.$connect();let fresh=await prisma.abandoned_carts.findUniqueOrThrow({where:{id:c.id}});assert.equal(fresh.source_checkout_token,key('token32'))});
await check('TC028-35',async()=>{await assert.rejects(prisma.abandoned_carts.create({data:{store_id:randomUUID(),external_cart_id:key('invalid35'),source_checkout_token:key('token35'),cart_value:10,currency:'USD',status:'active'}}));assert.equal(await prisma.abandoned_carts.count({where:{external_cart_id:key('invalid35')}}),0)});
await check('TC028-37',async()=>{let c=await cart(s,'37',{token:key('token37')});let row=await prisma.abandoned_carts.findUniqueOrThrow({where:{id:c.id},select:{source_checkout_token:true,source_cart_token:true,source_checkout_id:true}});assert.equal(Object.keys(row).length,3)});
await check('TC028-38',async()=>{let c=await cart(s,'38',{token:key('token38')});assert.equal(typeof c.source_checkout_token,'string');assert.ok(!('raw_payload' in c))});
await check('TC028-40',async()=>{let c=await cart(s,'40',{token:key('token40')});let before=c.status;let next=await cart(s,'40',{updated_at:new Date().toISOString()});assert.equal(next.status,before)});
await check('TC028-41',async()=>{let o=await order(s,'41',{checkout_token:key('unmatched41')});assert.notEqual(o.recovery_status,'recovered')});
await check('TC028-44',async()=>{let o=await order(s,'44',{checkout_token:key('token44')});assert.equal(o.source_checkout_token,key('token44'))});
}finally{const passed=results.filter(x=>x.status==='PASS').length;console.log('TASK028_RESULTS='+JSON.stringify(results));console.log('TASK028_SUMMARY='+JSON.stringify({passed,failed:results.length-passed,total:results.length}));await prisma.$disconnect()}if(results.some(x=>x.status==='FAIL'))process.exitCode=1}
run().catch(e=>{console.error('TASK028_FATAL',e.message);process.exitCode=1});
