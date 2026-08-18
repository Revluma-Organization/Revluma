import os
import sys
import psycopg2
from dotenv import load_dotenv

load_dotenv()

def main():
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    cur = conn.cursor()

    # Get first organization
    cur.execute('SELECT id FROM organizations LIMIT 1')
    row = cur.fetchone()
    if not row:
        print('❌ No organization found. Please create one first.')
        sys.exit(1)

    org_id = row[0]

    # ============================================================
    # YOUR UPDATED CREDENTIALS
    # ============================================================
    shop_domain = 'https://revluma.local'
    consumer_key = 'ck_88558d682b6faade1f61d55b6c60bb91f24699c3'
    consumer_secret = 'cs_ad02f02cf58baca16d8dbaec7f2098b6411c512f'
    access_token = f'{consumer_key}:{consumer_secret}'
    # ============================================================

    # Get the existing store ID first
    cur.execute("""
        SELECT id FROM stores
        WHERE organization_id = %s AND shop_domain = %s
    """, (org_id, shop_domain))
    
    row = cur.fetchone()
    
    if row:
        store_id = row[0]
        print(f'📦 Found existing store with ID: {store_id}')
        
        # Update the existing store
        cur.execute("""
            UPDATE stores
            SET access_token = %s,
                status = 'active',
                updated_at = NOW()
            WHERE id = %s
        """, (access_token, store_id))
        
        conn.commit()
        print(f'\n✅ Store updated successfully!')
        print(f'   Store ID: {store_id} (same as before)')
        print(f'   Shop Domain: {shop_domain}')
        print(f'   Access Token: {access_token[:30]}... (truncated)')
        
    else:
        print('❌ No existing store found. Creating a new one...')
        
        # Insert a new store
        cur.execute("""
            INSERT INTO stores (id, organization_id, platform, shop_domain, access_token, status, created_at, updated_at)
            VALUES (gen_random_uuid(), %s, 'woocommerce', %s, %s, 'active', NOW(), NOW())
            RETURNING id
        """, (org_id, shop_domain, access_token))
        
        store_id = cur.fetchone()[0]
        conn.commit()
        
        print(f'\n✅ New store created with ID: {store_id}')
        print(f'   Shop Domain: {shop_domain}')
        print(f'   Access Token: {access_token[:30]}... (truncated)')

    print('\n👉 Use this ID to run the sync:')
    print(f'   python src/services/woocommerce_sync.py {store_id}')
    
    conn.close()

if __name__ == '__main__':
    main()