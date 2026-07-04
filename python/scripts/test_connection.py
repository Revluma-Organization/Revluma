import sys
from pathlib import Path

parent_dir = Path(__file__).parent.parent
sys.path.insert(0, str(parent_dir))

from src.config.database import engine
from sqlalchemy import text

def main():
    try:
        with engine.connect() as conn:
            # 1. Test basic connectivity
            result = conn.execute(text("SELECT 1"))
            print("✅ Database connection established.")

            # 2. List all tables in the public schema
            result = conn.execute(text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' ORDER BY table_name"
            ))
            tables = [row[0] for row in result]
            
            if not tables:
                print("⚠️ No tables found in the public schema.")
                return
            
            print(f"\n📋 Tables in the database: {', '.join(tables)}")
            
            # 3. Try to query a table named "User" or "users" (case‑insensitive)
            #    If it exists, show the count.
            target_table = None
            for t in tables:
                if t.lower() == "user" or t.lower() == "users":
                    target_table = t
                    break
            
            if target_table:
                # Query with proper quoting if needed (only if case‑sensitive)
                # If the table name is mixed case, we need to quote it.
                # We'll just use the exact name as returned.
                quoted = f'"{target_table}"' if target_table != target_table.lower() else target_table
                count_result = conn.execute(text(f"SELECT COUNT(*) FROM {quoted}"))
                count = count_result.scalar()
                print(f"✅ Table '{target_table}' has {count} row(s).")
            else:
                print("\n⚠️ No 'User' or 'users' table found. You can query any of the tables above.")
                # Example: query the first table
                if tables:
                    sample_table = tables[0]
                    quoted = f'"{sample_table}"' if sample_table != sample_table.lower() else sample_table
                    count_result = conn.execute(text(f"SELECT COUNT(*) FROM {quoted}"))
                    count = count_result.scalar()
                    print(f"   (For example, table '{sample_table}' has {count} row(s).)")
    
    except Exception as e:
        print(f"❌ Connection failed: {e}")

if __name__ == "__main__":
    main()