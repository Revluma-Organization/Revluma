import os
from sqlalchemy import create_engine
from dotenv import load_dotenv
from .settings import settings

load_dotenv()

# If settings.DATABASE_URL is empty, try to get it directly from the system
db_url = settings.DATABASE_URL or os.getenv("DATABASE_URL")

print("--- DEBUG: YOUR DATABASE URL IS ---")
print(repr(db_url))
print("-----------------------------------")
# -------------------------

engine = create_engine(
    db_url,
    pool_size=10,
    max_overflow=20,
    echo=True,  
)
