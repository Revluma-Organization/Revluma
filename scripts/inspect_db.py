import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()
conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor()

cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")
tables = [row[0] for row in cur.fetchall()]
print("Tables:", tables)

for table in tables:
    cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name=%s ORDER BY ordinal_position", (table,))
    cols = cur.fetchall()
    print(f"\n{table} columns:")
    for col in cols:
        print(f"  {col[0]} ({col[1]})")

conn.close()