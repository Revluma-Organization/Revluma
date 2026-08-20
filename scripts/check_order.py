# scripts/check_order.py

import os
import sys
import urllib.parse
import psycopg2
from dotenv import load_dotenv

load_dotenv()

def get_db_connection():
    """Return a psycopg2 connection with pgbouncer parameter removed."""
    url = os.getenv('DATABASE_URL')
    
    parsed = urllib.parse.urlparse(url)
    query_params = urllib.parse.parse_qs(parsed.query)
    query_params.pop('pgbouncer', None)
    new_query = urllib.parse.urlencode(query_params, doseq=True) if query_params else ''
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
    store_id = '17c85879-fd24-4274-b456-a00c6efc5e3e'
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    # Get ALL orders for this store
    cur.execute("""
        SELECT external_order_id, total, coupon_used, customer_id, ordered_at 
        FROM orders 
        WHERE store_id = %s
        ORDER BY ordered_at DESC
    """, (store_id,))
    
    rows = cur.fetchall()
    
    if rows:
        print(f'✅ Found {len(rows)} order(s) for store {store_id}:')
        for row in rows:
            print(f'   Order ID: {row[0]}, Total: {row[1]}, Coupon: {row[2]}, Customer: {row[3]}, Date: {row[4]}')
    else:
        print(f'❌ No orders found for store {store_id}')
        
        # Also check if there are any orders at all in the table
        cur.execute("SELECT COUNT(*) FROM orders")
        total_orders = cur.fetchone()[0]
        print(f'   Total orders in entire table: {total_orders}')
    
    conn.close()

if __name__ == '__main__':
    main()