'use strict';
const url=new URL(process.env.DATABASE_URL||'postgresql://invalid/invalid');
if(process.env.TASK233_ISOLATED_DB!=='true'||url.hostname!=='127.0.0.1'||url.port!=='5432'||url.pathname!=='/task030')throw Error('Disposable task030 PostgreSQL required');
const test=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {prisma}=require('../configs/database');const R=require('../services/syncStallReaper');
const tag='task233-'+randomUUID(),user=randomUUID(),org=randomUUID(),store=randomUUID();
const old=new Date('2026-01-01T00:00:00Z'),now=new Date('2026-01-02T00:00:00Z');
test.before(async()=>{
 await prisma.users.create({data:{id:user,full_name:'Synthetic',email:tag+'@example.invalid'}});
 await prisma.organizations.create({data:{id:org,owner_id:user,company_name:'Synthetic',industry:'other',country:'US',slug:tag}});
 await prisma.stores.create({data:{id:store,organization_id:org,platform:'shopify',shop_domain:tag+'.myshopify.com'}});
});
test.after(async()=>{await prisma.store_sync_domain_states.deleteMany({where:{store_id:store}});await prisma.stores.delete({where:{id:store}});await prisma.organizations.delete({where:{id:org}});await prisma.users.delete({where:{id:user}});await prisma.$disconnect();});
async function prepare(domain){return prisma.store_sync_domain_states.create({data:{store_id:store,domain,status:'running',last_attempted_at:old,last_checked_at:old,updated_at:old,records_discovered:7,checkpoint:{cursor:'synthetic'}}});}
test('unchanged expired resource is marked failed without erasing durable progress',async()=>{
 const row=await prepare('orders'); assert.equal(await R.reapStaleDomain(prisma,store,row,{now}),true);
 const saved=await prisma.store_sync_domain_states.findUniqueOrThrow({where:{id:row.id}});
 assert.equal(saved.status,'failed');assert.equal(saved.error_code,'SYNC_STALE_TIMEOUT');assert.equal(saved.records_discovered,7);assert.deepEqual(saved.checkpoint,{cursor:'synthetic'});
});
test('completed resource after scan is not downgraded by the old observation',async()=>{
 const row=await prepare('products');await prisma.store_sync_domain_states.update({where:{id:row.id},data:{status:'ok',last_succeeded_at:now,updated_at:now,pagination_complete:true}});
 assert.equal(await R.reapStaleDomain(prisma,store,row,{now}),false);
 const saved=await prisma.store_sync_domain_states.findUniqueOrThrow({where:{id:row.id}});assert.equal(saved.status,'ok');assert.equal(saved.pagination_complete,true);
});
test('new resource attempt after scan remains running',async()=>{
 const row=await prepare('customers');await prisma.store_sync_domain_states.update({where:{id:row.id},data:{last_attempted_at:now,updated_at:now}});
 assert.equal(await R.reapStaleDomain(prisma,store,row,{now}),false);
 assert.equal((await prisma.store_sync_domain_states.findUniqueOrThrow({where:{id:row.id}})).status,'running');
});
test('only one of two reapers can claim the same observed resource',async()=>{
 const row=await prepare('inventory');const results=await Promise.all([R.reapStaleDomain(prisma,store,row,{now}),R.reapStaleDomain(prisma,store,row,{now})]);
 assert.deepEqual(results.sort(),[false,true]);const saved=await prisma.store_sync_domain_states.findUniqueOrThrow({where:{id:row.id}});assert.equal(saved.retry_count,1);
});
