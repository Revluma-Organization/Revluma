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

   
    shop_domain = ''
    access_token = ''
    

    cur.execute("""
        INSERT INTO stores (id, organization_id, platform, shop_domain, access_token, status, created_at, updated_at)
        VALUES (gen_random_uuid(), %s, 'woocommerce', %s, %s, 'active', NOW(), NOW())
        RETURNING id
    """, (org_id, shop_domain, access_token))

    store_id = cur.fetchone()[0]
    conn.commit()
    print(f'✅ Store created with ID: {store_id}')
    conn.close()

if __name__ == '__main__':
    main()