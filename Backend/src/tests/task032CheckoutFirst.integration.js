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
      assert.equal(o.attribution_channel,null);
      assert.equal(o.attribution_sequence_id,null);
    });
    await check('TC032-27-28-29-30-completion-precedes-and-overrides-abandonment',async()=>{
      for(const [suffix,created,ordered] of [
        ['early','2026-10-30T08:00:00Z','2026-10-30T08:14:00Z'],
        ['late','2026-10-30T08:00:00Z','2026-10-30T08:16:00Z'],
        ['boundary','2026-10-30T08:00:00Z','2026-10-30T08:15:00Z'],
      ]){
        await upsertAbandonedCart(store,checkout(suffix,{created_at:created,updated_at:created}));
        await upsertOrder(store,'shopify',order(suffix,{created_at:ordered}));
        const c=await getCart(suffix),o=await getOrder(suffix);
        assert.equal(c.status,'recovered');
        assert.equal(o.abandoned_cart_id,c.id);
        assert.notEqual(c.status,'abandoned');
      }
    });
    await check('TC032-50-completion-timestamp-preserved-from-checkout',async()=>{
      const completedAt='2026-10-30T08:09:30Z';
      await upsertAbandonedCart(store,checkout('completion-time',{completed_at:completedAt,updated_at:completedAt}));
      const c=await getCart('completion-time');
      assert.equal(c.status,'recovered');
      assert.equal(c.recovered_at.toISOString(),new Date(completedAt).toISOString());
    });
    await check('TC032-51-52-completed-cart-not-active-risk',async()=>{
      const c=await getCart('basic');
      assert.equal(c.status,'recovered');
      const active=await prisma.abandoned_carts.aggregate({
        where:{store_id:store.id,status:'abandoned',id:c.id},
        _count:{id:true},_sum:{cart_value:true},
      });
      assert.equal(active._count.id,0);
      assert.equal(Number(active._sum.cart_value||0),0);
    });
    await check('TC032-13-ambiguous-cart-token-rejected',async()=>{
      const token=prefix+'-ambiguous-cart';
      await upsertAbandonedCart(store,checkout('ambiguous-a',{cart_token:token}));
      await upsertAbandonedCart(store,checkout('ambiguous-b',{cart_token:token}));
      await upsertOrder(store,'shopify',order('ambiguous',{checkout_token:null,cart_token:token}));
      assert.equal((await getOrder('ambiguous')).abandoned_cart_id,null);
    });
    await check('TC032-39-identical-identifiers-both-merchants-reconcile-independently',async()=>{
      const other={id:randomUUID(),platform:'shopify'};
      await prisma.stores.create({data:{id:other.id,organization_id:org,platform:'shopify',shop_domain:prefix+'-tenant-independent.myshopify.com'}});
      const payload=checkout('tenant-independent');
      await upsertAbandonedCart(store,payload);
      await upsertAbandonedCart(other,payload);
      await upsertOrder(store,'shopify',order('tenant-independent'));
      await upsertOrder(other,'shopify',order('tenant-independent'));
      for(const merchant of [store,other]){
        const c=await prisma.abandoned_carts.findFirstOrThrow({where:{store_id:merchant.id,external_cart_id:payload.id}});
        const o=await prisma.orders.findFirstOrThrow({where:{store_id:merchant.id,external_order_id:prefix+'-order-tenant-independent'}});
        assert.equal(o.abandoned_cart_id,c.id);
        assert.equal(c.status,'recovered');
      }
    });
    await check('TC032-41-42-43-historical-event-replays-are-idempotent',async()=>{
      await upsertAbandonedCart(store,checkout('historical-checkout'));
      await upsertOrder(store,'shopify',order('historical-checkout'));
      await upsertOrder(store,'shopify',order('historical-order'));
      await upsertAbandonedCart(store,checkout('historical-order'));
      for(let i=0;i<3;i++){
        for(const suffix of ['historical-checkout','historical-order']){
          await upsertAbandonedCart(store,checkout(suffix));
          await upsertOrder(store,'shopify',order(suffix));
          assert.equal((await getOrder(suffix)).abandoned_cart_id,(await getCart(suffix)).id);
          assert.equal(await prisma.orders.count({where:{store_id:store.id,external_order_id:prefix+'-order-'+suffix}}),1);
          assert.equal(await prisma.abandoned_carts.count({where:{store_id:store.id,external_cart_id:prefix+'-checkout-'+suffix}}),1);
        }
      }
    });
    await check('TC032-44-fresh-prisma-client-reads-persisted-reconciliation',async()=>{
      const {PrismaClient}=require('@prisma/client');
      await upsertAbandonedCart(store,checkout('fresh-session'));
      await upsertOrder(store,'shopify',order('fresh-session'));
      const fresh=new PrismaClient();
      try{
        const o=await fresh.orders.findFirstOrThrow({where:{store_id:store.id,external_order_id:prefix+'-order-fresh-session'}});
        const c=await fresh.abandoned_carts.findFirstOrThrow({where:{store_id:store.id,external_cart_id:prefix+'-checkout-fresh-session'}});
        assert.equal(o.abandoned_cart_id,c.id);
      }finally{await fresh.$disconnect();}
    });
    await check('TC032-40-forged-merchant-context-rejected-by-ownership',async()=>{
      const foreign={id:randomUUID(),platform:'shopify'};
      await prisma.stores.create({data:{id:foreign.id,organization_id:org,platform:'shopify',shop_domain:prefix+'-forged.myshopify.com'}});
      await upsertAbandonedCart(foreign,checkout('forged'));
      await upsertOrder(store,'shopify',order('forged'));
      const o=await getOrder('forged');
      assert.equal(o.abandoned_cart_id,null);
      assert.equal((await prisma.abandoned_carts.findFirstOrThrow({where:{store_id:foreign.id,external_cart_id:prefix+'-checkout-forged'}})).status==='recovered',false);
    });
    await check('TC032-46-checkout-transaction-rollback-on-item-failure',async()=>{
      const bad=checkout('bad-items',{line_items:[{id:'bad',product_id:'x',title:'Invalid',price:'not-a-number',quantity:1}]});
      await assert.rejects(upsertAbandonedCart(store,bad));
      assert.equal(await prisma.abandoned_carts.count({where:{store_id:store.id,external_cart_id:bad.id}}),0);
    });
    await check('TC032-47-order-transaction-rollback-on-invalid-financial-evidence',async()=>{
      await upsertAbandonedCart(store,checkout('bad-order'));
      await assert.rejects(upsertOrder(store,'shopify',order('bad-order',{total_price:'not-a-number'})),/financial totals cannot be verified/);
      assert.equal(await prisma.orders.count({where:{store_id:store.id,external_order_id:prefix+'-order-bad-order'}}),0);
      assert.notEqual((await getCart('bad-order')).status,'recovered');
    });
    await check('TC032-additional-successful-relationship-write-baseline',async()=>{
      await upsertAbandonedCart(store,checkout('transaction-relation'));
      await upsertOrder(store,'shopify',order('transaction-relation'));
      const o=await getOrder('transaction-relation'),c=await getCart('transaction-relation');
      assert.equal(o.abandoned_cart_id,c.id);
      assert.equal(c.status,'recovered');
    });
    await check('TC032-58-59-no-full-payload-or-pii-in-reconciliation-case',async()=>{
      await upsertAbandonedCart(store,checkout('privacy',{email:'private-checkout@example.invalid',note:'PRIVATE_PAYLOAD_MARKER'}));
      await upsertOrder(store,'shopify',order('privacy',{checkout_token:null,checkout_id:null,cart_token:null,email:'private-order@example.invalid',note:'PRIVATE_PAYLOAD_MARKER'}));
      const o=await getOrder('privacy');
      const cases=await prisma.order_checkout_reconciliation_cases.findMany({where:{store_id:store.id,order_id:o.id}});
      assert.ok(cases.length>=1);
      for(const row of cases){
        const diagnostic=JSON.stringify(row);
        assert.equal(diagnostic.includes('private-checkout@example.invalid'),false);
        assert.equal(diagnostic.includes('private-order@example.invalid'),false);
        assert.equal(diagnostic.includes('PRIVATE_PAYLOAD_MARKER'),false);
      }
    });
    await check('TC032-45-process-restart-preserves-checkout-before-order',async()=>{
      const {execFileSync}=require('node:child_process');
      const suffix='restart';
      await upsertAbandonedCart(store,checkout(suffix));
      const childCode=[
        "const {upsertOrder}=require('./src/services/commerceWebhookService');",
        "const {prisma}=require('./src/configs/database');",
        "const store=JSON.parse(process.env.TASK032_CHILD_STORE);",
        "const payload=JSON.parse(process.env.TASK032_CHILD_ORDER);",
        "upsertOrder(store,'shopify',payload).then(()=>prisma.$disconnect()).catch(async e=>{console.error(e);await prisma.$disconnect();process.exitCode=1;});"
      ].join('');
      execFileSync(process.execPath,['-e',childCode],{
        cwd:require('node:path').resolve(__dirname,'../..'),
        env:{...process.env,TASK032_CHILD_STORE:JSON.stringify(store),TASK032_CHILD_ORDER:JSON.stringify(order(suffix))},
        timeout:20000,stdio:'pipe'
      });
      assert.equal((await getOrder(suffix)).abandoned_cart_id,(await getCart(suffix)).id);
      assert.equal((await getCart(suffix)).status,'recovered');
    });
    await check('TC032-48-failed-relationship-write-rolls-back-order-and-checkout',async()=>{
      const suffix='forced-relation-failure';
      await upsertAbandonedCart(store,checkout(suffix));
      await prisma.$executeRawUnsafe("CREATE OR REPLACE FUNCTION task032_reject_relationship() RETURNS trigger LANGUAGE plpgsql AS $ BEGIN IF NEW.external_order_id LIKE '%forced-relation-failure' AND NEW.abandoned_cart_id IS NOT NULL THEN RAISE EXCEPTION 'task032 injected relationship failure'; END IF; RETURN NEW; END; $");
      await prisma.$executeRawUnsafe("CREATE TRIGGER task032_relationship_failure BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION task032_reject_relationship()");
      try{
        await assert.rejects(upsertOrder(store,'shopify',order(suffix)),/task032 injected relationship failure|task032_reject_relationship|P2010|P2004/);
        assert.equal(await prisma.orders.count({where:{store_id:store.id,external_order_id:prefix+'-order-'+suffix}}),0);
        const c=await getCart(suffix);
        assert.notEqual(c.status,'recovered');
        assert.equal(await prisma.orders.count({where:{store_id:store.id,abandoned_cart_id:c.id}}),0);
      }finally{
        await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS task032_relationship_failure ON orders");
        await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS task032_reject_relationship()");
      }
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
