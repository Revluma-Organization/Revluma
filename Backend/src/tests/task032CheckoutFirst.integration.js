'use strict';
// Task032: disposable PostgreSQL only; no production merchant or Shopify writes.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { prisma } = require('../configs/database');
const { upsertOrder, upsertAbandonedCart } = require('../services/commerceWebhookService');
if (process.env.TASK032_ISOLATED_DB !== 'true' ||
    !String(process.env.DATABASE_URL || '').includes('@127.0.0.1:5432/task032')) {
  throw new Error('Task032 requires isolated disposable PostgreSQL');
}
const prefix = 'task032-' + randomUUID().slice(0, 8);
const store = { id: randomUUID(), platform: 'shopify' };
const results = [];
async function check(name, fn) {
  try { await fn(); results.push({name,status:'PASS'}); }
  catch (e) { results.push({name,status:'FAIL',error:e.message.slice(0,300)}); }
}
const checkout = (suffix, extra={}) => ({
  id: prefix+'-checkout-'+suffix, token:prefix+'-token-'+suffix,
  created_at:'2026-10-30T08:00:00Z',updated_at:'2026-10-30T08:01:00Z',
  total_price:'25',currency:'USD',...extra,
});
const order = (suffix,extra={}) => ({
  id:prefix+'-order-'+suffix,checkout_token:prefix+'-token-'+suffix,
  created_at:'2026-10-30T08:05:00Z',total_price:'25',currency:'USD',...extra,
});
const getCart = suffix => prisma.abandoned_carts.findFirstOrThrow({
  where:{store_id:store.id,external_cart_id:prefix+'-checkout-'+suffix}});
const getOrder = suffix => prisma.orders.findFirstOrThrow({
  where:{store_id:store.id,external_order_id:prefix+'-order-'+suffix}});
async function main(){
  try {
    const user=randomUUID(),org=randomUUID();
    await prisma.users.create({data:{id:user,full_name:'Task032 Test',email:prefix+'@example.invalid'}});
    await prisma.organizations.create({data:{id:org,owner_id:user,company_name:'Task032',industry:'other',country:'US',slug:prefix}});
    await prisma.stores.create({data:{id:store.id,organization_id:org,platform:'shopify',shop_domain:prefix+'.myshopify.com'}});
    await check('TC032-02-03-checkout-persists-without-fabricated-order',async()=>{
      await upsertAbandonedCart(store,checkout('basic'));
      assert.equal(await prisma.orders.count({where:{store_id:store.id}}),0);
      const c=await getCart('basic');assert.equal(c.store_id,store.id);
      assert.notEqual(c.status,'recovered');
    });
    await check('TC032-04-05-checkout-identifiers-persist',async()=>{
      const c=await getCart('basic');
      assert.equal(c.source_checkout_id,prefix+'-checkout-basic');
      assert.equal(c.source_checkout_token,prefix+'-token-basic');
    });
    await check('TC032-01-08-09-11-26-later-order-reconciles',async()=>{
      await upsertOrder(store,'shopify',order('basic'));
      const c=await getCart('basic'),o=await getOrder('basic');
      assert.equal(o.abandoned_cart_id,c.id);assert.equal(c.status,'recovered');
    });
    await check('TC032-10-exact-checkout-id',async()=>{
      await upsertAbandonedCart(store,checkout('id',{token:null}));
      await upsertOrder(store,'shopify',order('id',{checkout_token:null,checkout_id:prefix+'-checkout-id'}));
      assert.equal((await getOrder('id')).abandoned_cart_id,(await getCart('id')).id);
    });
    await check('TC032-12-cart-token-match',async()=>{
      const token=prefix+'-cart-token';
      await upsertAbandonedCart(store,checkout('cart',{token:null,cart_token:token}));
      await upsertOrder(store,'shopify',order('cart',{checkout_token:null,cart_token:token}));
      assert.equal((await getOrder('cart')).abandoned_cart_id,(await getCart('cart')).id);
    });
    await check('TC032-14-15-16-17-18-weak-evidence-does-not-match',async()=>{
      await upsertAbandonedCart(store,checkout('weak'));
      await upsertOrder(store,'shopify',order('weak',{checkout_token:null,checkout_id:null,cart_token:null}));
      assert.equal((await getOrder('weak')).abandoned_cart_id,null);
    });
    await check('TC032-20-exclusive-ownership',async()=>{
      await upsertAbandonedCart(store,checkout('owned'));
      await upsertOrder(store,'shopify',order('owned'));
      await upsertOrder(store,'shopify',order('owned-second',{checkout_token:prefix+'-token-owned'}));
      assert.equal((await getOrder('owned-second')).abandoned_cart_id,null);
    });
    await check('TC032-31-stale-checkout-cannot-reopen',async()=>{
      await upsertAbandonedCart(store,checkout('basic',{updated_at:'2026-10-30T07:00:00Z'}));
      assert.equal((await getCart('basic')).status,'recovered');
    });
    await check('TC032-32-34-duplicate-events',async()=>{
      await upsertAbandonedCart(store,checkout('basic'));
      await upsertOrder(store,'shopify',order('basic'));
      assert.equal(await prisma.orders.count({where:{store_id:store.id,external_order_id:prefix+'-order-basic'}}),1);
      assert.equal(await prisma.abandoned_carts.count({where:{store_id:store.id,external_cart_id:prefix+'-checkout-basic'}}),1);
    });
    await check('TC032-38-cross-merchant-isolation',async()=>{
      const other={id:randomUUID(),platform:'shopify'};
      await prisma.stores.create({data:{id:other.id,organization_id:org,platform:'shopify',shop_domain:prefix+'-other.myshopify.com'}});
      await upsertAbandonedCart(other,checkout('isolation'));
      await upsertOrder(store,'shopify',order('isolation'));
      assert.equal((await getOrder('isolation')).abandoned_cart_id,null);
    });
    await check('TC032-25-large-id-exact',async()=>{
      const id='90071992547409931234';
      await upsertAbandonedCart(store,checkout('large',{id,checkout_id:id,token:null}));
      await upsertOrder(store,'shopify',order('large',{checkout_id:id,checkout_token:null}));
      assert.equal((await getOrder('large')).source_checkout_id,id);
      assert.equal((await getOrder('large')).abandoned_cart_id,(await prisma.abandoned_carts.findFirstOrThrow({where:{store_id:store.id,external_cart_id:id}})).id);
    });
    await check('TC032-19-conflicting-checkout-id-and-token-must-not-link',async()=>{
      await upsertAbandonedCart(store,checkout('conflict-a'));
      await upsertAbandonedCart(store,checkout('conflict-b'));
      await upsertOrder(store,'shopify',order('conflict-order',{
        checkout_id:prefix+'-checkout-conflict-a',
        checkout_token:prefix+'-token-conflict-b',
      }));
      assert.equal((await getOrder('conflict-order')).abandoned_cart_id,null);
      assert.notEqual((await getCart('conflict-a')).status,'recovered');
      assert.notEqual((await getCart('conflict-b')).status,'recovered');
    });
    await check('TC032-36-concurrent-duplicate-order-ingestion',async()=>{
      await upsertAbandonedCart(store,checkout('parallel'));
      await Promise.all(Array.from({length:4},()=>upsertOrder(store,'shopify',order('parallel'))));
      const o=await getOrder('parallel'),c=await getCart('parallel');
      assert.equal(o.abandoned_cart_id,c.id);
      assert.equal(await prisma.orders.count({where:{store_id:store.id,external_order_id:o.external_order_id}}),1);
    });
    await check('TC032-37-concurrent-checkout-and-order-replay',async()=>{
      await upsertAbandonedCart(store,checkout('simultaneous'));
      await Promise.all([
        upsertOrder(store,'shopify',order('simultaneous')),
        upsertAbandonedCart(store,checkout('simultaneous')),
      ]);
      assert.equal((await getOrder('simultaneous')).abandoned_cart_id,(await getCart('simultaneous')).id);
    });
    await check('TC032-additional-checkout-first-evidence-and-durability',async()=>{
      await upsertAbandonedCart(store,checkout('durable',{line_items:[{id:prefix+'-line',product_id:prefix+'-product',title:'Durable Product',price:'12.50',quantity:2}]}));
      const cart=await getCart('durable');
      assert.equal(await prisma.abandoned_cart_items.count({where:{abandoned_cart_id:cart.id}}),1);
      await upsertAbandonedCart(store,checkout('durable',{line_items:[]}));
      assert.equal(await prisma.abandoned_cart_items.count({where:{abandoned_cart_id:cart.id}}),1);
      await upsertOrder(store,'shopify',order('durable'));
      assert.equal((await getCart('durable')).status,'recovered');
      await upsertAbandonedCart(store,checkout('durable',{updated_at:'2026-10-30T07:30:00Z'}));
      assert.equal((await getCart('durable')).status,'recovered');
    });
    await check('TC032-additional-merchant-same-identifiers',async()=>{
      const other={id:randomUUID(),platform:'shopify'};
      await prisma.stores.create({data:{id:other.id,organization_id:org,platform:'shopify',shop_domain:prefix+'-same-ids.myshopify.com'}});
      await upsertAbandonedCart(store,checkout('same-ids'));
      await upsertAbandonedCart(other,checkout('same-ids'));
      await upsertOrder(store,'shopify',order('same-ids'));
      const own=await getCart('same-ids');
      const foreign=await prisma.abandoned_carts.findFirstOrThrow({where:{store_id:other.id,external_cart_id:prefix+'-checkout-same-ids'}});
      assert.equal((await getOrder('same-ids')).abandoned_cart_id,own.id);
      assert.notEqual(foreign.status,'recovered');
    });
    await check('TC032-additional-concurrent-checkout-duplicates',async()=>{
      await Promise.all(Array.from({length:4},()=>upsertAbandonedCart(store,checkout('parallel-cart'))));
      assert.equal(await prisma.abandoned_carts.count({where:{store_id:store.id,external_cart_id:prefix+'-checkout-parallel-cart'}}),1);
    });
    await check('TC032-06-cart-token-preserved',async()=>{
      const t=prefix+'-persist-cart-token';
      await upsertAbandonedCart(store,checkout('cart-preserve',{cart_token:t}));
      assert.equal((await getCart('cart-preserve')).source_cart_token,t);
    });
    await check('TC032-21-22-23-missing-one-identifier-safe-alternatives',async()=>{
      for(const [suffix,extra] of [
        ['missing-id',{checkout_id:null,checkout_token:prefix+'-token-missing-id'}],
        ['missing-token',{checkout_token:null,checkout_id:prefix+'-checkout-missing-token'}],
        ['missing-cart',{cart_token:null,checkout_token:prefix+'-token-missing-cart'}],
      ]){
        await upsertAbandonedCart(store,checkout(suffix));
        await upsertOrder(store,'shopify',order(suffix,extra));
        assert.equal((await getOrder(suffix)).abandoned_cart_id,(await getCart(suffix)).id);
      }
    });
    await check('TC032-33-35-replayed-update-idempotency',async()=>{
      await upsertAbandonedCart(store,checkout('updates'));
      await upsertAbandonedCart(store,checkout('updates',{updated_at:'2026-10-30T08:02:00Z'}));
      await upsertAbandonedCart(store,checkout('updates',{updated_at:'2026-10-30T08:02:00Z'}));
      await upsertOrder(store,'shopify',order('updates'));
      await upsertOrder(store,'shopify',order('updates',{updated_at:'2026-10-30T08:07:00Z'}));
      await upsertOrder(store,'shopify',order('updates',{updated_at:'2026-10-30T08:07:00Z'}));
      assert.equal(await prisma.orders.count({where:{store_id:store.id,external_order_id:prefix+'-order-updates'}}),1);
      assert.equal(await prisma.abandoned_carts.count({where:{store_id:store.id,external_cart_id:prefix+'-checkout-updates'}}),1);
      assert.equal((await getOrder('updates')).abandoned_cart_id,(await getCart('updates')).id);
    });
    await check('TC032-49-identifier-integrity-after-reconciliation',async()=>{
      const c=await getCart('basic'),o=await getOrder('basic');
      assert.equal(c.source_checkout_id,prefix+'-checkout-basic');
      assert.equal(c.source_checkout_token,prefix+'-token-basic');
      assert.equal(o.source_checkout_token,prefix+'-token-basic');
    });
    await check('TC032-60-repeatability-across-independent-fixtures',async()=>{
      for(let i=0;i<3;i++){
        const suffix='repeat-'+i;
        await upsertAbandonedCart(store,checkout(suffix));
        await upsertOrder(store,'shopify',order(suffix));
        const c=await getCart(suffix),o=await getOrder(suffix);
        assert.equal(c.status,'recovered');
        assert.equal(o.abandoned_cart_id,c.id);
      }
    });
    await check('TC032-07-incomplete-checkout-not-completed',async()=>{
      await upsertAbandonedCart(store,checkout('incomplete-state'));
      assert.notEqual((await getCart('incomplete-state')).status,'recovered');
      assert.equal(await prisma.orders.count({where:{store_id:store.id,external_order_id:prefix+'-order-incomplete-state'}}),0);
    });
    await check('TC032-24-unsafe-source-identifier-rejected',async()=>{
      await upsertAbandonedCart(store,checkout('invalid-identifier'));
      await assert.rejects(upsertOrder(store,'shopify',order('invalid-identifier',{checkout_id:9007199254740993})),/Unsafe Shopify identifier number/);
      assert.equal((await getCart('invalid-identifier')).status==='recovered',false);
      assert.equal(await prisma.orders.count({where:{store_id:store.id,external_order_id:prefix+'-order-invalid-identifier'}}),0);
    });
    await check('TC032-54-no-fabricated-recovery-attribution',async()=>{
      await upsertAbandonedCart(store,checkout('no-attribution'));
      await upsertOrder(store,'shopify',order('no-attribution'));
      const o=await getOrder('no-attribution');
      assert.equal(o.abandoned_cart_id,(await getCart('no-attribution')).id);
      assert.equal(o.attribution_channel,null);\n      assert.equal(o.attribution_sequence_id,null);
    });
    await check('TC032-53-legitimate-order-revenue-once',async()=>{
      const o=await getOrder('basic');
      assert.equal(Number(o.total),25);
      assert.equal(await prisma.orders.count({where:{store_id:store.id,external_order_id:o.external_order_id}}),1);
    });
  }finally{
    console.log('TASK032_RESULTS='+JSON.stringify(results));
    console.log('TASK032_SUMMARY='+JSON.stringify({pass:results.filter(x=>x.status==='PASS').length,fail:results.filter(x=>x.status==='FAIL').length,total:results.length}));
    await prisma.$disconnect();
  }
  if(results.some(x=>x.status==='FAIL'))process.exitCode=1;
}
main().catch(e=>{console.error('TASK032_FATAL='+e.stack);process.exitCode=1;});
