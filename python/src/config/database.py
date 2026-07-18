from sqlalchemy import create_engine
from .settings import settings

engine = create_engine(
    settings.DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    echo=True,  
)
