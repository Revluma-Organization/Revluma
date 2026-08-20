import os
import sys
import urllib.parse
import psycopg2
from dotenv import load_dotenv

load_dotenv()

def get_db_connection():
    """Return a psycopg2 connection with pgbouncer parameter removed."""
    url = os.getenv('DATABASE_URL')
    
    # Parse the URL
    parsed = urllib.parse.urlparse(url)
    
    # Parse query parameters and remove 'pgbouncer' if present
    query_params = urllib.parse.parse_qs(parsed.query)
    query_params.pop('pgbouncer', None)
    
    # Rebuild query string without pgbouncer
    new_query = urllib.parse.urlencode(query_params, doseq=True) if query_params else ''
    
    # Rebuild the clean URL
    clean_url = urllib.parse.urlunparse((
        parsed.scheme,
        parsed.netloc,
        parsed.path,
        parsed.params,
        new_query,
        parsed.fragment
    ))
    
    return psycopg2.connect(clean_url)

def main():
    conn = get_db_connection()
    cur = conn.cursor()

    # Get first organization
    cur.execute('SELECT id FROM organizations LIMIT 1')
    row = cur.fetchone()
    if not row:
        print('❌ No organization found. Please create one first.')
        sys.exit(1)

    org_id = row[0]

    # ============================================================
    # READ FROM ENVIRONMENT VARIABLES – NO HARDCODING!
    # ============================================================
    shop_domain = os.getenv('SHOP_DOMAIN')
    consumer_key = os.getenv('CONSUMER_KEY')
    consumer_secret = os.getenv('CONSUMER_SECRET')
    
    # Validate all required variables are present
    if not shop_domain:
        print('❌ SHOP_DOMAIN not set in .env')
        sys.exit(1)
    if not consumer_key:
        print('❌ CONSUMER_KEY not set in .env')
        sys.exit(1)
    if not consumer_secret:
        print('❌ CONSUMER_SECRET not set in .env')
        sys.exit(1)
    
    # Build access token from consumer key and secret
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